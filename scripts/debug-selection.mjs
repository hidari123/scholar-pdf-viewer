/**
 * 调试：文本层定位精度。
 *
 * 关键检查：**文本层 span 的位置 vs canvas 上真实文字的位置**。
 * 如果两者不一致 → 选中的框和看到的字对不上（用户报的 bug）。
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

function resolveChromium() {
  const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(cacheRoot)) return undefined;
  const dirs = readdirSync(cacheRoot)
    .filter((n) => n.startsWith('chromium-'))
    .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
    .sort((a, b) => b.v - a.v);
  for (const d of dirs) {
    const exe = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5186';
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-text-layer__item', { timeout: 30000 });
await page.waitForTimeout(1500);

// ---- 1. 文本层 span 的几何 vs 它自己的文字内容 ----
const info = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.scpdf-text-layer__item')].slice(0, 12);
  return items.map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      text: (el.textContent ?? '').slice(0, 30),
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
      fontSize: cs.fontSize,
      fontFamily: cs.fontFamily.slice(0, 30),
      // 关键：元素宽度 vs 内容实际需要的宽度（是否被压缩/拉伸）
      scrollWidth: el.scrollWidth,
      transform: cs.transform,
    };
  });
});

console.log('--- 文本层片段 ---');
for (const item of info) {
  console.log(
    `  "${item.text}" | left=${item.left} top=${item.top} w=${item.width} h=${item.height} | ${item.fontSize} ${item.fontFamily} | scrollW=${item.scrollWidth} | ${item.transform}`,
  );
}

// ---- 2. 拖选一段文字，看选区框与文字的对应关系 ----
const selectionInfo = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.scpdf-text-layer__item')];
  const target = items.find((el) => (el.textContent ?? '').trim().length > 20);
  if (!target) return { error: 'no target' };

  const textNode = target.firstChild;
  if (!textNode) return { error: 'no text node' };

  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 10);

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  const rects = [...range.getClientRects()].map((r) => ({
    left: Math.round(r.left),
    top: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height),
  }));

  const targetRect = target.getBoundingClientRect();

  return {
    selectedText: sel.toString(),
    targetText: (target.textContent ?? '').slice(0, 20),
    targetRect: {
      left: Math.round(targetRect.left),
      top: Math.round(targetRect.top),
      width: Math.round(targetRect.width),
      height: Math.round(targetRect.height),
    },
    rangeRects: rects,
  };
});

console.log('\n--- 选区几何 ---');
console.log(JSON.stringify(selectionInfo, null, 2));

await browser.close();
