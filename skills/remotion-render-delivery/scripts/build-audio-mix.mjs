// 构建 mix_full.wav：以 timeline.json 为唯一偏移来源的多段 TTS 混音
//
// 声画同步核心纪律：
//   每段 TTS 的定位偏移直接读 timeline.json 的 segments[].audioOffsetMs
//   （由整数帧换算，与视频 Sequence 同源）。禁止用 durations.json 重新累加——
//   漏掉片头留白 = 全片恒定偏移；GAP 取值与 timeline 不一致 = 逐段累计漂移。
//
// 用法:
//   node build-audio-mix.mjs --timeline public/data/timeline.json --tts tts/ --out out/mix_full.wav \
//     [--bgm bgm.mp3 --bgm-gain 0.12 --duck] [--loudnorm]
//
// 参数:
//   --timeline   timeline.json 路径（必须，偏移来源）
//   --tts        TTS 音频目录，文件名 = <段id>.wav（也接受 .mp3）
//   --out        输出 wav 路径
//   --bgm        可选背景音乐，自动 loop 到全片长
//   --bgm-gain   BGM 音量（默认 0.12）
//   --duck       BGM 在人声段自动闪避（sidechaincompress，人声作侧链）
//   --loudnorm   两遍响度归一（I=-16 LUFS，先测后带 measured 线性压）
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : (i > -1 ? true : def);
}

const TL = arg('timeline');
const TTS = arg('tts');
const OUT = arg('out');
if (!TL || !TTS || !OUT) {
  console.error('用法: node build-audio-mix.mjs --timeline <timeline.json> --tts <dir> --out <mix.wav> [--bgm f --bgm-gain .12 --duck] [--loudnorm]');
  process.exit(1);
}
const BGM = arg('bgm');
const BGM_GAIN = Number(arg('bgm-gain', 0.12));
const DUCK = !!arg('duck');
const LOUDNORM = !!arg('loudnorm');

const tl = JSON.parse(readFileSync(TL, 'utf-8'));
const { fps, segments, audio } = tl;
if (!fps || !segments?.length) { console.error('timeline.json 缺 fps/segments，请用新版 build-timeline.mjs 生成'); process.exit(1); }

function runFF(args, tag, captureStderr = false) {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', captureStderr ? 'info' : 'error', ...args],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`${tag} 失败:\n${r.stderr}`); process.exit(1); }
  return captureStderr ? r.stderr.toString() : '';
}

// ---- 1. 校验：偏移必须与整数帧换算一致、单调不重叠、TTS 文件齐全 ----
const inputs = [], voiceLabels = [];
segments.forEach((s, i) => {
  const file = ['wav', 'mp3'].map(e => path.join(TTS, `${s.id}.${e}`)).find(existsSync);
  if (!file) { console.error(`缺少 TTS 音频: ${s.id}.wav / .mp3`); process.exit(1); }
  const expectMs = Math.round(s.fromF / fps * 1000);
  if (s.audioOffsetMs !== expectMs) { console.error(`${s.id} audioOffsetMs(${s.audioOffsetMs}) != fromF 换算(${expectMs})，timeline 已损坏`); process.exit(1); }
  if (i > 0 && s.audioOffsetMs < segments[i - 1].audioOffsetMs) { console.error(`${s.id} 偏移乱序`); process.exit(1); }
  inputs.push('-i', file);
  // aformat 统一采样率/声道 -> adelay 毫秒定位（all=1 兼容任意声道数）
  voiceLabels.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${s.audioOffsetMs}:all=1[n${i}]`);
});

// padToSec = 视频总长 + 1s：下游 mux 用 -shortest 时音频必须比视频长，否则视频结尾被裁
const padTo = audio?.padToSec ?? +(tl.total + 1).toFixed(3);
const n = segments.length;

// ---- 2. 汇总链：人声 amix -> （可选 BGM/闪避）-> apad 补静音 -> （可选 loudnorm）----
// 各段偏移不重叠，amix normalize=0 保持原始电平不衰减
const mixIn = Array.from({ length: n }, (_, i) => `[n${i}]`).join('');
const fcParts = [voiceLabels.join(';'), `${mixIn}amix=inputs=${n}:normalize=0:dropout_transition=0[vo0]`];
// BGM 输入序号 = n（loop 到全片长）
const bgmArgs = BGM ? ['-stream_loop', '-1', '-i', BGM] : [];

if (BGM) {
  if (!existsSync(BGM)) { console.error(`缺少 BGM: ${BGM}`); process.exit(1); }
  // loop 的 BGM 无限长，必须 atrim 截到 padTo，否则 amix(longest) 永不结束
  fcParts.push(`[${n}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${BGM_GAIN},atrim=0:${padTo}[bgm0]`);
  if (DUCK) {
    // 人声 asplit：一路进成片，一路作 sidechain 侧链压 BGM（人声抬 6dB 提高检测灵敏度）
    fcParts.push(
      `[vo0]asplit=2[vo1][sc];[sc]volume=6dB[scg]`,
      `[bgm0][scg]sidechaincompress=threshold=0.03:ratio=8:attack=80:release=600[bgmd]`,
      `[vo1][bgmd]amix=inputs=2:normalize=0:dropout_transition=0[voF]`,
    );
  } else {
    fcParts.push(`[vo0][bgm0]amix=inputs=2:normalize=0:dropout_transition=0[voF]`);
  }
} else {
  fcParts.push(`[vo0]anull[voF]`);
}
// 补静音到 padToSec（在 loudnorm 之前补，静音段不参与响度测量统计）
fcParts.push(`[voF]apad=whole_dur=${padTo}[padded]`);
const LN = 'loudnorm=I=-16:TP=-1.5:LRA=11';
fcParts.push(LOUDNORM ? `[padded]__LN__[voice]` : `[padded]anull[voice]`);
let fc = fcParts.join(';');

// ---- 3. 两遍 loudnorm（可选）：先测 input_i/tp/lra/threshold，再带 measured 线性压 ----
if (LOUDNORM) {
  const out1 = runFF([...inputs, ...bgmArgs, '-filter_complex', fc.replace('__LN__', `${LN}:print_format=json`),
    '-map', '[voice]', '-f', 'null', '-'], 'loudnorm-pass1', true);
  const m = out1.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  if (m) {
    const j = JSON.parse(m[0]);
    fc = fc.replace('__LN__',
      `${LN}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`);
    console.log(`loudnorm 测量: I=${j.input_i} TP=${j.input_tp} LRA=${j.input_lra}`);
  } else {
    fc = fc.replace('__LN__', LN);
    console.log('loudnorm 测量解析失败，回落单遍模式');
  }
}

// ---- 4. 正式混音 ----
mkdirSync(path.dirname(OUT), { recursive: true });
runFF([...inputs, ...bgmArgs, '-filter_complex', fc, '-map', '[voice]',
  '-ar', '48000', '-c:a', 'pcm_s16le', OUT], 'mix');

// ---- 5. 校验：混音时长必须 == padToSec（±0.1s）----
// 本机 Node spawnSync 起 ffprobe 会 EBUSY（ffmpeg 正常），优先用 ffmpeg 解析时长
function probeDuration(file) {
  const r = spawnSync('ffmpeg', ['-i', file, '-f', 'null', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  const m = r.stderr?.toString().match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return p.stdout ? +p.stdout.toString().trim() : NaN;
}
const dur = probeDuration(OUT);
if (Number.isNaN(dur)) { console.error('无法读取混音时长'); process.exit(1); }
console.log(`MIX_DURATION=${dur}`);
if (Math.abs(dur - padTo) > 0.1) { console.error(`SYNC_CHECK_FAIL 混音时长 ${dur} != 期望 ${padTo}，检查 apad/atrim`); process.exit(1); }
console.log(`SYNC_CHECK_OK offsets=from timeline.json (fps=${fps}) padTo=${padTo}`);
console.log(`DONE ${OUT}`);
