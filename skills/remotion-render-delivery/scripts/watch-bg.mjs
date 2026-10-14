#!/usr/bin/env node
// 后台任务看护器（零依赖，Node >= 18）。两种模式：
//   1) 阻塞等定论（默认）：前台阻塞，盯日志直到出现退出标记，输出定论并退出。
//      这就是通用的"继续"方式——前台命令 + 退出码是所有工具都有的能力，
//      不依赖任何推送通知。工具前台时限短就传小的 --timeout：
//      到期任务还在跑 → BG_RUNNING(exit 4)，重跑同一条命令即可接力
//      （无状态，每次从头扫日志，代价可忽略）。
//   2) 健康门（--gate）：任务启动后跑一次，确认"正常运行"即放行下一步（exit 0）。
// 检测的都是事实：日志新增行（成功/失败标记/进度计数）+ 日志是否在增长。
// 不做 PID 检测：Windows 下 bash(MSYS)/Node/PowerShell 的 PID 语义互不兼容，坑大于收益。
// 存活的判据 = 日志仍在增长；静默死亡会被判 BG_HANG，处理动作与失败相同（读日志尾部定位）。
//
// 用法:
//   node watch-bg.mjs --log <日志文件> [--success <正则,默认BG_SUCCESS>] [--fail <正则,默认BG_FAIL>]
//     [--hang-seconds 90] [--timeout 3600] [--check-every 15]
//     [--progress "<带捕获组的进度正则>"] [--stall-limit 2] [--gate]
// 输出与退出码（唯一、可 grep）:
//   BG_SUCCESS <命中行>            0   任务成功
//   BG_HEALTHY gate-passed ...     0   --gate 模式：任务已确认正常运行
//   BG_FAIL <原因>                 1   任务失败
//   BG_HANG <原因>                 2   日志停摆/进度停滞（读日志尾部定位原因）
//   BG_RUNNING <原因>              4   到 --timeout 仍在跑：重跑同一条命令继续等
// 约定: 后台任务的日志必须以独特标记收尾——BG_SUCCESS <任务> output=<路径> / BG_FAIL <任务> reason=<...>。
import fs from 'node:fs';

function arg(k, d) { const i = process.argv.indexOf(k); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; }
const LOG = arg('--log');
if (!LOG) { console.error('BG_FAIL watcher-missing --log'); process.exit(3); }
const RE_S = new RegExp(arg('--success', 'BG_SUCCESS'));
const RE_F = new RegExp(arg('--fail', 'BG_FAIL'));
const HANG = Number(arg('--hang-seconds', '90')) * 1000;
const TIMEOUT = Number(arg('--timeout', '3600')) * 1000;
const CHECK_EVERY = Number(arg('--check-every', '15')) * 1000;
const RE_P = arg('--progress') ? new RegExp(arg('--progress')) : null;
const STALL_LIMIT = Number(arg('--stall-limit', '2'));
const GATE = process.argv.includes('--gate');

let offset = 0;          // 从头扫描：任务可能在 watcher 启动前就已结束
let sawLog = false;      // 日志文件是否出现过（区分"从未产出日志"和"日志停摆"）
let maxProgress = -1;    // --progress 捕获到的最大计数
let lastGrow = Date.now();
let lastCheck = Date.now();
let lastCheckProgress = -1;
let lastCheckBytes = 0;
let stalls = 0;
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

function readNew() {
  if (!fs.existsSync(LOG)) return;
  sawLog = true;
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
  const progressAdvanced = !RE_P || maxProgress > lastCheckProgress;
  const bytesGrew = offset > lastCheckBytes;
  if (progressAdvanced && bytesGrew) {
    stalls = 0;
    console.log(`BG_HEALTHY check@${elapsed}s progress=${maxProgress} logBytes=${offset}`);
    if (GATE) {
      console.log(`BG_HEALTHY gate-passed task-running-normally log=${LOG}`);
      process.exit(0);
    }
  } else {
    stalls++;
    console.log(`BG_STALLED check@${elapsed}s stalls=${stalls}/${STALL_LIMIT} progress=${maxProgress} logBytes=${offset}`);
  }
  lastCheckProgress = maxProgress;
  lastCheckBytes = offset;
  if (stalls >= STALL_LIMIT) {
    console.log(`BG_HANG progress-stalled-after-${elapsed}s log=${LOG}`);
    process.exit(2);
  }
}

for (;;) {
  try { readNew(); } catch {}
  if (Date.now() - lastGrow > HANG) {
    if (!sawLog) {
      console.log(`BG_HANG log-missing-for-${Math.round(HANG / 1000)}s log=${LOG}（多半是重定向目录不存在/任务没起来）`);
    } else {
      console.log(`BG_HANG no-log-growth-for-${Math.round(HANG / 1000)}s log=${LOG}`);
    }
    process.exit(2);
  }
  if (Date.now() - t0 > TIMEOUT) {
    console.log(`BG_RUNNING watcher-timeout-after-${Math.round((Date.now() - t0) / 1000)}s-still-running log=${LOG}`);
    process.exit(4);
  }
  if (Date.now() - lastCheck >= CHECK_EVERY) {
    lastCheck = Date.now();
    checkpoint();
  }
  await new Promise(r => setTimeout(r, 2000));
}
