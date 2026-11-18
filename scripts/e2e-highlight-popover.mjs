/**
 * E2E：**高亮后的选区清除 + 高亮块操作条**。
 *
 * 用户反馈：
 * 1. "点击高亮之后 发现无法取消选中状态 一直都有外边框"
 * 2. "点击高亮之后 应该也会出现那个选择的弹框的 可以选择颜色等"
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

/** 读当前状态 */
const state = () =>
  page.evaluate(() => {
    const sel = window.getSelection();
    /*
     * ⚠️ **按"唯一的高亮 id"计数**，不是按 DOM 元素个数。
     *
     * 一个高亮可能**跨多行 / 多个矩形** → 渲染成多个 `<button>`
     * （实测一段正文 → 3 个 `.scpdf-annotation--mine` 元素，但只是 **1 条高亮**）
     * → 按元素计数会误判成"生成了 3 条"。
     */
    const ids = new Set(
      [...document.querySelectorAll('.scpdf-annotation--mine')].map((el) =>
        el.getAttribute('data-highlight-id'),
      ),
    );
    return {
      nativeSelLen: sel?.toString().length ?? 0,
      nativeCollapsed: sel?.isCollapsed ?? null,
      selectionLayer: document.querySelectorAll('.scpdf-selection-layer').length,
      selectionPopover: document.querySelectorAll('.scpdf-selection-popover').length,
      annotations: ids.size,
      annotationEls: document.querySelectorAll('.scpdf-annotation--mine').length,
      activeAnnotations: document.querySelectorAll('.scpdf-annotation--active').length,
    };
  });

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const sampleBtn = page.getByRole('button', { name: '载入内置样张' });
  if ((await sampleBtn.count()) > 0) {
    await sampleBtn.click();
  }
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
  await page.waitForTimeout(2500);

  // ---- 1. 选中一段 ----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = Number.parseFloat(getComputedStyle(x).fontSize);
      return (
        fs > 10 &&
        (x.textContent ?? '').trim().length > 20 &&
        r.width > 150 &&
        r.top > 150 &&
        r.top < 600
      );
    });
    const el = spans[0];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.min(r.left + 12, r.right - 20), y: r.top + r.height * 0.3, w: r.width };
  });
  if (!t) throw new Error('没找到正文');

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + Math.max(30, Math.min(180, t.w - 24)), t.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const selected = await state();
  check('选中后：原生选区存在', selected.nativeSelLen > 0, `${selected.nativeSelLen} 字符`);
  check('选中后：自绘选区块存在', selected.selectionLayer === 1);
  check('选中后：选区浮层打开', selected.selectionPopover === 1);

  // ---- 2. 点"添加高亮" → 选区应该被清掉 ----
  await page.locator('[aria-label="添加高亮"]').click();
  await page.waitForTimeout(800);

  const afterHighlight = await state();
  check(
    '**点高亮后：浏览器原生选区已清除**',
    afterHighlight.nativeSelLen === 0,
    `len=${afterHighlight.nativeSelLen}`,
  );
  check(
    '**点高亮后：自绘选区块已清除**',
    afterHighlight.selectionLayer === 0,
    `${afterHighlight.selectionLayer} 个`,
  );
  check(
    '**点高亮后：选区浮层已关闭**',
    afterHighlight.selectionPopover === 0,
    `${afterHighlight.selectionPopover} 个`,
  );
  check(
    '点高亮后：高亮已生成',
    afterHighlight.annotations === 1,
    `${afterHighlight.annotations} 个`,
  );

  // ---- 3. 高亮后还能重新选中（不能把选择功能搞坏）----
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + Math.max(30, Math.min(180, t.w - 24)), t.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);

  const reselected = await state();
  check(
    '**点高亮后：仍能重新框选**（不能破坏选择功能）',
    reselected.nativeSelLen > 0,
    `${reselected.nativeSelLen} 字符`,
  );

  // ---- 4. 点高亮块 → 弹出操作条 ----
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.waitForTimeout(300);

  const ann = page.locator('.scpdf-annotation--mine').first();
  await ann.click({ force: true });
  await page.waitForTimeout(800);

  const afterClick = await state();
  check(
    '点高亮块后：操作条浮层出现',
    afterClick.selectionPopover === 1,
    `${afterClick.selectionPopover} 个`,
  );

  // 浮层里应该有"换色"和"删除"按钮
  const buttons = await page.evaluate(() => {
    const pop = document.querySelector('.scpdf-selection-popover');
    if (!pop) return [];
    return [...pop.querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? b.title ?? '',
    );
  });
  console.log(`  浮层按钮: ${JSON.stringify(buttons)}`);
  check(
    '浮层里有"高亮/换色"按钮',
    buttons.some((b) => b.includes('高亮') || b.includes('换色')),
  );
  check(
    '浮层里有"删除"按钮',
    buttons.some((b) => b.includes('删除')),
  );

  // ---- 5. 蓝框应该自动消失 ----
  await page.waitForTimeout(1800);
  const afterTimer = await state();
  check(
    '**点高亮块 1.8s 后：蓝框自动消失**',
    afterTimer.activeAnnotations === 0,
    `${afterTimer.activeAnnotations} 个`,
  );

  // ---- 6. 点"删除" → 高亮消失 ----
  const deleteBtn = page.locator('.scpdf-selection-popover button[aria-label="删除"]').first();
  if ((await deleteBtn.count()) > 0) {
    await deleteBtn.click();
    await page.waitForTimeout(600);
    const afterDelete = await state();
    check('点"删除"后：高亮已移除', afterDelete.annotations === 0, `${afterDelete.annotations} 个`);
  }

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
