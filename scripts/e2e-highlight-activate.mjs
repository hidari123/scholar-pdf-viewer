/**
 * E2E：**点高亮 → 激活态亮起**（且只亮那一个）。
 *
 * ## 这个用例补的是哪条路径 ✅
 *
 * ⚠️ **之前的 E2E 没覆盖"点高亮"这条路径** ✅
 * -> `e2e-annotation-dialog-highlight-activate.mjs` 走的是**批注路径** ✅
 * -> 那条路径**不调** `setActiveHighlightRect` ✅
 * -> -> `activeHighlightRect` 是 `null` ✅
 * -> -> 退回按 **id** 判断 ✅ -> 激活 ✅
 * -> -> **所以那个 bug 测不出来** ✅
 *
 * ## 这个 bug 是什么（使用方报告 ✅）
 *
 * -> **激活态判定用了两个不同的坐标空间** ✅
 *    -> 渲染侧 `AnnotationLayer`：**页内坐标** ✅（norm × viewport ✅）
 *    -> 点击侧 `PdfViewer`：**视口坐标** ✅（getBoundingClientRect ✅）
 * -> `isSameRect` 容差 **1px** ✅ -> 差一个页偏移 ✅ -> **永远不匹配** ✅
 * -> -> **激活态永远不亮** ✅
 *
 * ## 修法 ✅
 *
 * 1. 点击侧改成记**页内坐标** ✅（减去页的偏移 ✅）
 * 2. **`activeHighlightRect` 之前根本没传给 `AnnotationLayer`** ✅
 *    -> `Page` 没这个 prop ✅ -> 一直是 `undefined` ✅
 *    -> -> 永远退回按 id 判断 ✅ -> **同 id 的多个矩形会一起亮** ✅
 * -> -> 现在**传下去** ✅
 *
 * ## 验证什么 ✅
 *
 * 1. 点一个高亮 → **有且只有 1 个** `.scpdf-annotation--active` ✅
 * 2. 点的那个**确实是激活的** ✅（不是别的 ✅）
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
    { timeout: 30000 },
  );
  await page.waitForTimeout(1200);

  // ---- 加一条高亮 ----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = Number.parseFloat(getComputedStyle(x).fontSize);
      return fs >= 12 && r.top > 250 && r.top < 500 && r.width > 150;
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8 };
  });

  if (!t) {
    check('找到可拖选的正文', false);
  } else {
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 200, t.y + 60, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    const addBtn = page.getByRole('button', { name: '添加高亮', exact: true });
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(900);
    }
    check(
      '先加一条高亮',
      (await page.evaluate(() => document.querySelectorAll('.scpdf-annotation').length)) > 0,
    );
  }

  // ---- 点高亮 -> 激活态 ----
  const _before = await page.evaluate(() => ({
    total: document.querySelectorAll('.scpdf-annotation').length,
    active: document.querySelectorAll('.scpdf-annotation--active').length,
  }));

  // ⚠️ **点第 2 个矩形** ✅（一条高亮可能有多个矩形 ✅）
  const clicked = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.scpdf-annotation')];
    const target = all[1] ?? all[0];
    if (!target) return null;
    const r = target.getBoundingClientRect();
    return {
      index: all.indexOf(target),
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
    };
  });

  if (!clicked) {
    check('找到可点击的高亮块', false);
  } else {
    await page.mouse.click(clicked.x, clicked.y);
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.scpdf-annotation')];
      return {
        total: all.length,
        active: all.filter((el) => el.className.includes('scpdf-annotation--active')).length,
        activeIndex: all.findIndex((el) => el.className.includes('scpdf-annotation--active')),
      };
    });

    check('点高亮 -> 有激活态', after.active === 1, `激活数=${after.active}`);
    check(
      '**激活的就是点的那一个**',
      after.activeIndex === clicked.index,
      `点的=${clicked.index} 激活=${after.activeIndex}`,
    );
    check(
      '同一条高亮的其他矩形**没有**一起亮',
      after.active === 1 && after.total >= 1,
      `总数=${after.total} 激活=${after.active}`,
    );
  }

  check('没有 JS 报错', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('E2E 执行异常', false, String(e).slice(0, 160));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length > 0 ? 1 : 0);
