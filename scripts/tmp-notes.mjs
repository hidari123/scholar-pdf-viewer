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
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(2000);

// 选中一段文字 → 高亮
await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
    (s) => (s.textContent || '').trim().length > 20,
  );
  const sp = spans.find((s) => {
    const r = s.getBoundingClientRect();
    return r.width > r.height * 2 && r.top > 200;
  });
  if (!sp) return;
  const r = document.createRange();
  const node = sp.firstChild ?? sp;
  r.setStart(node, 0);
  r.setEnd(node, 10);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
await page.waitForTimeout(1200);
// 点"添加高亮"
const buttons = await page.locator('.scpdf-toolbar__btn').all();
for (const b of buttons) {
  const l = await b.getAttribute('aria-label');
  if (l?.includes('添加高亮')) {
    await b.click();
    break;
  }
}
await page.waitForTimeout(1200);
// 点"造两个同一行的批注"
for (const b of await page.locator('.scpdf-toolbar__btn').all()) {
  const l = await b.getAttribute('aria-label');
  if (l?.includes('同一行')) {
    await b.click();
    break;
  }
}
await page.waitForTimeout(1200);
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const notes = [...document.querySelectorAll('.scpdf-sticky-note')];
      return notes.map((n) => ({
        group: n.dataset.group,
        badge: n.querySelector('.scpdf-sticky-note__badge')?.textContent ?? null,
        picker: n.querySelector('.scpdf-sticky-note__picker')?.textContent?.slice(0, 40) ?? null,
      }));
    }),
    null,
    1,
  ),
);
await page.screenshot({ path: join(process.cwd(), '.tmp-final', 'notes.png') });
console.log('ok');
await browser.close();
