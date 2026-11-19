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
// 列出前 12 个目录项 + 它们对应的页
const items = await page.evaluate(() =>
  [...document.querySelectorAll('.scpdf-outline__item')].map((b) => b.textContent),
);
console.log('目录项:', items.slice(0, 12).join(' | '));
const target = page.locator('.scpdf-outline__item').nth(9);
const title = await target.textContent();
await target.click();
await page.waitForTimeout(2500);
const state = await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  const pages = [...document.querySelectorAll('.scpdf-page')];
  // 找哪个页在视口顶部附近
  const cr = c.getBoundingClientRect();
  const visible = [];
  for (const p of pages) {
    const r = p.getBoundingClientRect();
    if (r.bottom > cr.top + 10 && r.top < cr.bottom - 10) {
      visible.push({ num: p.getAttribute('data-page-number'), top: Math.round(r.top - cr.top) });
    }
  }
  return { scrollTop: Math.round(c.scrollTop), visible };
});
console.log('点了:', title);
console.log('结果:', JSON.stringify(state));
await browser.close();
