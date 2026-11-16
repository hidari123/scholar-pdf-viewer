/**
 * 调试：确认滚动容器 + 缩放后 canvas 消失的时序。
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });

// 找出真正的滚动容器
const containers = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')];
  return all
    .filter((el) => el.scrollHeight > el.clientHeight + 10)
    .map((el) => ({
      cls: el.className,
      tag: el.tagName,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
      scrollTop: el.scrollTop,
    }));
});

console.log('--- 可滚动的元素 ---');
for (const c of containers) {
  console.log(`  ${c.tag}.${c.cls} | ${c.scrollHeight}/${c.clientHeight} overflowY=${c.overflowY} scrollTop=${c.scrollTop}`);
}

// 缩放，并记录每一步的 canvas 状态（观察"消失 → 恢复"的时序）
console.log('\n--- 缩放过程 ---');
for (let i = 0; i < 4; i++) {
  await page.locator('.scpdf-toolbar__btn[aria-label="放大"]').click();
  // 立刻采样（不等重绘完成）
  const immediate = await page.evaluate(() => {
    const c = document.querySelector('.scpdf-page canvas.scpdf-canvas');
    const t = document.querySelector('.scpdf-text-layer');
    return {
      zoomLabel: document.querySelector('.scpdf-toolbar__zoom')?.textContent,
      canvas: c ? `${c.width}x${c.height}` : '无 canvas',
      text: t?.querySelectorAll('.scpdf-text-layer__item').length ?? 0,
    };
  });
  console.log(`  第${i + 1}次点击后(立即): zoom=${immediate.zoomLabel} canvas=${immediate.canvas} text=${immediate.text}项`);

  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => {
    const c = document.querySelector('.scpdf-page canvas.scpdf-canvas');
    const t = document.querySelector('.scpdf-text-layer');
    return {
      zoomLabel: document.querySelector('.scpdf-toolbar__zoom')?.textContent,
      canvas: c ? `${c.width}x${c.height}` : '无 canvas',
      text: t?.querySelectorAll('.scpdf-text-layer__item').length ?? 0,
    };
  });
  console.log(`  第${i + 1}次点击后(1.5s): zoom=${after.zoomLabel} canvas=${after.canvas} text=${after.text}项`);
}

await browser.close();
