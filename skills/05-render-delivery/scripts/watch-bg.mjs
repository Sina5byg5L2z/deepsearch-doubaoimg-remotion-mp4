#!/usr/bin/env node
// 通用后台任务前台看护器（零依赖，Node >= 18）
// 用法:
//   node watch-bg.mjs --log <日志文件> [--pid <PID> | --pid-file <pid文件路径>] \
//     [--success <成功标记正则，默认 BG_SUCCESS>] [--fail <失败标记正则，默认 BG_FAIL>] \
//     [--hang-seconds 90] [--timeout 3600] \
//     [--check-every 60] [--progress "<带捕获组的进度正则，如 Rendered (\d+)/"] [--stall-limit 2]
// 两个层次的健康检测（用户硬规则 2026-10-10）:
//   A. 即时检测（每 2s）: 日志新增行命中成功/失败标记即定论；进程退出无成功标记 = BG_FAIL；
//      日志 --hang-seconds 无增长且进程存活 = BG_HANG；全局超时 = BG_HANG。
//   B. 周期健康检查（每 --check-every 秒，"只有正常运行才能下一步"）:
//      - 进程已死 -> 立即 BG_FAIL
//      - 可选 --progress: 正则捕获组的进度计数必须在检查点之间增长
//        （如 Remotion "Rendered (\d+)/"），连续 --stall-limit 个检查点无进展 -> BG_HANG progress-stalled
//      - 检查点日志字节数零增长 -> 记一次 stall
//      - 正常 -> 输出 "BG_HEALTHY <elapsed>s progress=<N> delta=<bytes>"（进 watcher 自身日志，不进对话）
// 定论输出: BG_SUCCESS <命中行> / BG_FAIL <原因> / BG_HANG <原因>；退出码 0/1/2/3。
// 约定: 后台任务必须在日志里以独特标记收尾（BG_SUCCESS ... / BG_FAIL ...），
//       并把自身 PID 写入 <日志路径>.pid（node: fs.writeFileSync; bash: echo $$ > file）。
import fs from 'node:fs';

function arg(k, d) { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; }
const LOG = arg('--log');
if (!LOG) { console.error('BG_FAIL watcher-missing --log'); process.exit(3); }
const PID_ARG = arg('--pid', 'none');
const PID_FILE = arg('--pid-file', '');
const RE_S = new RegExp(arg('--success', 'BG_SUCCESS'));
const RE_F = arg('--fail') ? new RegExp(arg('--fail')) : null;
const HANG = Number(arg('--hang-seconds', '90'));
const TIMEOUT = Number(arg('--timeout', '3600')) * 1000;
const CHECK_EVERY = Number(arg('--check-every', '60')) * 1000;
const RE_P = arg('--progress') ? new RegExp(arg('--progress')) : null;
const STALL_LIMIT = Number(arg('--stall-limit', '2'));

const pidAlive = () => {
  let pid = PID_ARG;
  if (pid === 'none' && PID_FILE && fs.existsSync(PID_FILE)) {
    pid = fs.readFileSync(PID_FILE, 'utf-8').trim();
  }
  if (!pid || pid === 'none') return true;
  try { process.kill(Number(pid), 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

let offset = 0; // 从头扫描：任务可能在 watcher 启动前就已结束
let lastGrow = Date.now();
let lastCheck = Date.now();
let lastProgress = -1;
let stalls = 0;
let lastCheckpointSize = 0;
const t0 = Date.now();
const pending = [];

function scan(chunk) {
  pending.push(chunk);
  let s = pending.join('');
  const lines = s.split('\n');
  pending.splice(0, pending.length, lines.pop());
  for (const line of lines) {
    if (RE_P) {
      const m = RE_P.exec(line);
      if (m && m[1] !== undefined) {
        const v = Number(m[1]);
        if (Number.isFinite(v) && v > maxProgress) maxProgress = v;
      }
    }
    const t = line.trim().slice(0, 200);
    if (RE_S.test(line)) { console.log(`BG_SUCCESS ${t}`); process.exit(0); }
    if (RE_F && RE_F.test(line)) { console.log(`BG_FAIL ${t}`); process.exit(1); }
  }
}
let maxProgress = -1;

function readNew() {
  if (!fs.existsSync(LOG)) return;
  const size = fs.statSync(LOG).size;
  if (size <= offset) return;
  const fd = fs.openSync(LOG, 'r');
  const b = Buffer.alloc(size - offset);
  fs.readSync(fd, b, 0, b.length, offset);
  fs.closeSync(fd);
  offset = size;
  lastGrow = Date.now();
  scan(b.toString('utf-8'));
}

function checkpoint() {
  const elapsed = Math.round((Date.now() - t0) / 1000);
  if (!pidAlive()) {
    try { readNew(); } catch {}
    console.log('BG_FAIL process-exited-without-success-marker');
    process.exit(1);
  }
  let stalled = false;
  if (RE_P) {
    if (maxProgress > lastProgress) {
      lastProgress = maxProgress;
    } else {
      stalled = true;
    }
  }
  if (lastCheckpointSize > 0 && offset === lastCheckpointSize) stalled = true;
  lastCheckpointSize = offset;
  if (stalled) {
    stalls++;
    console.log(`BG_STALLED check@${elapsed}s stalls=${stalls}/${STALL_LIMIT} progress=${maxProgress}`);
  } else {
    stalls = 0;
    console.log(`BG_HEALTHY check@${elapsed}s progress=${maxProgress} logBytes=${offset}`);
  }
  if (stalls >= STALL_LIMIT) {
    console.log(`BG_HANG progress-stalled-after-${elapsed}s log=${LOG}`);
    process.exit(2);
  }
}

for (;;) {
  try { readNew(); } catch {}
  if (!pidAlive()) {
    try { readNew(); } catch {} // 进程退出后再读一次尾部
    console.log('BG_FAIL process-exited-without-success-marker');
    process.exit(1);
  }
  if (Date.now() - lastGrow > HANG * 1000) {
    console.log(`BG_HANG no-log-growth-for-${HANG}s log=${LOG}`);
    process.exit(2);
  }
  if (Date.now() - t0 > TIMEOUT) {
    console.log(`BG_HANG timeout-after-${Math.round((Date.now() - t0) / 1000)}s log=${LOG}`);
    process.exit(2);
  }
  if (Date.now() - lastCheck >= CHECK_EVERY) {
    lastCheck = Date.now();
    checkpoint();
  }
  await new Promise(r => setTimeout(r, 2000));
}
