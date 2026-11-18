/**
 * E2E：**高亮的持久化**（宿主的职责）。
 *
 * PLAN-ROUND13.md §问题3 的 §3b②：
 * > 宿主侧：三种持久化方案（按需选一种）
 * > A. localStorage / B. IndexedDB / C. 后端接口
 * > **"每次改动都保存到接口"** —— 宿主侧用一个**防抖 + 队列**
 *
 * ## 验证什么
 *
 * 1. 加一条高亮 → **刷新页面** → 高亮还在（**持久化生效**）
 * 2. **切换文档** → 高亮是**该文档的**那份（隔离生效）
 * 3. 切回原文档 → 高亮还在（不是被清空了）
 * 4. 存储里的内容是**包的格式**（`exportHighlights` 的 JSON）→ 换后端不用改包
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
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

/** 拖选一段文字并点"添加高亮" */
async function addHighlight() {
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      return (
        Number.parseFloat(getComputedStyle(x).fontSize) >= 12 &&
        r.top > 250 &&
        r.top < 500 &&
        r.width > 150
      );
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8 };
  });
  if (!t) return false;

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
  return true;
}

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

  // ---- 1. 加一条高亮 ----
  const added = await addHighlight();
  const before = await page.evaluate(() => document.querySelectorAll('.scpdf-annotation').length);
  check('先加一条高亮', added && before > 0, `${before} 个高亮元素`);

  // ---- 2. 等防抖保存（500ms）+ 确认落盘 ----
  await page.waitForTimeout(900);
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes('highlights'));
    if (!key) return null;
    const raw = localStorage.getItem(key);
    return { key, parsed: JSON.parse(raw) };
  });

  check('**高亮落到了 localStorage**', stored !== null, stored?.key);
  check(
    '**存储的是包的格式**（version / documentId / highlights / exportedAt）',
    stored !== null &&
      typeof stored.parsed.version === 'number' &&
      typeof stored.parsed.documentId === 'string' &&
      Array.isArray(stored.parsed.highlights),
    stored ? JSON.stringify(Object.keys(stored.parsed)) : '',
  );

  // ---- 3. 刷新 → 高亮还在 ----
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1200);

  const afterReload = await page.evaluate(
    () => document.querySelectorAll('.scpdf-annotation').length,
  );
  check('**刷新后高亮还在**（持久化生效）', afterReload > 0, `${afterReload} 个高亮元素`);

  // ---- 4. 切换文档 → 高亮是"那一份" ----
  const switched = await page.evaluate(async () => {
    // 找"载入内置样张"按钮 → 换文档
    const buttons = [...document.querySelectorAll('button')];
    const btn = buttons.find((b) => (b.textContent ?? '').includes('载入内置样张'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!switched) {
    check('找到切换文档的按钮', false);
  } else {
    await page.waitForTimeout(3000);
    const afterSwitch = await page.evaluate(
      () => document.querySelectorAll('.scpdf-annotation').length,
    );
    check(
      '**切换文档后高亮是"那一份"**（隔离生效，不是残留）',
      afterSwitch === 0,
      `${afterSwitch} 个高亮元素`,
    );

    // ---- 5. 切回原文档 → 高亮还在 ----
    await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('button')];
      const btn = buttons.find((b) => (b.textContent ?? '').includes('载入本地真实文档'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(3000);
    const back = await page.evaluate(() => document.querySelectorAll('.scpdf-annotation').length);
    check('**切回原文档 → 高亮还在**', back > 0, `${back} 个高亮元素`);
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
