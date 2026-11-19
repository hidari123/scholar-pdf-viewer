import { existsSync, mkdirSync, readdirSync } from 'node:fs';
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
mkdirSync(join(process.cwd(), '.tmp-final'), { recursive: true });
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(1500);
// 滚到中间
await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  c.scrollTop = 3000;
});
await page.waitForTimeout(1500);
// 造一条批注
await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
    (s) => (s.textContent || '').trim().length > 20,
  );
  const sp = spans.find((s) => {
    const r = s.getBoundingClientRect();
    return r.width > r.height * 2 && r.top > 300 && r.top < 700;
  });
  if (!sp) return;
  const range = document.createRange();
  const node = sp.firstChild ?? sp;
  range.setStart(node, 0);
  range.setEnd(node, 8);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await page.waitForTimeout(1200);
await page.locator('button[aria-label="加批注"]').first().click();
await page.waitForTimeout(2500);
console.log(
  '弹窗几何:',
  JSON.stringify(
    await page.evaluate(() => {
      const d = document.querySelector('.scpdf-annotation-dialog');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const scrim = document.querySelector('.scpdf-annotation-dialog__scrim');
      const sr = scrim?.getBoundingClientRect();
      return {
        dialog: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        scrim: sr
          ? {
              x: Math.round(sr.left),
              y: Math.round(sr.top),
              w: Math.round(sr.width),
              h: Math.round(sr.height),
            }
          : null,
        position: getComputedStyle(d).position,
      };
    }),
    null,
    1,
  ),
);
await page.screenshot({ path: join(process.cwd(), '.tmp-final', 'dialog.png') });
await browser.close();
