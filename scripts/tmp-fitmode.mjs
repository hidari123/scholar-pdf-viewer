import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
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
await page.waitForTimeout(1500);

// 观察容器宽度变化
await page.evaluate(() => {
  window.__w = [];
  const c = document.querySelector('.scpdf-container');
  new ResizeObserver(() => {
    window.__w.push({ w: c.clientWidth, t: Date.now() });
  }).observe(c);
});

await page.locator('[aria-label="缩略图"]').first().click();
await page.waitForTimeout(2000);

console.log(
  JSON.stringify(
    await page.evaluate(() => ({
      widths: window.__w,
      scale: document.querySelector('.scpdf-toolbar__scale')?.textContent,
    })),
  ),
);
await browser.close();
