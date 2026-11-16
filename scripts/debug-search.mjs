import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: parseInt(n.replace('chromium-', '')) || 0 }))
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
await page.goto('http://localhost:5190', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });
await page.locator('.scpdf-toolbar__btn[aria-label="搜索文档"]').click();
await page.waitForTimeout(500);
await page.locator('.scpdf-search__input').fill('harness');
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const hs = [...document.querySelectorAll('.scpdf-annotation--search')];
  const pages = new Set();
  for (const h of hs) {
    const p = h.closest('.scpdf-page');
    if (p) pages.add(p.dataset.pageNumber);
  }
  const c = document.querySelector('.scpdf-container');
  return {
    count: hs.length,
    pages: [...pages],
    scrollTop: c?.scrollTop,
    containerRect: c
      ? {
          top: Math.round(c.getBoundingClientRect().top),
          bottom: Math.round(c.getBoundingClientRect().bottom),
        }
      : null,
    firstRects: hs.slice(0, 3).map((h) => {
      const r = h.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top) };
    }),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
