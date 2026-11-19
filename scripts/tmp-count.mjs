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
  document.querySelector('.scpdf-container').scrollTop = 2500;
});
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
    (s) => (s.textContent || '').trim().length > 20,
  );
  const inView = spans.filter((s) => {
    const r = s.getBoundingClientRect();
    return r.top > 150 && r.bottom < 700 && r.width > r.height;
  });
  if (!inView[0]) return;
  const sp = inView[0];
  const range = document.createRange();
  const node = sp.firstChild ?? sp;
  range.setStart(node, 0);
  range.setEnd(node, 8);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await page.waitForTimeout(1500);
await page
  .locator('button[aria-label="加批注"]')
  .first()
  .click({ timeout: 8000 })
  .catch(() => {});
await page.waitForTimeout(2500);
console.log(
  '编辑器数量:',
  JSON.stringify(
    await page.evaluate(() => {
      const pm = document.querySelectorAll('.ProseMirror');
      const dialogs = document.querySelectorAll('.scpdf-annotation-dialog');
      const panels = document.querySelectorAll('.scpdf-annotation-panel');
      const editors = document.querySelectorAll('.scpdf-rich-text__editor');
      return {
        prosemirror: pm.length,
        dialogs: dialogs.length,
        panels: panels.length,
        editors: editors.length,
        pmRects: [...pm].map((p) => {
          const r = p.getBoundingClientRect();
          return {
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        }),
        pmParents: [...pm].map((p) => p.parentElement?.className),
      };
    }),
    null,
    1,
  ),
);
await browser.close();
