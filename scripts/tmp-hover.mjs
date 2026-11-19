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
page.on('pageerror', (e) => console.log('PAGEERROR:', String(e).slice(0, 300)));
await page.goto('http://127.0.0.1:5180', { waitUntil: 'networkidle' });
await page.waitForTimeout(4500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(1500);
// 造一个批注
await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
    (s) => (s.textContent || '').trim().length > 20,
  );
  const sp = spans.find((s) => {
    const r = s.getBoundingClientRect();
    return r.width > r.height * 2 && r.top > 300;
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
await page.waitForTimeout(2000);
await page.locator('.scpdf-annotation-dialog .ProseMirror').click();
await page.keyboard.type('这是**加粗**的批注', { delay: 30 });
await page.waitForTimeout(400);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.scpdf-annotation-dialog button')].find((b) =>
    (b.textContent ?? '').includes('保存'),
  );
  btn?.click();
});
await page.waitForTimeout(2000);
// 找到便签并 hover
const pos = await page.evaluate(() => {
  const el = document.querySelector('.scpdf-sticky-note__icon');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
console.log('便签位置:', JSON.stringify(pos));
if (pos) {
  await page.mouse.move(pos.x, pos.y);
  await page.waitForTimeout(1000);
  const state1 = await page.evaluate(() => {
    const c = document.querySelector('.scpdf-sticky-note__content');
    return {
      visible: c?.getAttribute('data-visible'),
      html: c?.querySelector('.scpdf-sticky-note__text')?.innerHTML?.slice(0, 80),
      actions: c?.querySelectorAll('.scpdf-sticky-note__action').length,
    };
  });
  console.log('hover 图标后:', JSON.stringify(state1));
  // 移到内容框上
  const cpos = await page.evaluate(() => {
    const c = document.querySelector('.scpdf-sticky-note__content');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + 20) };
  });
  if (cpos) {
    await page.mouse.move(cpos.x, cpos.y);
    await page.waitForTimeout(800);
    console.log(
      '移到内容框后:',
      JSON.stringify(
        await page.evaluate(() => {
          const c = document.querySelector('.scpdf-sticky-note__content');
          const r = c?.getBoundingClientRect();
          return {
            visible: c?.getAttribute('data-visible'),
            w: Math.round(r?.width ?? 0),
            h: Math.round(r?.height ?? 0),
          };
        }),
      ),
    );
    await page.screenshot({
      path: join(process.cwd(), '.tmp-final', 'annotation-hover.png'),
      clip: { x: Math.max(0, pos.x - 30), y: Math.max(0, pos.y - 30), width: 400, height: 220 },
    });
  }
}
await browser.close();
