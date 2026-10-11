// 构建 timeline.json：段落绝对时间 + 逐句字幕 + 章节进度 + 音频混音清单
// （实战项目 RADWIMPS 专题视频的真实构建器，泛化为通用模板）
//
// 声画同步核心纪律：
//   一切时间以「整数帧」为最小单位。本脚本输出前把片头留白、段间呼吸、
//   每段 from/dur 全部量化到 FPS 帧网格；视频 Sequence 和音频 adelay
//   都消费这份量化后的数值（音频偏移 = audioOffsetMs，由帧数换算），
//   两条轨共用同一组数，从机制上排除漂移。
//   禁止下游用 durations.json 重新累加偏移（漏片头留白 = 全片恒定偏移，
//   GAP 取值不一致 = 逐段累计漂移）。
//
// 用法: FPS=30 node build-timeline.mjs
// 输入: ./durations.json      {"s01": 8.2, "s02": 11.7, ...}  （TTS 实测时长表）
//       ./public/subs/s01.json  每段逐句字幕 [{"t": 0.4, "text": "..."}]  t=段内秒偏移
// 输出: ./public/data/timeline.json
import { readFileSync, writeFileSync } from 'fs';

const FPS = Number(process.env.FPS || 30); // 必须与 Remotion Composition 的 fps 一致
const LEAD_IN_S = 0.4;  // 片头留白
const GAP_S = 0.55;     // 段间呼吸
const TAIL_S = 1.2;     // 结尾页留白

const durs = JSON.parse(readFileSync('./durations.json', 'utf-8'));
const ids = Object.keys(durs).filter(k => k !== '_total');

// 秒 -> 整数帧（唯一的换算入口，后面所有时间都先经过它）
const qf = sec => Math.round(sec * FPS);
// 整数帧 -> 秒（换算回秒必须除帧数，避免二次舍入误差）
const f2s = f => +(f / FPS).toFixed(6);

// 章节划分：按内容结构把段落分组（示例保留 RADWIMPS 项目的分幕，可替换成你自己的）
const CHAPTERS = [
  { name: '开场', ids: ['s01', 's02', 's03'] },
  { name: '第一幕', ids: ['s04', 's05', 's06'] },
  { name: '第二幕', ids: ['s07', 's08', 's09'] },
  // ...按你的分幕继续
];
const chOf = id => CHAPTERS.find(c => c.ids.includes(id)) || { name: '正文' };

// 中文字幕换行：标点优先断行，数字/小数点/省略号不拆开
function wrap(text, max = 21) {
  const chars = [...text];
  const parts = [];
  let cur = '';
  const push = () => { if (cur) { parts.push(cur); cur = ''; } };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const nxt = chars[i + 1];
    const numNext = nxt !== undefined &&
      ((/[0-9]/.test(ch) && /[.0-9%％]/.test(nxt)) ||
       (ch === '.' && /[0-9]/.test(nxt)) ||
       (ch === '—' && nxt === '—'));
    cur += ch;
    if (!numNext && '，。：；？——、'.includes(ch) && cur.length >= Math.min(14, max - 6)) push();
    else if (!numNext && cur.length >= max) push();
  }
  push();
  const out = [];
  for (const p of parts) {
    if (out.length && (out[out.length - 1] + p).length <= max) out[out.length - 1] += p;
    else out.push(p);
  }
  return out;
}

// 超长句按标点切块（55 字以内一块），时间按字数占比分摊
function splitLong(text, maxLen = 55) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let cur = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    cur += ch;
    if (ch === '—' && chars[i + 1] === '—') continue;
    if (cur.length >= maxLen && '，。；：、'.includes(ch)) { chunks.push(cur); cur = ''; }
    else if (cur.length >= maxLen + 14) { chunks.push(cur); cur = ''; }
  }
  if (cur) {
    if (chunks.length && chunks[chunks.length - 1].length + cur.length <= maxLen + 12) chunks[chunks.length - 1] += cur;
    else chunks.push(cur);
  }
  return chunks;
}

const GAP_F = qf(GAP_S);          // 段间呼吸，量化到整数帧
let fromF = qf(LEAD_IN_S);        // 片头留白，同样落在帧网格上
const segments = [], subtitles = [];
for (const id of ids) {
  const durF = Math.max(1, qf(durs[id])); // 段时长量化到整数帧
  segments.push({
    id,
    fromF, durF,                  // 整数帧：视频 Sequence 直接消费（from={s.fromF} durationInFrames={s.durF}）
    from: f2s(fromF),             // 秒值：已是帧对齐的秒，仅供阅读/参考
    dur: f2s(durF),
    audioOffsetMs: Math.round(fromF / FPS * 1000), // 音频用：混音 adelay 偏移，与 fromF 同源
    chapter: chOf(id).name,
  });
  const t = f2s(fromF); // 段内字幕相对量照旧用秒
  const sents = JSON.parse(readFileSync(`./public/subs/${id}.json`, 'utf-8'));
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    const start = t + s.t;
    const end = i + 1 < sents.length ? t + sents[i + 1].t : t + f2s(durF) + 0.15;
    const dur1 = Math.max(end, start + 1) - start;
    const chunks = splitLong(s.text);
    const totalLen = chunks.reduce((a, c) => a + [...c].length, 0);
    let ct = start;
    for (const ck of chunks) {
      const share = dur1 * ([...ck].length / totalLen);
      const from = ct, to = ct + share;
      subtitles.push({ from: +from.toFixed(3), to: +to.toFixed(3), lines: wrap(ck) });
      ct = to;
    }
  }
  fromF += durF + GAP_F;
}

// 视频总长：最后一段起点 + 段长 + 结尾留白（全部帧量化后换算）
const totalFrames = fromF - GAP_F + qf(TAIL_S);
const total = f2s(totalFrames);
// 视频总帧数：Composition durationInFrames 直接用它
const durationInFrames = totalFrames;
const chapters = CHAPTERS
  .filter(c => c.ids.some(id => segments.some(s => s.id === id)))
  .map(c => ({ name: c.name, from: segments.find(s => s.id === c.ids[0]).from }));

// 音频混音清单：音频总长 = 最后一段语音结束点；补静音到 total + 1s
// （下游 mux 用 -shortest 时必须保证音频比视频长，否则视频结尾被裁）
const lastSeg = segments[segments.length - 1];
const voiceEnd = +(lastSeg.from + lastSeg.dur).toFixed(3);

writeFileSync('./public/data/timeline.json', JSON.stringify({
  fps: FPS,
  durationInFrames,
  segments, subtitles, chapters, total,
  audio: { voiceEndSec: voiceEnd, padToSec: +(total + 1).toFixed(3) },
}, null, 1), 'utf-8');
console.log(`fps=${FPS} segments=${segments.length} subs=${subtitles.length} total=${total.toFixed(1)}s (${durationInFrames} frames) voiceEnd=${voiceEnd.toFixed(1)}s`);
console.log('音频偏移已内嵌 segments[].audioOffsetMs，混音脚本直接消费，禁止重新累加');
