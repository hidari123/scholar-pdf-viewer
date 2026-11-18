import { E2E_BASE_URL } from './e2e-base.mjs';
/**
 * E2E：搜索高亮验证（Bug 4）。
 *
 * 断言：
 * 1. 搜索有结果
 * 2. **页面上出现搜索高亮矩形**（核心 —— 之前完全没有）
 * 3. 高亮矩形落在文字上（与文本层 span 的位置吻合）
 * 4. ↑↓ 切换能滚动到对应命中
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForSelector('.scpdf-page canvas.scpdf-canvas', { timeout: 30000 });
  await page.waitForTimeout(1500);

  // 打开搜索面板
  await page.locator('.scpdf-toolbar__btn[aria-label="搜索文档"]').click();
  await page.waitForTimeout(500);

  const input = page.locator('.scpdf-search__input');
  await input.fill('harness');
  // 等索引建好 + 搜索
  await page.waitForTimeout(8000);

  const countText = await page.locator('.scpdf-search__count').textContent();
  check('搜索有结果', Boolean(countText?.trim()), `提示 = ${countText?.trim()}`);

  // ---- 核心断言：页面上有搜索高亮 ----
  const highlightCount = await page.locator('.scpdf-annotation--search').count();
  check('页面上出现搜索高亮矩形', highlightCount > 0, `${highlightCount} 个`);

  // ---- 先跳到第一个命中（滚到命中处），再检查高亮是否落在文字上 ----
  const nextBtn = page.locator('.scpdf-search .scpdf-toolbar__btn[aria-label="下一个"]');
  await nextBtn.click();
  await page.waitForTimeout(1500);

  // ---- 高亮矩形是否落在文字上（取**视口内**的高亮）----
  const alignment = await page.evaluate(() => {
    const container = document.querySelector('.scpdf-container');
    if (!container) return { error: 'no container' };
    const cr = container.getBoundingClientRect();

    const highlights = [...document.querySelectorAll('.scpdf-annotation--search')];
    if (highlights.length === 0) return { error: 'no highlight' };

    // 找第一个**视口内**的高亮（否则量到的距离没意义）
    const visible = highlights.filter((h) => {
      const r = h.getBoundingClientRect();
      return r.bottom > cr.top && r.top < cr.bottom && r.right > cr.left && r.left < cr.right;
    });

    if (visible.length === 0) {
      return { error: 'no visible highlight', total: highlights.length };
    }

    const h = visible[0];
    const hr = h.getBoundingClientRect();

    // 找与高亮中心最近的文本 span
    const cx = hr.left + hr.width / 2;
    const cy = hr.top + hr.height / 2;

    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;

    for (const s of spans) {
      const r = s.getBoundingClientRect();
      const dx = Math.max(r.left - cx, 0, cx - r.right);
      const dy = Math.max(r.top - cy, 0, cy - r.bottom);
      const dist = Math.hypot(dx, dy);
      if (dist < bestDist) {
        bestDist = dist;
        best = (s.textContent ?? '').slice(0, 25);
      }
    }

    return {
      total: highlights.length,
      visibleCount: visible.length,
      nearestText: best ?? '',
      distance: Math.round(bestDist),
      highlightRect: {
        left: Math.round(hr.left),
        top: Math.round(hr.top),
        width: Math.round(hr.width),
        height: Math.round(hr.height),
      },
    };
  });

  check(
    '高亮矩形落在文字上（中心距文字 < 20px）',
    !alignment.error && alignment.distance < 20,
    alignment.error
      ? alignment.error
      : `距 "${alignment.nearestText}" ${alignment.distance}px, 矩形 ${JSON.stringify(alignment.highlightRect)}（视口内 ${alignment.visibleCount}/${alignment.total}）`,
  );

  // ---- ↑ 切换 → 滚动 + 激活高亮 ----
  // 记录当前激活的是哪个高亮 → 切换后应该变了
  const activeBefore = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation--search-active');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  });

  await nextBtn.click();
  await page.waitForTimeout(1500);

  const activeAfter = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation--search-active');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  });

  const activeCount = await page.locator('.scpdf-annotation--search-active').count();

  check('当前命中有激活样式', activeCount > 0, `${activeCount} 个`);
  check(
    '切换到下一个命中会改变激活项',
    Boolean(activeBefore) &&
      Boolean(activeAfter) &&
      (activeBefore.left !== activeAfter.left || activeBefore.top !== activeAfter.top),
    `${JSON.stringify(activeBefore)} → ${JSON.stringify(activeAfter)}`,
  );

  // 跳到下一个命中时，命中应该在视口内可见
  const inView = await page.evaluate(() => {
    const container = document.querySelector('.scpdf-container');
    const el = document.querySelector('.scpdf-annotation--search-active');
    if (!container || !el) return null;
    const cr = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return r.top >= cr.top - 5 && r.bottom <= cr.bottom + 5;
  });

  check('跳转到命中后命中在视口内可见', inView === true, String(inView));

  await page.screenshot({ path: 'e2e-shots/search-highlight.png' });
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
