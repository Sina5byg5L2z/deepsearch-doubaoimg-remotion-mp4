// 渲染监控 server：零依赖（Node 内置 http/fs）。
// 用法：node server.mjs [--dir <渲染日志目录>] [--port 8788]
// 数据源：目录下 render*.log / post*.log / cover*.log（Remotion 渲染链日志）。
// API:
//   GET /            -> 仪表盘页面
//   GET /api/logs    -> 可选日志列表
//   GET /api/progress?log=<basename> -> 解析后的实时状态
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// ---------- 启动参数 ----------
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE_DIR = path.resolve(getArg('--dir', process.cwd()));
const PORT = Number(getArg('--port', '8788'));

// ---------- 工具 ----------
const pad2 = n => String(n).padStart(2, '0');
// "1h 33m 49s" / "33m 48s" / "45s" -> 秒
function parseRemaining(s) {
  if (!s) return null;
  let total = 0, m;
  if ((m = s.match(/(\d+)h/))) total += +m[1] * 3600;
  if ((m = s.match(/(\d+)m/))) total += +m[1] * 60;
  if ((m = s.match(/(\d+)s/))) total += +m[1];
  return total > 0 ? total : null;
}
const fmtHMS = sec => {
  if (sec == null) return '--';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
};

// 速度采样：logBasename -> [{t, n}]（保留 3 分钟）
const samples = new Map();
function pushSample(key, n) {
  if (!samples.has(key)) samples.set(key, []);
  const arr = samples.get(key);
  const now = Date.now();
  if (arr.length && arr[arr.length - 1].n === n) arr[arr.length - 1].t = now;
  else arr.push({ t: now, n });
  while (arr.length && now - arr[0].t > 180000) arr.shift();
  return arr;
}
function fpsOf(arr) {
  if (!arr || arr.length < 2) return null;
  const a = arr[0], b = arr[arr.length - 1];
  const dt = (b.t - a.t) / 1000;
  return dt > 3 ? (b.n - a.n) / dt : null;
}

// 解析单个日志 -> 状态对象
function parseLog(dir, name) {
  const file = path.join(dir, name);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { name, state: 'missing' }; }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-6);
  const kind = /^(render|fix)/.test(name) ? 'render' : name.startsWith('post') ? 'post' : 'cover';

  const st = { name, kind, tail, state: 'running', error: null };

  // 渲染日志：帧进度
  if (kind === 'render') {
    const exit = text.match(/RENDER_EXIT=(\d+)/);
    if (exit) {
      st.state = exit[1] === '0' ? 'done' : 'failed';
      if (st.state === 'failed') {
        const errLine = lines.find(l => /Error:/.test(l));
        st.error = errLine ? errLine.slice(0, 200) : '未知错误（RENDER_EXIT=1）';
      }
      return st;
    }
    // 帧画完后进入编码阶段：日志输出 "Encoded N/M"
    for (let i = lines.length - 1; i >= 0; i--) {
      const me = lines[i].match(/Encoded (\d+)\/(\d+)/);
      if (me) {
        st.state = 'encoding'; st.frame = +me[1]; st.total = +me[2];
        break;
      }
    }
    // 否则找最后一个 Rendered 行
    if (st.state !== 'encoding') {
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = lines[i].match(/Rendered (\d+)\/(\d+), time remaining:\s*(.+)/);
        if (m) {
          st.frame = +m[1]; st.total = +m[2];
          st.remainingSec = parseRemaining(m[3].trim());
          st.state = 'rendering';
          break;
        }
      }
    }
    if (st.frame == null) st.state = 'running'; // 既无 Rendered 也无 Encoded（还在启动/打包）
    return st;
  }

  // post / cover 日志：步骤退出码
  const exit = text.match(/(?:POST|COVER)_EXIT=(\d+)/);
  if (exit) { st.state = exit[1] === '0' ? 'done' : 'failed'; if (st.state === 'failed') st.error = '步骤退出码非 0'; }
  return st;
}

// 汇总：取最新 render 日志为主线，post/cover 作为后续阶段
function status(dir, chosen) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^(render|fix|post|cover).*\.log$/.test(f)); } catch { /* 目录不存在 */ }
  const mtimeOf = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } };
  files.sort((a, b) => mtimeOf(b) - mtimeOf(a));

  const active = chosen && files.includes(chosen) ? chosen : (files[0] || undefined);
  if (!active) return { dir, files, state: 'idle' };

  const main = parseLog(dir, active);
  // 已运行时长：日志创建时间=启动时刻；运行中用当前时间，已结束用最后写入时间封口
  try {
    const s = fs.statSync(path.join(dir, active));
    const end = (main.state === 'running') ? Date.now() : s.mtimeMs;
    main.elapsedSec = Math.max(0, Math.round((Math.min(end, Date.now()) - s.birthtimeMs) / 1000));
  } catch { /* ignore */ }
  const out = {
    dir, files: files.slice(0, 12), active, name: active,
    state: main.state, kind: main.kind, tail: main.tail, error: main.error,
    frame: main.frame, total: main.total, remainingSec: main.remainingSec,
    elapsedSec: main.elapsedSec,
  };

  // 渲染成功后，看封装/封面链进度
  if (main.state === 'done' && main.kind === 'render') {
    const postLog = files.find(f => f.startsWith('post'));
    const coverLog = files.find(f => f.startsWith('cover'));
    const p = postLog ? parseLog(dir, postLog) : null;
    const c = coverLog ? parseLog(dir, coverLog) : null;
    if (p && p.state === 'running') { out.stage = 'mux'; out.state = 'muxing'; }
    else if (c && c.state === 'running') { out.stage = 'cover'; out.state = 'covering'; }
    else if (c && c.state === 'done') { out.stage = 'all'; out.state = 'all_done'; }
    else if (p && p.state === 'done' && !c) { out.stage = 'cover'; out.state = 'covering'; }
    // 产物检查
    try {
      const mp4s = fs.readdirSync(dir).filter(f => f.endsWith('.mp4') && !f.includes('muted') && !f.startsWith('part'));
      out.output = mp4s.map(f => { const s = fs.statSync(path.join(dir, f)); return { f, mb: +(s.size / 1048576).toFixed(1), t: s.mtimeMs }; }).sort((a, b) => b.t - a.t)[0] || null;
    } catch { /* ignore */ }
  }
  if (main.state === 'failed') out.stage = 'failed';

  // 速度采样（渲染/编码阶段都采）
  if ((out.state === 'rendering' || out.state === 'encoding') && out.frame != null) {
    const arr = pushSample(active, out.frame);
    out.fps = fpsOf(arr);
    out.spark = arr.map(p => ({ t: p.t, n: p.n }));
    if (out.remainingSec == null && out.fps > 0 && out.total) {
      out.remainingSec = Math.round((out.total - out.frame) / out.fps);
    }
  }
  return out;
}

// ---------- HTTP ----------
// 惰性读 index.html：支持页面热改，且避免启动时文件缺失直接崩
const HTML_PATH = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'index.html');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/progress') {
    // ?log= 只允许 basename，防目录穿越
    const log = u.searchParams.get('log') && !u.searchParams.get('log').includes('/') && !u.searchParams.get('log').includes('..')
      ? u.searchParams.get('log') : undefined;
    let data;
    try { data = status(BASE_DIR, log); } catch (e) { data = { state: 'error', error: String(e).slice(0, 200) }; }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(HTML_PATH));
}).listen(PORT, () => console.log(`render-monitor: http://localhost:${PORT}  dir=${BASE_DIR}`));
