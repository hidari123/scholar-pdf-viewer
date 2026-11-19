import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: parseInt(n.replace('chromium-', ''), 10) || 0 }))
  .sort((a, b) => b.v - a.v);
let exe;
for (const d of dirs) {
  const e = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe');
  if (existsSync(e)) {
    exe = e;
    break;
  }
}
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') ?? '').includes('目录'),
  );
  btn?.click();
});
await page.waitForTimeout(1200);
const before = await page.evaluate(() => document.querySelector('.scpdf-container')?.scrollTop);
console.log('点击前 scrollTop:', before);
const items = page.locator('.scpdf-outline__item');
console.log('目录项数:', await items.count());
// 点第 10 个
await items.nth(9).click();
await page.waitForTimeout(2000);
const after = await page.evaluate(() => document.querySelector('.scpdf-container')?.scrollTop);
console.log('点击后 scrollTop:', after, ' 变化:', after - before);
// 面板还在吗？
console.log('面板还在:', await page.evaluate(() => !!document.querySelector('.scpdf-outline')));
await browser.close();
