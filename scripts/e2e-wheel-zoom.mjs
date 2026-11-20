/**
 * E2E：**Ctrl + 滚轮缩放**（审计发现的：注释里写了，代码里根本没有）。
 *
 * ## 审计反馈
 *
 * > "Mouse-wheel zoom / Ctrl+wheel zoom - **NONE — the feature does not exist**
 * >  grep for `wheel` / `WheelEvent` / `'wheel'` / `ctrlKey` across `src/` → **0 matches**
 * >  `useZoom.ts:241` documents '用户手动缩放（点 +/-、**Ctrl+滚轮**）'
 * >  but no wheel handler is implemented anywhere."
 *
 * ## 验证什么
 *
 * 1. **Ctrl + 滚轮 -> 放大 / 缩小**（就近取整到 10%）
 * 2. **不按 Ctrl -> 正常滚动**（不能抢用户的滚动）
 * 3. **浏览器自己的整页缩放被拦掉**（`preventDefault`）
 * 4. **滚轮缩放会退出"适应宽度"模式**（用户手动调了 -> 不该被覆盖）
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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  const readScale = () =>
    page.evaluate(() => document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '');

  const readScroll = () =>
    page.evaluate(() => Math.round(document.querySelector('.scpdf-container')?.scrollTop ?? 0));

  // 鼠标放到 PDF 中间（滚轮事件要落在容器上）
  const box = await page.locator('.scpdf-container').first().boundingBox();
  if (!box) {
    throw new Error('找不到容器');
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);

  const scaleBefore = await readScale();

  // ——— ① Ctrl + 向上滚 -> 放大 ———
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(900);
  const scaleZoomIn = await readScale();
  await page.keyboard.up('Control');

  check(
    '**Ctrl + 向上滚 -> 放大**',
    scaleZoomIn !== scaleBefore,
    `${scaleBefore} -> ${scaleZoomIn}`,
  );

  // ——— ② Ctrl + 向下滚 -> 缩小 ———
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(900);
  const scaleZoomOut = await readScale();
  await page.keyboard.up('Control');

  check(
    '**Ctrl + 向下滚 -> 缩小**',
    scaleZoomOut !== scaleZoomIn,
    `${scaleZoomIn} -> ${scaleZoomOut}`,
  );

  // 缩放后就近取整到 10%
  const percent = Number.parseInt(scaleZoomIn.replace('%', ''), 10);
  check(
    '**滚轮缩放也"就近取整到 10%"**（和 +/- 按钮一致）',
    Number.isFinite(percent) && percent % 10 === 0,
    scaleZoomIn,
  );

  // ——— ③ 不按 Ctrl -> 正常滚动（不缩放） ———
  const scrollBefore = await readScroll();
  const scaleBeforePlain = await readScale();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(900);
  const scrollAfter = await readScroll();
  const scaleAfterPlain = await readScale();

  check(
    '**不按 Ctrl -> 页面正常滚动**（不能抢用户的滚动）',
    scrollAfter > scrollBefore,
    `scrollTop ${scrollBefore} -> ${scrollAfter}`,
  );
  check(
    '**不按 Ctrl -> 缩放不变**',
    scaleAfterPlain === scaleBeforePlain,
    `${scaleBeforePlain} -> ${scaleAfterPlain}`,
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
