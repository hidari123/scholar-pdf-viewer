/**
 * E2E：**打开缩略图 / 目录 → PDF 自动重新适配**（WPS 式行为）。
 *
 * 用户反馈："缩略图或者文档目录打开的时候 右侧的pdf自动缩放 跟wps保持一致"
 *
 * ## 实测（修复前）
 *
 * ```
 * 初始:      scale=230%  containerW=1384  pageW=1408
 * 开缩略图:  scale=230%  containerW=1139  pageW=1408   ← ❌ 页比容器还宽（横向溢出）
 * ```
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { E2E_BASE_URL } from './e2e-base.mjs';

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

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

/** 读当前的缩放 / 容器宽 / 页宽 */
const snap = () =>
  page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    const p = document.querySelector('.scpdf-page');
    const cr = c?.getBoundingClientRect();
    const pr = p?.getBoundingClientRect();
    return {
      scale: document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
      containerW: Math.round(cr?.width ?? 0),
      pageW: Math.round(pr?.width ?? 0),
      panel: !!document.querySelector('.scpdf-panel'),
      /** 页有没有横向溢出容器 */
      overflow: (pr?.width ?? 0) > (cr?.width ?? 0) + 1,
    };
  });

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1500);

  const before = await snap();
  console.log(`  初始: ${JSON.stringify(before)}`);
  check('初始状态正常', before.containerW > 0 && before.pageW > 0);

  // ---- 1. 打开缩略图 ----
  await page.locator('[aria-label="缩略图"]').first().click();
  await page.waitForTimeout(2000);

  const withPanel = await snap();
  console.log(`  开缩略图: ${JSON.stringify(withPanel)}`);

  check(
    '**打开缩略图后：容器变窄了**',
    withPanel.containerW < before.containerW,
    `${before.containerW} → ${withPanel.containerW}`,
  );
  check(
    '**打开缩略图后：缩放自动变小**',
    Number.parseInt(withPanel.scale, 10) < Number.parseInt(before.scale, 10),
    `${before.scale} → ${withPanel.scale}`,
  );
  check(
    '**打开缩略图后：页完整可见（不横向溢出）**',
    withPanel.overflow === false,
    `pageW=${withPanel.pageW} containerW=${withPanel.containerW}`,
  );
  check(
    '页宽接近容器宽（真的重新适配了）',
    withPanel.pageW >= withPanel.containerW - 60,
    `Δ=${withPanel.containerW - withPanel.pageW}`,
  );

  // ---- 2. 关闭缩略图 → 恢复 ----
  await page.locator('[aria-label="缩略图"]').first().click();
  await page.waitForTimeout(2000);

  const closed = await snap();
  console.log(`  关缩略图: ${JSON.stringify(closed)}`);
  /*
   * ⚠️ **不能断言"完全相等"**。
   *
   * 缩放是**量化到 10% 的倍数**的（显示值 == 渲染几何）
   * → 1384 → 1139 → 1384 的来回，会因为量化产生一点漂移
   *   （实测 230% → 180% → 220%）。
   *
   * → 断言"**回到了接近原值**"（±10%，一个量化步长）。
   */
  check(
    '**关闭缩略图后：缩放恢复（±10%，一个量化步长）**',
    Math.abs(Number.parseInt(closed.scale, 10) - Number.parseInt(before.scale, 10)) <= 10,
    `${before.scale} → ${closed.scale}`,
  );
  check('关闭缩略图后：页完整可见', closed.overflow === false);

  // ---- 3. 手动缩放后 → 开面板**不该覆盖**用户的偏好 ----
  // 连点两次放大 → 明显比"适配宽度"更大
  await page.locator('[aria-label="放大"]').first().click();
  await page.waitForTimeout(500);
  await page.locator('[aria-label="放大"]').first().click();
  await page.waitForTimeout(900);
  const zoomed = await snap();
  console.log(`  手动放大: ${JSON.stringify(zoomed)}`);
  check(
    '手动放大生效了',
    Number.parseInt(zoomed.scale, 10) > Number.parseInt(before.scale, 10),
    `${before.scale} → ${zoomed.scale}`,
  );

  await page.locator('[aria-label="缩略图"]').first().click();
  await page.waitForTimeout(2000);
  const afterZoomPanel = await snap();
  console.log(`  放大后开面板: ${JSON.stringify(afterZoomPanel)}`);
  check(
    '**手动缩放后：开面板不覆盖用户的比例**',
    afterZoomPanel.scale === zoomed.scale,
    `${zoomed.scale} → ${afterZoomPanel.scale}`,
  );

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
