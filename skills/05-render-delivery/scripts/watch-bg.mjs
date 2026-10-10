#!/usr/bin/env node
// 通用后台任务前台看护器（零依赖，Node >= 18）
// 用法:
//   node watch-bg.mjs --log <日志文件> [--pid <PID> | --pid-file <pid文件路径>] \
//     [--success <成功标记正则，默认 BG_SUCCESS>] [--fail <失败标记正则，默认 BG_FAIL>] \
//     [--hang-seconds 90] [--timeout 3600]
// 行为（每 2s 一轮，非 sleep 空等）:
//   - 增量读取日志新行，命中成功标记 -> 打印 "BG_SUCCESS <命中行>" 退出码 0
//   - 命中失败标记 -> 打印 "BG_FAIL <命中行>" 退出码 1
//   - 后台进程已退出但日志无成功标记 -> "BG_FAIL process-exited-without-success-marker" 退出码 1
//   - 日志 --hang-seconds 无增长且进程仍存活 -> "BG_HANG no-log-growth-for-<N>s" 退出码 2
//   - 全局超过 --timeout 秒 -> "BG_HANG timeout-after-<N>s" 退出码 2
//   - 参数错误退出码 3
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
const t0 = Date.now();
const pending = [];

function scan(chunk) {
  pending.push(chunk);
  let s = pending.join('');
  const lines = s.split('\n');
  pending.splice(0, pending.length, lines.pop());
  for (const line of lines) {
    const t = line.trim().slice(0, 200);
    if (RE_S.test(line)) { console.log(`BG_SUCCESS ${t}`); process.exit(0); }
    if (RE_F && RE_F.test(line)) { console.log(`BG_FAIL ${t}`); process.exit(1); }
  }
}

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
  await new Promise(r => setTimeout(r, 2000));
}
