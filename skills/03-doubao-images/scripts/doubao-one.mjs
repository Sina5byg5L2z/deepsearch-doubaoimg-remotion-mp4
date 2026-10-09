// 用法: node doubao-one.mjs <输出目录> <名称前缀> <提示词...>
// 发送一条提示词到豆包 → 轮询生成完成 → 下载新出现的图片 → 退出
// 退出码: 0 成功 / 1 参数或页面错误 / 2 生成超时
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const [, , OUTDIR, PREFIX, ...rest] = process.argv;
const PROMPT = rest.join(' ');
if (!OUTDIR || !PREFIX || !PROMPT) { console.error('args: <outdir> <prefix> <prompt>'); process.exit(1); }
mkdirSync(OUTDIR, { recursive: true });

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 15000 });
const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('doubao.com'));
if (!page) { page = await ctx.newPage(); await page.goto('https://www.doubao.com/chat/'); await page.waitForTimeout(5000); }
await page.bringToFront();

const getImgs = () => page.evaluate(() => {
  const out = [];
  for (const img of document.querySelectorAll('img')) {
    const s = img.currentSrc || img.src;
    if (!s || !s.startsWith('http')) continue;
    if (img.naturalWidth < 500) continue;
    out.push(s);
  }
  return out;
});

const before = new Set(await getImgs());

const input = page.locator('[contenteditable="true"]').first();
const ta = page.locator('textarea').first();
const target = (await input.count()) ? input : ta;
await target.click();
await target.fill('');
await target.type(PROMPT, { delay: 15 });
await page.waitForTimeout(600);
await page.keyboard.press('Enter');
console.log('SENT', PREFIX);

// 轮询：「停止生成」消失 + 有新图 URL 出现，双条件才算完成
let done = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(5000);
  let gen = true;
  try { gen = await page.evaluate(() => document.body.innerText.includes('停止生成')); } catch {}
  if (!gen) {
    const now = await getImgs();
    if (now.some(s => !before.has(s))) { done = true; break; }
  }
  console.log('poll', i + 1, 'generating=', gen);
}
if (!done) { console.log('TIMEOUT'); process.exit(2); }

const now = await getImgs();
const fresh = [...new Set(now.filter(s => !before.has(s)))];
console.log('NEW_IMGS', fresh.length);
let n = 0;
for (const src of fresh) {
  try {
    // 共享浏览器 cookie 下载原图（直接抓 img.src 会拿到缩略图）
    const resp = await ctx.request.get(src, { headers: { Referer: 'https://www.doubao.com/' } });
    const buf = await resp.body();
    const ext = src.includes('.jpeg') || src.includes('.jpg') ? '.jpg' : '.png';
    const fp = path.join(OUTDIR, `${PREFIX}_${n}${ext}`);
    writeFileSync(fp, buf);
    console.log('SAVED', fp, buf.length);
    n++;
  } catch (e) { console.log('DL_FAIL', String(e).slice(0, 120)); }
}
console.log('DONE', n);
process.exit(0);
