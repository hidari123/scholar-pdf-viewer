import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
const dirs = readdirSync(cacheRoot)
  .filter((n) => n.startsWith('chromium-'))
  .map((n) => ({ n, v: parseInt(n.replace('chromium-', '')) || 0 }))
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
await page.goto('http://localhost:5194', { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.waitForTimeout(2000);

// 关键实验: 如果所有 span 的 font-size **一样**, 行盒就一样 -> 只涂一次?
const result = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  // 记录原始 font-size
  const orig = spans.map((s) => s.style.fontSize);
  const sizes = [...new Set(orig.filter(Boolean))];

  // 实验: 把所有 font-size 设成同一个值 (最大字号)
  const maxSize = orig
    .filter(Boolean)
    .reduce((a, b) => (parseFloat(b) > parseFloat(a) ? b : a), '12px');
  spans.forEach((s) => {
    s.style.fontSize = maxSize;
  });

  // 但这样文字位置会变 -> 只能测 getClientRects 的行盒数量
  const sel = window.getSelection();
  return { uniqueSizes: sizes.length, sizes: sizes.slice(0, 6), maxSize };
});
console.log('字号种类:', JSON.stringify(result));

// 恢复
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.waitForTimeout(1500);

const t = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const el = spans.find((x) => {
    const r = x.getBoundingClientRect();
    return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
  });
  const r = el.getBoundingClientRect();
  return { x: r.left + 5, y: r.top + 2 };
});
await page.mouse.move(t.x, t.y);
await page.mouse.down();
await page.mouse.move(t.x + 400, t.y + 120, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(700);

// 实验: 用一个包裹层把同行 span 合并? 太复杂。
// 改测: line-height 用 0 但**同时**给 span 一个 padding 让它有高度
const test = async (label, css) => {
  if (css) await page.addStyleTag({ content: css });
  const res = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rects = [...sel.getRangeAt(0).getClientRects()].map((r) => ({
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    }));
    const groups = [];
    for (const r of rects) {
      const g = groups.find(
        (g) => r.top < g.bottom && r.bottom > g.top && r.left < g.right && r.right > g.left,
      );
      if (!g) {
        groups.push({ top: r.top, bottom: r.bottom, left: r.left, right: r.right, n: 1 });
      } else {
        g.top = Math.min(g.top, r.top);
        g.bottom = Math.max(g.bottom, r.bottom);
        g.left = Math.min(g.left, r.left);
        g.right = Math.max(g.right, r.right);
        g.n++;
      }
    }
    const sample = (x, y) => {
      let c = 0;
      for (const r of rects) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) c++;
      return c;
    };
    const counts = groups.map((g) => sample((g.left + g.right) / 2, (g.top + g.bottom) / 2));
    const span = document.querySelector('.scpdf-text-layer__item');
    const cs = getComputedStyle(span);
    return {
      lines: groups.length,
      maxPaint: Math.max(...counts),
      rectH: span.getBoundingClientRect().height,
      lh: cs.lineHeight,
      pad: cs.paddingTop,
    };
  });
  console.log(label.padEnd(42), JSON.stringify(res));
  if (css) {
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);
    await page.waitForTimeout(1500);
    const t2 = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
      const el = spans.find((x) => {
        const r = x.getBoundingClientRect();
        return r.top > 300 && r.top < 500 && (x.textContent ?? '').trim().length > 20;
      });
      const r = el.getBoundingClientRect();
      return { x: r.left + 5, y: r.top + 2 };
    });
    await page.mouse.move(t2.x, t2.y);
    await page.mouse.down();
    await page.mouse.move(t2.x + 400, t2.y + 120, { steps: 20 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  }
};

await test(
  'G) lh:0 + padding-top (有高度?)',
  '.scpdf-text-layer__item { line-height: 0 !important; padding-top: 20px !important; }',
);
await test(
  'H) lh:0.001 + padding',
  '.scpdf-text-layer__item { line-height: 0.001 !important; padding-top: 2px !important; }',
);
await test('I) lh:1 + ::before 撑高?', '.scpdf-text-layer__item { line-height: 1 !important; }');
await browser.close();
