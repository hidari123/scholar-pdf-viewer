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
await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  c.scrollTop = 3000;
});
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
    (s) => (s.textContent || '').trim().length > 20,
  );
  const inView = spans.filter((s) => {
    const r = s.getBoundingClientRect();
    return r.top > 200 && r.bottom < 800 && r.width > r.height * 2;
  });
  if (!inView[0]) return { count: 0, all: spans.length };
  const sp = inView[0];
  const range = document.createRange();
  const node = sp.firstChild ?? sp;
  range.setStart(node, 0);
  range.setEnd(node, 8);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  const r = sp.getBoundingClientRect();
  return { count: inView.length, y: Math.round(r.top), text: (sp.textContent ?? '').slice(0, 30) };
});
console.log('选区:', JSON.stringify(info));
await page.waitForTimeout(1500);
console.log(
  '浮层:',
  await page.evaluate(() => document.querySelectorAll('.scpdf-selection-popover').length),
);
await page
  .locator('button[aria-label="加批注"]')
  .first()
  .click({ timeout: 8000 })
  .catch((_e) => console.log('点击失败'));
await page.waitForTimeout(2500);
console.log(
  '弹窗几何:',
  JSON.stringify(
    await page.evaluate(() => {
      const d = document.querySelector('.scpdf-annotation-dialog');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return {
        x: Math.round(r.left),
        y: Math.round(r.top),
        w: Math.round(r.width),
        h: Math.round(r.height),
        position: getComputedStyle(d).position,
      };
    }),
    null,
    1,
  ),
);
await page.screenshot({ path: join(process.cwd(), '.tmp-final', 'dialog.png') });
await browser.close();
