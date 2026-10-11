// 句级强制对齐：用段内 TTS 音频的静音间隙反推每句字幕的真实起点
//
// 解决什么问题：
//   subs/s01.json 里的 t 是文案阶段按 4–4.5 字/秒估算的，TTS 实际语速有快有慢，
//   估算 t 与语音存在句级偏差（字幕早出/晚出）。本脚本在每段音频内部检测
//   静音间隙 → 得到语音区间 → 与字幕句对齐 → 用实测起点替换估算 t。
//
// 三级对齐策略（自动选择）：
//   1:1       语音区间数 == 句数 → 逐句映射（最准）
//   merge     区间多、句少 → 不断合并最小间隙的相邻区间直到数量一致
//             （标点处的小停顿被并入句内，句间大停顿保留）
//   charshare 区间少于句数 / 无静音可检 → 区间内按字数占比分摊，
//             或整段按字数分摊（退化为原估算，但锚定在语音区间上）
//
// 输出格式不变：[{t, text}]（t=段内秒偏移），build-timeline.mjs 无需改动。
//
// 用法:
//   node align-subs.mjs --tts tts/ --subs subs/ [--out subs/] [--in-place] \
//     [--noise -35dB] [--d 0.15] [--gap 0.3]
//
// 参数:
//   --tts    TTS 音频目录（<段id>.wav / .mp3）
//   --subs   字幕目录（<段id>.json，估算 t）
//   --out    输出目录（默认 <subs>-aligned；--in-place 时写回原目录并备份 .bak）
//   --noise  静音判定阈值（默认 -35dB）
//   --d      最短静音时长（默认 0.15s，低于此视为句内停顿）
//   --gap    句间停顿下限（默认 0.3s，区间合并时保留的最小间隙）
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : (i > -1 ? true : def);
}

const TTS = arg('tts'), SUBS = arg('subs');
if (!TTS || !SUBS) {
  console.error('用法: node align-subs.mjs --tts <dir> --subs <dir> [--out <dir>] [--in-place] [--noise -35dB] [--d 0.15] [--gap 0.3]');
  process.exit(1);
}
const NOISE = arg('noise', '-35dB');
const D = arg('d', 0.15);
const GAP = arg('gap', 0.3);
const IN_PLACE = !!arg('in-place');
const OUT = IN_PLACE ? SUBS : arg('out', SUBS.replace(/\/?$/, '') + '-aligned');

function runFF(args) {
  const r = spawnSync('ffmpeg', ['-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  return r.stderr ? r.stderr.toString() : '';
}
function probeDuration(file) {
  // 本机 ffprobe 走 Node spawnSync 会 EBUSY，用 ffmpeg Duration 解析
  const m = runFF(['-i', file, '-f', 'null', '-']).match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : NaN;
}

// 静音检测 → 语音区间（秒）
function speechIntervals(file, dur) {
  const log = runFF(['-i', file, '-af', `silencedetect=noise=${NOISE}:d=${D}`, '-f', 'null', '-']);
  const sil = [];
  for (const m of log.matchAll(/silence_start:\s*(-?[\d.]+)/g)) sil.push({ s: Math.max(0, +m[1]) });
  let i = 0;
  for (const m of log.matchAll(/silence_end:\s*([\d.]+)/g)) { if (sil[i]) sil[i].e = +m[1]; i++; }
  const iv = [];
  let cur = 0;
  for (const { s, e } of sil) {
    if (s > cur) iv.push({ a: cur, b: Math.min(s, dur) });
    cur = e ?? dur;
  }
  if (cur < dur) iv.push({ a: cur, b: dur });
  return iv.filter(x => x.b - x.a > 0.02);
}

// 合并区间直到数量 == n（每次合并间隙最小的相邻对）
function mergeTo(intervals, n) {
  const iv = intervals.map(x => ({ ...x }));
  while (iv.length > n) {
    let bi = 0, bg = Infinity;
    for (let i = 0; i < iv.length - 1; i++) {
      const g = iv[i + 1].a - iv[i].b;
      if (g < bg) { bg = g; bi = i; }
    }
    iv[bi].b = iv[bi + 1].b;
    iv.splice(bi + 1, 1);
  }
  return iv;
}

// 句子按字数占比在区间 [a,b] 内分摊起点
function charShareStarts(sents, a, b) {
  const lens = sents.map(s => Math.max(1, [...s.text.replace(/[，。：；、？——…\s]/g, '')].length));
  const total = lens.reduce((x, y) => x + y, 0);
  const span = b - a;
  let c = a;
  return lens.map(l => { const t = c; c += span * (l / total); return t; });
}

mkdirSync(OUT, { recursive: true });
const ids = readdirJsonIds(SUBS);
let report = [];
for (const id of ids) {
  const sents = JSON.parse(readFileSync(path.join(SUBS, `${id}.json`), 'utf-8'));
  const file = ['wav', 'mp3'].map(e => path.join(TTS, `${id}.${e}`)).find(existsSync);
  if (!file) { console.error(`跳过 ${id}: 缺 TTS 音频`); report.push(`${id} SKIP`); continue; }
  const dur = probeDuration(file);
  if (Number.isNaN(dur)) { console.error(`跳过 ${id}: 读不到音频时长`); report.push(`${id} SKIP`); continue; }

  let starts, method;
  let iv = speechIntervals(file, dur);
  // 先把窄于 gap 的间隙合并掉（句内停顿），形成候选语音块
  const blocks = [];
  for (const x of iv) {
    const last = blocks[blocks.length - 1];
    if (last && x.a - last.b < GAP) last.b = x.b;
    else blocks.push({ ...x });
  }

  if (blocks.length === sents.length) {
    starts = blocks.map(x => x.a); method = '1:1';
  } else if (blocks.length > sents.length) {
    starts = mergeTo(blocks, sents.length).map(x => x.a); method = 'merged';
  } else if (blocks.length >= 1) {
    starts = charShareStarts(sents, blocks[0].a, blocks[blocks.length - 1].b); method = 'charshare';
  } else {
    starts = charShareStarts(sents, 0, dur); method = 'fallback';
  }

  // 起点提前 0.08s 提亮（人耳对字幕晚出的容忍低于早出），夹紧到 [0, dur-0.2] 并保单调
  const aligned = sents.map((s, i) => ({
    ...s,
    t: +Math.max(0, Math.min(dur - 0.2, starts[i] - 0.08)).toFixed(3),
  }));
  for (let i = 1; i < aligned.length; i++) {
    if (aligned[i].t < aligned[i - 1].t) aligned[i].t = aligned[i - 1].t;
  }

  const dest = path.join(OUT, `${id}.json`);
  if (IN_PLACE) copyFileSync(dest, dest + '.bak');
  writeFileSync(dest, JSON.stringify(aligned, null, 1), 'utf-8');

  const maxDev = Math.max(...sents.map((s, i) => Math.abs((aligned[i].t) - (s.t ?? 0))));
  report.push(`${id} ${method} maxΔ=${maxDev.toFixed(2)}s`);
}
console.log(report.join('\n'));
console.log(`ALIGNED -> ${OUT}`);
function readdirJsonIds(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.bak')).map(f => f.replace(/\.json$/, ''));
}
