// 构建 timeline.json：段落绝对时间 + 逐句字幕 + 章节进度
// （实战项目 RADWIMPS 专题视频的真实构建器，泛化为通用模板）
// 用法: node build-timeline.mjs
// 输入: ./durations.json      {"s01": 8.2, "s02": 11.7, ...}  （TTS 实测时长表）
//       ./public/subs/s01.json  每段逐句字幕 [{"t": 0.4, "text": "..."}]  t=段内秒偏移
// 输出: ./public/data/timeline.json
import { readFileSync, writeFileSync } from 'fs';

const durs = JSON.parse(readFileSync('./durations.json', 'utf-8'));

const GAP = 0.55; // 段间呼吸
const ids = Object.keys(durs).filter(k => k !== '_total');

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

let t = 0.4; // 片头留白
const segments = [], subtitles = [];
for (const id of ids) {
  const dur = durs[id];
  segments.push({ id, from: +t.toFixed(3), dur: +dur.toFixed(3), chapter: chOf(id).name });
  const sents = JSON.parse(readFileSync(`./public/subs/${id}.json`, 'utf-8'));
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    const start = t + s.t;
    const end = i + 1 < sents.length ? t + sents[i + 1].t : t + dur + 0.15;
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
  t += dur + GAP;
}

const total = t + 1.2;
const chapters = CHAPTERS.map(c => ({ name: c.name, from: segments.find(s => s.id === c.ids[0]).from }));

writeFileSync('./public/data/timeline.json', JSON.stringify({ segments, subtitles, chapters, total }, null, 1), 'utf-8');
console.log('segments', segments.length, 'subs', subtitles.length, 'total', total.toFixed(1), 's');
