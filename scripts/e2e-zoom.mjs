/**
 * E2E：缩放行为验证。
 *
 * 断言：
 * 1. 缩放比例是**整十数**（不是 222%）
 * 2. 缩放时**视口左上角的内容不动**（第一排文字高度不动）
 * 3. 缩放后视口内的页都有 canvas（白屏回归防护）
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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5187';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // ---- 1. 初始比例是整十数 ----
  const readZoom = async () => {
    return page.evaluate(() => {
      const el = document.querySelector('.scpdf-toolbar__scale');
      return el?.textContent?.trim() ?? '';
    });
  };

  /**
   * 按位置找缩放按钮（不依赖 aria-label —— 它是本地化的）。
   * 工具栏右侧的三个：缩小 / 适配宽度 / 适配整页 / 放大。
   * 这里用 CSS 结构：`.scpdf-toolbar__right` 里的按钮。
   */
  const zoomButtons = page.locator('.scpdf-toolbar__right .scpdf-toolbar__btn');
  const zoomInBtn = zoomButtons.last();
  const zoomOutBtn = zoomButtons.first();

  const initialZoom = await readZoom();
  const initialPercent = Number.parseInt(initialZoom, 10);
  check(
    '初始缩放比例是整十数',
    Number.isFinite(initialPercent) && initialPercent % 10 === 0,
    `${initialZoom}`,
  );

  // ---- 2. 缩放后仍是整十数 ----
  await zoomInBtn.click();
  await page.waitForTimeout(1200);
  const zoomAfterIn = await readZoom();
  check('放大后仍是整十数', Number.parseInt(zoomAfterIn, 10) % 10 === 0, `${zoomAfterIn}`);

  await zoomOutBtn.click();
  await page.waitForTimeout(1200);
  const zoomAfterOut = await readZoom();
  check('缩小后仍是整十数', Number.parseInt(zoomAfterOut, 10) % 10 === 0, `${zoomAfterOut}`);

  // ---- 3. 适配宽度后是整十数 ----
  const fitWidthBtn = page.locator('.scpdf-toolbar__right .scpdf-toolbar__btn').nth(1);
  await fitWidthBtn.click();
  await page.waitForTimeout(1200);
  const fitZoom = await readZoom();
  check(
    '适配宽度后是整十数',
    Number.parseInt(fitZoom, 10) % 10 === 0,
    `${fitZoom}（原始计算值 ≈ 222%）`,
  );

  // ---- 4. **左上角锚点**：缩放时视口顶部的内容不动 ----
  // 做法：记录视口内第一个文本 span 的位置 → 缩放 → 再看它的位置
  const anchorBefore = await page.evaluate(() => {
    const container = document.querySelector('.scpdf-container');
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    if (!container || spans.length === 0) return null;

    const cr = container.getBoundingClientRect();
    // 找视口内最靠上的那个 span
    const inView = spans
      .map((s) => ({ s, r: s.getBoundingClientRect() }))
      .filter(({ r }) => r.bottom > cr.top && r.top < cr.bottom)
      .sort((a, b) => a.r.top - b.r.top);

    if (inView.length === 0) return null;
    const first = inView[0];
    return {
      text: (first.s.textContent ?? '').slice(0, 20),
      topInContainer: Math.round((first.r.top - cr.top) * 100) / 100,
      scrollTop: Math.round(container.scrollTop),
    };
  });

  if (anchorBefore) {
    await zoomInBtn.click();
    await page.waitForTimeout(1500);

    const anchorAfter = await page.evaluate(() => {
      const container = document.querySelector('.scpdf-container');
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
      if (!container || spans.length === 0) return null;

      const cr = container.getBoundingClientRect();
      const inView = spans
        .map((s) => ({ s, r: s.getBoundingClientRect() }))
        .filter(({ r }) => r.bottom > cr.top && r.top < cr.bottom)
        .sort((a, b) => a.r.top - b.r.top);

      if (inView.length === 0) return null;
      const first = inView[0];
      return {
        text: (first.s.textContent ?? '').slice(0, 20),
        topInContainer: Math.round((first.r.top - cr.top) * 100) / 100,
        scrollTop: Math.round(container.scrollTop),
      };
    });

    // 同一个文本的 top 应该基本不变（左上角锚点）
    const delta = anchorAfter
      ? Math.abs(anchorAfter.topInContainer - anchorBefore.topInContainer)
      : Number.POSITIVE_INFINITY;

    check(
      '缩放时视口左上角内容不动（第一排文字高度不变）',
      delta < 12,
      `Δ=${delta.toFixed(1)}px (之前 ${anchorBefore.topInContainer} → ${anchorAfter?.topInContainer})`,
    );
  } else {
    check('缩放时视口左上角内容不动（第一排文字高度不变）', false, '未找到视口内的文本');
  }

  // ---- 5. 白屏回归防护 ----
  const blank = await page.evaluate(() => {
    const container = document.querySelector('.scpdf-container');
    if (!container) return { count: 0, pages: [] };
    const cr = container.getBoundingClientRect();
    const pages = [...document.querySelectorAll('.scpdf-page')];
    const bad = pages
      .filter((p) => {
        const r = p.getBoundingClientRect();
        const inView = r.bottom > cr.top && r.top < cr.bottom;
        if (!inView) return false;
        const canvas = p.querySelector('canvas.scpdf-canvas');
        return !canvas || canvas.width === 0;
      })
      .map((p) => p.dataset.pageNumber);
    return { count: bad.length, pages: bad };
  });

  check('缩放后视口内的页都有 canvas（无白屏）', blank.count === 0, blank.pages.join(','));

  await page.screenshot({ path: 'e2e-shots/zoom.png' });
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
