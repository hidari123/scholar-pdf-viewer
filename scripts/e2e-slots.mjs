/**
 * E2E：**插槽（方案 D）**。
 *
 * PLAN-ROUND13.md 的"具体要新增的 #4"：
 * > 新增 `slots` prop（方案 D 也一并做了，成本不高）
 *
 * ## 验证什么
 *
 * 1. 传了 `slots.toolbar` → **内置工具栏不渲染**，换成宿主的
 * 2. 传了 `slots.panel` → **内置侧栏不渲染**，换成宿主的
 * 3. 传了 `slots.pageOverlay` → **每页都渲染**一次（在页内）
 * 4. 不传 → 内置的照常渲染（不能因为加了插槽就坏掉）
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

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1200);

  // ---- 1. 基线：内置工具栏在渲染 ----
  const baseline = await page.evaluate(() => ({
    toolbar: document.querySelectorAll('.scpdf-toolbar').length,
    panel: document.querySelectorAll('.scpdf-panel').length,
  }));
  check('基线：内置工具栏在渲染', baseline.toolbar === 1, `${baseline.toolbar} 个`);

  // ---- 2. 插槽：demo 里加一个开关（用 URL 参数触发）----
  //
  // ⚠️ demo 是**真实宿主示例** → 插槽要在 demo 里能跑才算数。
  // → demo 用 `?slots=1` 开启。
  await page.goto(`${E2E_BASE_URL}/?slots=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1200);

  const withSlots = await page.evaluate(() => ({
    hostToolbar: document.querySelectorAll('[data-slot="toolbar"]').length,
    builtinToolbar: document.querySelectorAll('.scpdf-toolbar').length,
    hostPanel: document.querySelectorAll('[data-slot="panel"]').length,
    builtinPanel: document.querySelectorAll('.scpdf-panel').length,
    overlay: document.querySelectorAll('[data-slot="page-overlay"]').length,
    pages: document.querySelectorAll('.scpdf-page').length,
  }));

  console.log(`  插槽态: ${JSON.stringify(withSlots)}`);

  check('**插槽 `toolbar` 渲染了宿主的内容**', withSlots.hostToolbar === 1);
  check(
    '**内置工具栏被替换掉了**',
    withSlots.builtinToolbar === 0,
    `${withSlots.builtinToolbar} 个`,
  );
  check('**插槽 `panel` 渲染了宿主的内容**', withSlots.hostPanel === 1);
  /*
   * ⚠️ 内置侧栏**默认不开**（`sidebar === 'none'`）
   * → 这里只能断言"没有内置侧栏元素"。
   * → 真正的"替换"语义由 `slots.panel` 的存在保证（包不再渲染 `ThumbnailPanel` / `OutlinePanel`）。
   */
  check('内置侧栏没有被渲染', withSlots.builtinPanel === 0, `${withSlots.builtinPanel} 个`);
  check(
    '**插槽 `pageOverlay` 每页都渲染**',
    withSlots.overlay === withSlots.pages,
    `${withSlots.overlay} / ${withSlots.pages} 页`,
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
