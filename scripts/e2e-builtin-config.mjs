/**
 * E2E：**内置的高亮色板和语言表**（用户需求：
 * "你看看是否高亮和语言都有内置配置了 没有的话加上
 *  需要内置一些高亮选项 语言先内置中文和英文两种 这些都可以宿主再次配置"）。
 *
 * ## 验证什么
 *
 * 1. **内置的高亮色板** → 选区浮层里有颜色选择器（宿主不传也有）
 * 2. **内置的语言**（中文 / 英文）→ 切语言后 UI 跟着变
 * 3. **宿主可以覆盖**内置的高亮色板
 * 4. **宿主可以覆盖**内置的语言（任意语言、任意一句）
 * 5. `core` 子路径也能拿到内置的（不用从主入口 import）
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

  // ① core 子路径能拿到内置的
  const core = await page.evaluate(async () => {
    const mod = await import('/node_modules/@scholar-club/pdf-viewer/dist/core.js');
    return {
      hasPalette: !!mod.BUILTIN_HIGHLIGHT_PALETTE,
      paletteKeys: Object.keys(mod.BUILTIN_HIGHLIGHT_PALETTE ?? {}),
      hasLocales: !!mod.BUILTIN_LOCALES,
      localeKeys: Object.keys(mod.BUILTIN_LOCALES ?? {}),
      // 宿主什么都不传 -> mergeConfig 用内置的
      mergedPalette: Object.keys(mod.mergeConfig(undefined, {}).highlightPalette ?? {}),
      mergedLocales: Object.keys(mod.mergeConfig(undefined, {}).locales ?? {}),
    };
  });

  check('**core 子路径能拿到内置的高亮色板**', core.hasPalette, core.paletteKeys.join(','));
  check(
    '**内置了一些高亮选项（>= 6 种）**',
    core.paletteKeys.length >= 6,
    `${core.paletteKeys.length} 种：${core.paletteKeys.join(',')}`,
  );
  check(
    '**core 子路径能拿到内置的语言表**',
    core.hasLocales && core.localeKeys.includes('zh') && core.localeKeys.includes('en'),
    core.localeKeys.join(','),
  );
  check(
    '**宿主什么都不传 -> mergeConfig 用内置色板**',
    core.mergedPalette.length === core.paletteKeys.length,
    `${core.mergedPalette.length} 种`,
  );
  check(
    '**宿主什么都不传 -> mergeConfig 用内置语言表**',
    core.mergedLocales.includes('zh') && core.mergedLocales.includes('en'),
    core.mergedLocales.join(','),
  );

  // ② 内置的语言在 UI 上生效（中文）
  const zhLabels = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-toolbar__btn')]
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter(Boolean),
  );
  check(
    '**内置中文生效（工具栏是中文）**',
    zhLabels.some((l) => /搜索|目录|缩略图|放大|缩小/.test(l)),
    zhLabels.slice(0, 4).join(' / '),
  );

  // ③ 内置的英文在 UI 上生效
  /*
   * ⚠️ **不能再按中文 aria-label 找**（审计修复后 aria-label 也是本地化的）。
   * -> 在 en 模式下它是 "Language" ❌
   * -> 改成：**按选项里有 'en' 来找**（语言无关）✅
   */
  const localeSelect = page.locator('select:has(option[value="en"])');
  if ((await localeSelect.count()) > 0) {
    await localeSelect.selectOption('en');
    await page.waitForTimeout(1200);
  }
  const enLabels = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-toolbar__btn')]
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter(Boolean),
  );
  check(
    '**内置英文生效（工具栏变英文）**',
    enLabels.some((l) => /Search|Outline|Thumbnails|Zoom/i.test(l)),
    enLabels.slice(0, 4).join(' / '),
  );

  // ④ 宿主可以覆盖内置的语言
  const overridden = await page.evaluate(async () => {
    const mod = await import('/node_modules/@scholar-club/pdf-viewer/dist/core.js');
    const merged = mod.mergeLocales({ en: { 'search.placeholder': 'My Search' } });
    return {
      en: merged.en?.['search.placeholder'],
      zh: merged.zh?.['search.placeholder'],
    };
  });
  check('**宿主可以覆盖内置的语言**', overridden.en === 'My Search', `en="${overridden.en}"`);
  check('**覆盖英文不影响中文**', overridden.zh === '搜索文档', `zh="${overridden.zh}"`);

  // ⑤ 宿主可以覆盖内置的高亮色板
  const overriddenPalette = await page.evaluate(async () => {
    const mod = await import('/node_modules/@scholar-club/pdf-viewer/dist/core.js');
    const merged = mod.mergeConfig({}, { highlightPalette: { mine: '#123456' } });
    return Object.keys(merged.highlightPalette ?? {});
  });
  check(
    '**宿主可以覆盖内置的高亮色板**',
    overriddenPalette.length === 1 && overriddenPalette[0] === 'mine',
    overriddenPalette.join(','),
  );

  // ⑥ 选区浮层里真的有颜色选择器（内置色板生效）
  await localeSelect.selectOption('zh').catch(() => {});
  await page.waitForTimeout(800);
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
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('色'),
    );
    btn?.click();
  });
  await page.waitForTimeout(800);
  const swatches = await page.evaluate(
    () => document.querySelectorAll('.scpdf-selection-popover__swatch').length,
  );
  check('**选区浮层里有颜色选择器（内置色板生效）**', swatches >= 6, `${swatches} 个色块`);

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
