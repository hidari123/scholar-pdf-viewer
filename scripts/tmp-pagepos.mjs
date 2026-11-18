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

console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const container = document.querySelector('.scpdf-container');
      const pages = document.querySelector('.scpdf-pages');
      const pageEl = document.querySelector('.scpdf-page');
      const cr = container.getBoundingClientRect();
      const psr = pages.getBoundingClientRect();
      const pr = pageEl.getBoundingClientRect();
      const cs = getComputedStyle(pages);

      // 第一个正文字 span
      const span = [...document.querySelectorAll('.scpdf-text-layer__item')].find((x) => {
        const r = x.getBoundingClientRect();
        return Number.parseFloat(getComputedStyle(x).fontSize) >= 14 && r.top > 250;
      });
      const sr = span?.getBoundingClientRect();

      return {
        containerTop: cr.top,
        containerScrollTop: container.scrollTop,
        pagesMarginTop: cs.marginTop,
        pagesTop: psr.top,
        pagesOffsetTop: psr.top - cr.top,
        pageTop: pr.top,
        pageTopRelToContainer: pr.top - cr.top,
        pageStyleTop: pageEl.style.top,
        spanTop: sr?.top,
        spanTopRelPage: sr ? sr.top - pr.top : null,
      };
    }),
    null,
    1,
  ),
);

await browser.close();
