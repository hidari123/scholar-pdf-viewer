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
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(2500);
await page.evaluate(() => {
  const el = document.querySelector('.scpdf-page[data-page-number="2"]');
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  if (c) c.scrollTop -= 500;
});
await page.waitForTimeout(1500);
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const c = document.querySelector('.scpdf-container');
      const pages = [...document.querySelectorAll('.scpdf-page')].slice(0, 3).map((p) => {
        const r = p.getBoundingClientRect();
        return {
          page: p.getAttribute('data-page-number'),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          spans: p.querySelectorAll('.scpdf-text-layer__item').length,
        };
      });
      return {
        scrollTop: c?.scrollTop,
        containerTop: c ? Math.round(c.getBoundingClientRect().top) : null,
        pages,
      };
    }),
    null,
    1,
  ),
);
await browser.close();
