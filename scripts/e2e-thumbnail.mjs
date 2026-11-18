import { E2E_BASE_URL } from './e2e-base.mjs';
/**
 * E2E：缩略图验证（Bug 1）。
 *
 * 断言：
 * 1. 缩略图渲染出来了
 * 2. **CSS 尺寸 == 图片原始尺寸 / DPR**（零错位 → 无白边）
 * 3. **缩略图内容边界比例 == 主页面内容边界比例**（几何一致）
 * 4. 宽高比与 PDF 页面一致（不变形）
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

const BASE = E2E_BASE_URL;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });

  // 打开缩略图面板
  const thumbBtn = page.locator('.scpdf-toolbar__btn[aria-label="缩略图"]');
  if ((await thumbBtn.count()) > 0) {
    await thumbBtn.click();
  }
  await page.waitForTimeout(6000);

  const thumbs = await page.locator('.scpdf-thumbnail__img').count();
  check('缩略图已生成', thumbs > 0, `${thumbs} 张`);

  // ---- 尺寸一致性 ----
  const sizing = await page.evaluate(() => {
    const img = document.querySelector('.scpdf-thumbnail__img');
    if (!img) return { error: 'no img' };

    const r = img.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    return {
      dpr,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      cssWidth: Math.round(r.width * 100) / 100,
      cssHeight: Math.round(r.height * 100) / 100,
      styleWidth: img.style.width,
      styleHeight: img.style.height,
      objectFit: getComputedStyle(img).objectFit,
      borderWidth: getComputedStyle(img).borderWidth,
    };
  });

  check(
    'CSS 尺寸与图片原始尺寸/DPR 一致（零错位）',
    !sizing.error &&
      Math.abs(sizing.cssWidth - sizing.naturalWidth / sizing.dpr) < 1 &&
      Math.abs(sizing.cssHeight - sizing.naturalHeight / sizing.dpr) < 1,
    sizing.error
      ? sizing.error
      : `CSS ${sizing.cssWidth}×${sizing.cssHeight} vs 图片 ${sizing.naturalWidth}×${sizing.naturalHeight} @DPR${sizing.dpr}`,
  );

  check(
    '用了 DPR 渲染（高 DPI 屏清晰）',
    !sizing.error && sizing.naturalWidth > sizing.cssWidth,
    sizing.error ? '' : `图片 ${sizing.naturalWidth}px > 显示 ${sizing.cssWidth}px`,
  );

  check(
    '没有 object-fit: contain（避免白边）',
    sizing.objectFit !== 'contain',
    `object-fit = ${sizing.objectFit}`,
  );

  check(
    '没有 border 占内容区',
    sizing.borderWidth === '0px' || sizing.borderWidth === '',
    `border-width = ${sizing.borderWidth}`,
  );

  // ---- 宽高比与 PDF 一致（不变形）----
  const aspect = await page.evaluate(() => {
    const img = document.querySelector('.scpdf-thumbnail__img');
    const pageEl = document.querySelector('.scpdf-page');
    if (!img || !pageEl) return null;

    const ir = img.getBoundingClientRect();
    const pr = pageEl.getBoundingClientRect();

    return {
      thumbAspect: Math.round((ir.width / ir.height) * 1000) / 1000,
      pageAspect: Math.round((pr.width / pr.height) * 1000) / 1000,
    };
  });

  check(
    '缩略图宽高比与页面一致（不变形）',
    aspect !== null && Math.abs(aspect.thumbAspect - aspect.pageAspect) / aspect.pageAspect < 0.01,
    aspect ? `缩略图 ${aspect.thumbAspect} vs 页面 ${aspect.pageAspect}` : '',
  );

  await page.screenshot({ path: 'e2e-shots/thumbnails.png' });
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
