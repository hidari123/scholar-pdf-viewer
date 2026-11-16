/**
 * 调试：缩放后白屏（页面有文字但没渲染）。
 *
 * 检查：
 * 1) 缩放后可见页列表是否覆盖当前视口
 * 2) 页占位元素的 top 是否与 pageTops 一致
 * 3) canvas 是否已渲染（有内容）
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });

async function snapshot(label) {
  const data = await page.evaluate(() => {
    const scroller =
      document.querySelector('.scpdf-scroll') ??
      document.querySelector('[data-testid="pdf-viewer"]');
    const pages = [...document.querySelectorAll('.scpdf-page')];
    const container = scroller;

    // 当前视口内的页（用 getBoundingClientRect 判断）
    const cr = container.getBoundingClientRect();
    const inViewport = pages
      .filter((p) => {
        const r = p.getBoundingClientRect();
        return r.bottom > cr.top && r.top < cr.bottom;
      })
      .map((p) => Number(p.dataset.pageNumber));

    // 每页的状态
    const pageStates = pages.map((p) => {
      const r = p.getBoundingClientRect();
      const canvas = p.querySelector('canvas.scpdf-canvas');
      const textLayer = p.querySelector('.scpdf-text-layer');
      return {
        n: Number(p.dataset.pageNumber),
        top: Math.round(r.top - cr.top),
        h: Math.round(r.height),
        hasCanvas: Boolean(canvas),
        canvasW: canvas?.width ?? 0,
        canvasH: canvas?.height ?? 0,
        hasText: Boolean(textLayer),
        textItems: textLayer?.querySelectorAll('.scpdf-text-layer__item').length ?? 0,
      };
    });

    return {
      scrollTop: Math.round(container.scrollTop),
      scrollHeight: Math.round(container.scrollHeight),
      clientHeight: Math.round(container.clientHeight),
      inViewport,
      pageStates,
    };
  });

  const blank = data.pageStates.filter(
    (p) => data.inViewport.includes(p.n) && (!p.hasCanvas || p.canvasW === 0),
  );
  const noText = data.pageStates.filter((p) => data.inViewport.includes(p.n) && p.textItems === 0);

  console.log(`\n=== ${label} ===`);
  console.log(
    `scrollTop=${data.scrollTop} scrollHeight=${data.scrollHeight} clientH=${data.clientHeight}`,
  );
  console.log(`视口内页: [${data.inViewport.join(',')}]`);
  console.log(`视口内无 canvas 的页: ${blank.length ? blank.map((b) => b.n).join(',') : '无'}`);
  console.log(`视口内无文本层的页: ${noText.length ? noText.map((b) => b.n).join(',') : '无'}`);
  console.log('视口内各页详情:');
  for (const p of data.pageStates.filter((s) => data.inViewport.includes(s.n))) {
    console.log(
      `  页${p.n}: top=${p.top} h=${p.h} canvas=${p.hasCanvas}(${p.canvasW}x${p.canvasH}) text=${p.textItems}项`,
    );
  }
  return data;
}

await snapshot('初始');

// 放大 3 次
for (let i = 0; i < 3; i++) {
  await page.locator('.scpdf-toolbar__btn[aria-label="放大"]').click();
  await page.waitForTimeout(1200);
}
await snapshot('放大 3 次后');

// 向下滚动一点
await page.mouse.move(700, 500);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(1500);
await snapshot('滚动 400px 后');

// 再滚动
await page.mouse.wheel(0, 600);
await page.waitForTimeout(1500);
await snapshot('再滚动 600px');

await page.screenshot({ path: 'e2e-shots/zoom-blank.png' });

await browser.close();
