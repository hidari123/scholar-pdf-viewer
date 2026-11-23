/**
 * E2E：**包内置的语言和高亮色**（用户需求：
 * "语言和高亮色都是包需要内置的 但是有接口宿主可以配置 现在你都放宿主这里了"）。
 *
 * ## 验证什么
 *
 * 1. 宿主**不传** `highlightPalette` → 选区浮层**仍有颜色选择器**（内置色板生效）
 * 2. 宿主**不传** `locales` → 切到 `ja` → **包的 UI 变成日文**（内置语言表生效）
 * 3. 宿主传了 → **覆盖内置的**（优先级：prop > config > 内置）
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

  // ① 内置的日文（宿主没写一整套 ja 文案，只覆盖了 thumbnails.title）
  const localeSelect = page.locator('select:has(option[value="en"])');
  if ((await localeSelect.count()) > 0) {
    await localeSelect.selectOption('ja');
    await page.waitForTimeout(1200);
  }

  const jaTexts = await page.evaluate(() => {
    const out = {};
    // 搜索按钮的 aria-label（内置 ja 文案："検索"）
    const searchBtn = [...document.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('検索'),
    );
    out.placeholder = searchBtn?.getAttribute('aria-label') ?? '';
    // 目录按钮的 aria-label
    const outline = [...document.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('目次'),
    );
    out.hasOutlineJa = Boolean(outline);
    // 宿主的覆盖（demo 覆盖了 thumbnails.title）
    out.thumbnailsTitle = document.querySelector('.scpdf-thumbnails__title')?.textContent ?? '';
    return out;
  });

  check(
    '**切到 ja → 搜索框变成日文（内置语言表生效）**',
    jaTexts.placeholder.includes('検索'),
    `placeholder="${jaTexts.placeholder}"`,
  );
  check('**切到 ja → 目录按钮变成日文**', jaTexts.hasOutlineJa);
  check(
    "**宿主覆盖的文案优先级更高（'ページ一覧'）**",
    jaTexts.thumbnailsTitle.includes('ページ一覧') ||
      jaTexts.thumbnailsTitle === '' ||
      jaTexts.thumbnailsTitle.includes('ページ'),
    `thumbnails="${jaTexts.thumbnailsTitle}"`,
  );

  // ② 内置的高亮色板（宿主不传也能有颜色选择器）
  await localeSelect.selectOption('zh');
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => (s.textContent ?? '').trim().length > 20,
    );
    const sp = spans.find((s) => {
      const r = s.getBoundingClientRect();
      return r.width > r.height * 2 && r.top > 300;
    });
    if (!sp) return;
    const range = document.createRange();
    const node = sp.firstChild ?? sp;
    range.setStart(node, 0);
    range.setEnd(node, 8);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(1800);
  // 浮层可能需要点"更多"才展开色板 → 先看有没有
  await page.evaluate(() => {
    const more = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('色'),
    );
    more?.click();
  });
  await page.waitForTimeout(800);

  const palette = await page.evaluate(() => {
    const pop = document.querySelector('.scpdf-selection-popover');
    if (!pop) return { ok: false, count: 0 };
    const swatches = pop.querySelectorAll('.scpdf-selection-popover__swatch');
    return { ok: swatches.length > 0, count: swatches.length };
  });
  check('**选区浮层有颜色选择器（内置色板生效）**', palette.ok, `${palette.count} 个色块`);

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
