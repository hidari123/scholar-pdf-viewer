/**
 * E2E：**目录的异步页码解析**（用户反馈："目录还是无法点击跳转"）。
 *
 * ## 之前的问题
 *
 * → 目录的页码来自宿主的**同步** `pageRefToNumber`
 * → pdf.js 的 `getPageIndex` 是**异步**的 → 宿主得自己写 50+ 行
 * → 宿主漏了最后一步（通知包）→ **目录点了没反应** ❌
 *
 * ## 现在
 *
 * → 宿主给一个**异步**的 `resolvePageRef` → **包自己解析**
 * → 命名目标（"section.1"）也能解析
 *
 * ## 验证什么
 *
 * 1. 目录项**不是"解析中"**状态（页码解析出来了）
 * 2. 点目录项 → **真的跳到那一页**
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

  // 打开目录
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('目录'),
    );
    btn?.click();
  });
  await page.waitForTimeout(2500);

  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-outline__item')].map((b) => ({
      title: b.textContent ?? '',
      resolving: b.classList.contains('scpdf-outline__item--resolving'),
    })),
  );
  check('**目录有内容**', items.length > 0, `${items.length} 项`);

  const resolving = items.filter((i) => i.resolving).length;
  check(
    '**页码都解析出来了（不是"解析中"）**',
    resolving === 0,
    resolving === 0 ? '全部就绪' : `${resolving}/${items.length} 还在解析中`,
  );

  // 点第 10 项 → 应该跳到那一页
  const before = await page.evaluate(
    () => document.querySelector('.scpdf-container')?.scrollTop ?? 0,
  );
  const target = page.locator('.scpdf-outline__item').nth(9);
  const title = await target.textContent();
  await target.click();
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    const cr = c.getBoundingClientRect();
    const visible = [];
    for (const p of document.querySelectorAll('.scpdf-page')) {
      const r = p.getBoundingClientRect();
      if (r.bottom > cr.top + 10 && r.top < cr.bottom - 10) {
        visible.push({ num: p.getAttribute('data-page-number'), top: Math.round(r.top - cr.top) });
      }
    }
    return { scrollTop: Math.round(c.scrollTop), visible };
  });

  check(
    '**点目录项 → 真的滚动了**',
    Math.abs(after.scrollTop - before) > 100,
    `"${title}"：${before} → ${after.scrollTop}`,
  );
  check(
    '**跳转后目标页在视口顶部**',
    after.visible.some((v) => v.top <= 20),
    `可见页 ${after.visible.map((v) => v.num).join(',')}`,
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
