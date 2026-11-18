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

const snap = () =>
  page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    const p = document.querySelector('.scpdf-page');
    const cr = c?.getBoundingClientRect();
    const pr = p?.getBoundingClientRect();
    return {
      scale: document.querySelector('.scpdf-toolbar__scale')?.textContent,
      containerW: Math.round(cr?.width ?? 0),
      pageW: Math.round(pr?.width ?? 0),
      pageLeft: Math.round((pr?.left ?? 0) - (cr?.left ?? 0)),
      panel: !!document.querySelector('.scpdf-panel'),
      scrollTop: c?.scrollTop,
    };
  });

console.log('初始:     ', JSON.stringify(await snap()));
await page.locator('[aria-label="缩略图"]').first().click();
await page.waitForTimeout(1500);
console.log('开缩略图: ', JSON.stringify(await snap()));
await page
  .locator('[aria-label="目录"]')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(1500);
console.log('开目录:   ', JSON.stringify(await snap()));

await browser.close();
