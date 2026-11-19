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
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const cont = document.querySelector('.scpdf-container');
      const cr = cont.getBoundingClientRect();
      const pages = [...document.querySelectorAll('.scpdf-page')];
      const out = [];
      for (const p of pages.slice(0, 4)) {
        const r = p.getBoundingClientRect();
        out.push({
          num: p.getAttribute('data-page-number'),
          // 相对滚动内容原点的位置
          actualTop: Math.round(r.top - cr.top + cont.scrollTop),
          actualH: Math.round(r.height),
        });
      }
      const pagesDiv = document.querySelector('.scpdf-pages');
      const pr = pagesDiv.getBoundingClientRect();
      return {
        pages: out,
        pagesDivTop: Math.round(pr.top - cr.top + cont.scrollTop),
        scrollTop: cont.scrollTop,
      };
    }),
    null,
    1,
  ),
);
await browser.close();
