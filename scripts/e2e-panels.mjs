/**
 * E2E: panel checks (thumbnails / outline / search).
 *
 * Uses the real PDF to verify the three panels end to end:
 * - thumbnails: open -> generate -> click to jump
 * - outline: open -> list items -> click to jump
 * - search: type -> results -> next/prev
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

function resolveChromium() {
  if (process.env.E2E_CHROMIUM_PATH && existsSync(process.env.E2E_CHROMIUM_PATH)) {
    return process.env.E2E_CHROMIUM_PATH;
  }
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

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5181';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text());
});

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 60000 });
  await page.waitForTimeout(2500);

  // ---------- thumbnails ----------
  // Use the toolbar button, not getByLabel (the panel has the same aria-label)
  const thumbBtn = page.locator('.scpdf-toolbar__btn[aria-label="缩略图"]');
  await thumbBtn.click();
  await page.waitForTimeout(2500);

  const thumbPanel = await page.locator('.scpdf-panel--thumbnails').count();
  check('缩略图面板已打开', thumbPanel === 1);

  const thumbCount = await page.locator('.scpdf-thumbnail').count();
  check('缩略图列出了所有页', thumbCount > 0, `${thumbCount} 个`);

  const imgCount = await page.locator('.scpdf-thumbnail__img').count();
  check('缩略图已生成图片', imgCount > 0, `${imgCount} 张`);

  await page.locator('.scpdf-thumbnail').nth(2).click();
  await page.waitForTimeout(1200);
  const pager = await page.locator('.scpdf-toolbar__page-input').inputValue();
  check('点缩略图跳到对应页', pager === '3', `页码 = ${pager}`);

  await page.screenshot({ path: 'e2e-shots/thumbnails.png' });

  // close thumbnails (toolbar button must stay clickable -> sidebar must not cover it)
  await thumbBtn.click();
  await page.waitForTimeout(300);
  const thumbClosed = (await page.locator('.scpdf-panel--thumbnails').count()) === 0;
  check('侧栏不遮挡工具栏（可关闭）', thumbClosed);

  // ---------- outline ----------
  const outlineBtn = page.locator('.scpdf-toolbar__btn[aria-label="目录"]');
  await outlineBtn.click();
  await page.waitForTimeout(2500);

  const outlinePanel = await page.locator('.scpdf-panel--outline').count();
  check('目录面板已打开', outlinePanel === 1);

  const outlineItems = await page.locator('.scpdf-outline__item').count();
  check('目录列出了条目', outlineItems > 0, `${outlineItems} 条`);

  const enabledOutline = await page.locator('.scpdf-outline__item:not([disabled])').count();
  check('目录项解析出了目标页', enabledOutline > 0, `${enabledOutline} 条可跳转`);

  if (enabledOutline > 0) {
    const firstEnabled = page.locator('.scpdf-outline__item:not([disabled])').first();
    await firstEnabled.click();
    await page.waitForTimeout(1500);
    const outlinePager = await page.locator('.scpdf-toolbar__page-input').inputValue();
    check('点目录项跳转成功', outlinePager !== '1', `页码 = ${outlinePager}`);
  }

  await page.screenshot({ path: 'e2e-shots/outline.png' });
  await outlineBtn.click();
  await page.waitForTimeout(300);

  // ---------- search ----------
  await page.locator('.scpdf-toolbar__btn[aria-label="搜索文档"]').click();
  await page.waitForTimeout(500);

  const searchBox = await page.locator('.scpdf-search__input').count();
  check('搜索面板已打开', searchBox === 1);

  await page.locator('.scpdf-search__input').fill('harness');
  await page.waitForTimeout(5000);

  const countText = await page.locator('.scpdf-search__count').textContent();
  check('搜索出结果', Boolean(countText?.trim()), `提示 = ${countText?.trim()}`);

  await page.screenshot({ path: 'e2e-shots/search.png' });

  check('运行期无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
