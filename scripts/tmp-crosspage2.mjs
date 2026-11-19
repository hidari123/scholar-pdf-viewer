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
await page.waitForTimeout(2500);

async function dragCrossPage(amount) {
  const info = await page.evaluate((n) => {
    const p1 = [
      ...document.querySelectorAll('.scpdf-page[data-page-number="1"] .scpdf-text-layer__item'),
    ];
    const p2 = [
      ...document.querySelectorAll('.scpdf-page[data-page-number="2"] .scpdf-text-layer__item'),
    ];
    const withText = (list) =>
      list.filter((s) => {
        const t = (s.textContent ?? '').trim();
        if (t.length < 10) return false;
        // 排除旋转文字（页边戳）：宽度 > 高度 说明是横排
        const r = s.getBoundingClientRect();
        return r.width > r.height * 2;
      });
    const a = withText(p1);
    const b = withText(p2);
    if (!a.length || !b.length) return null;
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
    };
  }, amount);

  if (!info) {
    console.log('找不到跨页的文字');
    return;
  }

  await page.mouse.move(info.startX, info.startY);
  await page.mouse.down();
  await page.mouse.move(info.endX, info.endY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(900);

  const result = await page.evaluate(() => {
    const sel = window.getSelection();
    const layers = [...document.querySelectorAll('.scpdf-selection-layer, .scpdf-selection')];
    const rects = layers.flatMap((l) =>
      [...l.querySelectorAll('div, span')].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, w: r.width, h: r.height };
      }),
    );
    return {
      text: (sel?.toString() ?? '').slice(0, 60),
      layerCount: layers.length,
      rects: rects.slice(0, 10),
    };
  });

  console.log(`\n--- 拖到第 2 页第 ${amount + 1} 个块（"${info.endText}"）---`);
  console.log(`选中文字: "${result.text}"`);
  console.log(`选区层: ${result.layerCount} 个，矩形 ${result.rects.length} 个`);
  for (const r of result.rects.slice(0, 6)) {
    const inViewport = r.top >= 0 && r.top < 900;
    console.log(
      `  rect top=${r.top.toFixed(1)} left=${r.left.toFixed(1)} w=${r.w.toFixed(1)} h=${r.h.toFixed(1)}${inViewport ? '' : ' ← 不在视口内！'}`,
    );
  }
}

for (const amount of [0, 1, 3]) {
  await dragCrossPage(amount);
}

await browser.close();
