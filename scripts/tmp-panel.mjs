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
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    (b.getAttribute('aria-label') ?? '').includes('目录'),
  );
  btn?.click();
});
await page.waitForTimeout(1200);
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const panel = document.querySelector('.scpdf-panel--outline');
      const pr = panel?.getBoundingClientRect();
      const cont = document.querySelector('.scpdf-container');
      const cr = cont?.getBoundingClientRect();
      return {
        panel: pr
          ? {
              x: Math.round(pr.left),
              y: Math.round(pr.y),
              w: Math.round(pr.width),
              h: Math.round(pr.height),
            }
          : null,
        container: cr
          ? {
              x: Math.round(cr.left),
              y: Math.round(cr.top),
              w: Math.round(cr.width),
              h: Math.round(cr.height),
            }
          : null,
        panelStyle: panel ? getComputedStyle(panel).position : null,
      };
    }),
    null,
    1,
  ),
);
await browser.close();
