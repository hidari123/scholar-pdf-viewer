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
await page.waitForTimeout(2500);

// 滚到第 1 页底部（让第 2 页露出来）
await page.evaluate(() => {
  const el = document.querySelector('.scpdf-page[data-page-number="2"]');
  if (el) el.scrollIntoView({ block: 'start' });
});
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  if (c) c.scrollTop -= 500;
});
await page.waitForTimeout(1500);

async function dragCrossPage(amount) {
  const info = await page.evaluate((n) => {
    const p1 = [
      ...document.querySelectorAll('.scpdf-page[data-page-number="1"] .scpdf-text-layer__item'),
    ];
    const p2 = [
      ...document.querySelectorAll('.scpdf-page[data-page-number="2"] .scpdf-text-layer__item'),
    ];
    const ok = (s) => {
      const t = (s.textContent ?? '').trim();
      const r = s.getBoundingClientRect();
      return (
        t.length > 10 &&
        r.width > r.height * 2 &&
        r.top > 0 &&
        r.top < 900 &&
        r.bottom > 0 &&
        r.bottom < 900
      );
    };
    const a = p1.filter(ok);
    const b = p2.filter(ok);
    if (!a.length || !b.length) return { err: `a=${a.length} b=${b.length}` };
    const startEl = a[a.length - 1];
    const endEl = b[Math.min(n, b.length - 1)];
    const sr = startEl.getBoundingClientRect();
    const er = endEl.getBoundingClientRect();
    return {
      startX: sr.left + 10,
      startY: sr.top + sr.height / 2,
      endX: er.left + 10,
      endY: er.top + er.height / 2,
      endText: (endEl.textContent ?? '').slice(0, 30),
      startText: (startEl.textContent ?? '').slice(0, 30),
    };
  }, amount);
  if (info.err) {
    console.log('找不到:', info.err);
    return;
  }

  await page.mouse.move(info.startX, info.startY);
  await page.mouse.down();
  await page.mouse.move(info.endX, info.endY, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(900);

  const result = await page.evaluate(() => {
    const sel = window.getSelection();
    const layers = [...document.querySelectorAll('.scpdf-selection-layer, .scpdf-selection')];
    const rects = layers.flatMap((l) =>
      [...l.querySelectorAll('div,span')].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, w: r.width, h: r.height };
      }),
    );
    return { text: (sel?.toString() ?? '').slice(0, 50), rects: rects.slice(0, 8) };
  });
  console.log(`\n--- 从"${info.startText.slice(0, 20)}"拖到"${info.endText.slice(0, 20)}" ---`);
  console.log(`选中: "${result.text}"  矩形 ${result.rects.length} 个`);
  for (const r of result.rects) {
    console.log(
      `  top=${r.top.toFixed(1)} left=${r.left.toFixed(1)} w=${r.w.toFixed(1)} h=${r.h.toFixed(1)}`,
    );
  }
}

for (const amount of [0, 2]) await dragCrossPage(amount);
await browser.close();
