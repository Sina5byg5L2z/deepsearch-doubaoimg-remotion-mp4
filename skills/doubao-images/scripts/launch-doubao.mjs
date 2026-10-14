// 拉起豆包 Chrome（detached，父进程退出后仍存活），等待 CDP 就绪后退出
// 用法: node launch-doubao.mjs   （需先 npm i playwright-core）
// 环境变量: CHROME_PATH（默认 "C:/Program Files/Google/Chrome/Application/chrome.exe"）
import { chromium } from 'playwright-core';
import { spawn } from 'child_process';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const USER_DIR = process.env.CHROME_PROFILE || './.chrome-doubao';
const CDP = 'http://127.0.0.1:9222';

let browser = null;
try {
  browser = await chromium.connectOverCDP(CDP, { timeout: 3000 });
  console.log('CONNECTED_EXISTING');
} catch {
  spawn(CHROME, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${USER_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    'https://www.doubao.com/chat/',
  ], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 45; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try { browser = await chromium.connectOverCDP(CDP, { timeout: 3000 }); break; } catch {}
  }
}
if (!browser) { console.log('FAIL_LAUNCH'); process.exit(1); }

const ctx = browser.contexts()[0];
let page = ctx.pages().find(p => p.url().includes('doubao.com'));
if (!page) page = await ctx.newPage();
if (!page.url().includes('doubao.com')) {
  await page.goto('https://www.doubao.com/chat/', { waitUntil: 'domcontentloaded', timeout: 45000 });
}
await page.waitForTimeout(3000);
const t = await page.evaluate(() => (document.body.innerText || '').slice(0, 100));
console.log('CDP_READY page_snippet=', JSON.stringify(t));
process.exit(0);
