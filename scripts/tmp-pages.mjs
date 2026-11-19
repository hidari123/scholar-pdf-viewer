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
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.scpdf-page')].slice(0, 4);
      return pages.map((p) => {
        const r = p.getBoundingClientRect();
        return {
          page: p.getAttribute('data-page-number'),
          top: Math.round(r.top),
          height: Math.round(r.height),
          spans: p.querySelectorAll('.scpdf-text-layer__item').length,
        };
      });
    }),
    null,
    1,
  ),
);
await browser.close();
