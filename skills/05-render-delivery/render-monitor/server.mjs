// 娓叉煋鐩戞帶 server锛氶浂渚濊禆锛圢ode 鍐呯疆 http/fs锛夈€?// 鐢ㄦ硶锛歯ode server.mjs [--dir <娓叉煋鏃ュ織鐩綍>] [--port 8788]
// 鏁版嵁婧愶細鐩綍涓?render*.log / post*.log / cover*.log锛圧emotion 娓叉煋閾炬棩蹇楋級銆?// API:
//   GET /            -> 浠〃鐩橀〉闈?//   GET /api/logs    -> 鍙€夋棩蹇楀垪琛?//   GET /api/progress?log=<basename> -> 瑙ｆ瀽鍚庣殑瀹炴椂鐘舵€?import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// ---------- 鍚姩鍙傛暟 ----------
const args = process.argv.slice(2);
const getArg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const BASE_DIR = path.resolve(getArg('--dir', process.cwd()));
const PORT = Number(getArg('--port', '8788'));

// ---------- 宸ュ叿 ----------
const pad2 = n => String(n).padStart(2, '0');
// "1h 33m 49s" / "33m 48s" / "45s" -> 绉?function parseRemaining(s) {
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

// 閫熷害閲囨牱锛歭ogBasename -> [{t, n}]锛堜繚鐣?3 鍒嗛挓锛?const samples = new Map();
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

// 瑙ｆ瀽鍗曚釜鏃ュ織 -> 鐘舵€佸璞?function parseLog(dir, name) {
  const file = path.join(dir, name);
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { name, state: 'missing' }; }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const tail = lines.slice(-6);
  const kind = /^(render|fix)/.test(name) ? 'render' : name.startsWith('post') ? 'post' : 'cover';

  const st = { name, kind, tail, state: 'running', error: null };

  // 娓叉煋鏃ュ織锛氬抚杩涘害
  if (kind === 'render') {
    const exit = text.match(/RENDER_EXIT=(\d+)/);
    if (exit) {
      st.state = exit[1] === '0' ? 'done' : 'failed';
      if (st.state === 'failed') {
        const errLine = lines.find(l => /Error:/.test(l));
        st.error = errLine ? errLine.slice(0, 200) : '鏈煡閿欒锛圧ENDER_EXIT=1锛?;
      }
      return st;
    }
    // 甯х敾瀹屽悗杩涘叆缂栫爜闃舵锛氭棩蹇楄緭鍑?"Encoded N/M"
    for (let i = lines.length - 1; i >= 0; i--) {
      const me = lines[i].match(/Encoded (\d+)\/(\d+)/);
      if (me) {
        st.state = 'encoding'; st.frame = +me[1]; st.total = +me[2];
        break;
      }
    }
    // 鍚﹀垯鎵炬渶鍚庝竴涓?Rendered 琛?    if (st.state !== 'encoding') {
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
    if (st.frame == null) st.state = 'running'; // 鏃㈡棤 Rendered 涔熸棤 Encoded锛堣繕鍦ㄥ惎鍔?鎵撳寘锛?    return st;
  }

  // post / cover 鏃ュ織锛氭楠ら€€鍑虹爜
  const exit = text.match(/(?:POST|COVER)_EXIT=(\d+)/);
  if (exit) { st.state = exit[1] === '0' ? 'done' : 'failed'; if (st.state === 'failed') st.error = '姝ラ閫€鍑虹爜闈?0'; }
  return st;
}

// 姹囨€伙細鍙栨渶鏂?render 鏃ュ織涓轰富绾匡紝post/cover 浣滀负鍚庣画闃舵
function status(dir, chosen) {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^(render|fix|post|cover).*\.log$/.test(f)); } catch { /* 鐩綍涓嶅瓨鍦?*/ }
  const mtimeOf = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } };
  files.sort((a, b) => mtimeOf(b) - mtimeOf(a));

  const active = chosen && files.includes(chosen) ? chosen : (files[0] || undefined);
  if (!active) return { dir, files, state: 'idle' };

  const main = parseLog(dir, active);
  // 宸茶繍琛屾椂闀匡細鏃ュ織鍒涘缓鏃堕棿=鍚姩鏃跺埢锛涜繍琛屼腑鐢ㄥ綋鍓嶆椂闂达紝宸茬粨鏉熺敤鏈€鍚庡啓鍏ユ椂闂村皝鍙?  try {
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

  // 娓叉煋鎴愬姛鍚庯紝鐪嬪皝瑁?灏侀潰閾捐繘搴?  if (main.state === 'done' && main.kind === 'render') {
    const postLog = files.find(f => f.startsWith('post'));
    const coverLog = files.find(f => f.startsWith('cover'));
    const p = postLog ? parseLog(dir, postLog) : null;
    const c = coverLog ? parseLog(dir, coverLog) : null;
    if (p && p.state === 'running') { out.stage = 'mux'; out.state = 'muxing'; }
    else if (c && c.state === 'running') { out.stage = 'cover'; out.state = 'covering'; }
    else if (c && c.state === 'done') { out.stage = 'all'; out.state = 'all_done'; }
    else if (p && p.state === 'done' && !c) { out.stage = 'cover'; out.state = 'covering'; }
    // 浜х墿妫€鏌?    try {
      const mp4s = fs.readdirSync(dir).filter(f => f.endsWith('.mp4') && !f.includes('muted') && !f.startsWith('part'));
      out.output = mp4s.map(f => { const s = fs.statSync(path.join(dir, f)); return { f, mb: +(s.size / 1048576).toFixed(1), t: s.mtimeMs }; }).sort((a, b) => b.t - a.t)[0] || null;
    } catch { /* ignore */ }
  }
  if (main.state === 'failed') out.stage = 'failed';

  // 閫熷害閲囨牱锛堟覆鏌?缂栫爜闃舵閮介噰锛?  if ((out.state === 'rendering' || out.state === 'encoding') && out.frame != null) {
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
// 鎯版€ц index.html锛氭敮鎸侀〉闈㈢儹鏀癸紝涓旈伩鍏嶅惎鍔ㄦ椂鏂囦欢缂哄け鐩存帴宕?const HTML_PATH = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'index.html');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/progress') {
    // ?log= 鍙厑璁?basename锛岄槻鐩綍绌胯秺
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

