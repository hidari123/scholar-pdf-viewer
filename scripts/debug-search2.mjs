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
await page.goto('http://localhost:5189', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });
await page.locator('.scpdf-toolbar__btn[aria-label="搜索文档"]').click();
await page.waitForTimeout(500);
await page.locator('.scpdf-search__input').fill('harness');
await page.waitForTimeout(8000);
const nextBtn = page.locator('.scpdf-search .scpdf-toolbar__btn[aria-label="下一个"]');
for (let i = 0; i < 3; i++) {
  await nextBtn.click();
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.scpdf-annotation--search')];
    const active = document.querySelector('.scpdf-annotation--search-active');
    const ar = active?.getBoundingClientRect();
    return {
      total: all.length,
      activeIdx: active ? all.indexOf(active) : -1,
      activeRect: ar ? { left: Math.round(ar.left), top: Math.round(ar.top) } : null,
      first3: all.slice(0, 3).map((h) => {
        const r = h.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          top: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
    };
  });
  console.log(`第${i + 1}次点击:`, JSON.stringify(s));
}
await browser.close();
