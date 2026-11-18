/**
 * E2E：**7 套主题 + appearance 结构开关**。
 *
 * 用户反馈："需要支持配置页面样式 给出几套方案"
 * 用户确认："建议 7 套：light/dark/auto/paper/sepia/contrast/minimal"
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
    const exePath = join(cacheRoot, d.n, 'chrome-win64', 'chrome.exe');
    if (existsSync(exePath)) {
      return exePath;
    }
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

/** 切主题（demo 里有主题下拉框） */
const setTheme = async (theme) => {
  await page.selectOption('select[aria-label="主题"]', theme);
  await page.waitForTimeout(400);
};

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1500);

  // ---- 1. 7 套主题都在下拉框里 ----
  const options = await page.evaluate(() =>
    [...document.querySelectorAll('select[aria-label="主题"] option')].map((o) => o.value),
  );
  check('**下拉框里有 7 套主题**', options.length === 7, options.join(', '));
  for (const t of ['light', 'dark', 'auto', 'paper', 'sepia', 'contrast', 'minimal']) {
    check(`主题清单包含 ${t}`, options.includes(t));
  }

  // ---- 2. 每套主题都真的换了样式 ----
  const snapshot = async () =>
    page.evaluate(() => {
      const root = document.querySelector('.scpdf-root');
      if (!root) return null;
      const cs = getComputedStyle(root);
      const pageEl = document.querySelector('.scpdf-page');
      return {
        cls: root.className,
        surface: cs.getPropertyValue('--scpdf-color-surface').trim(),
        primary: cs.getPropertyValue('--scpdf-color-primary').trim(),
        text: cs.getPropertyValue('--scpdf-color-text').trim(),
        highlightMy: cs.getPropertyValue('--scpdf-highlight-my').trim(),
        selection: cs.getPropertyValue('--scpdf-selection-color').trim(),
        radius: cs.getPropertyValue('--scpdf-radius-page').trim(),
        pageShadow: pageEl ? getComputedStyle(pageEl).boxShadow : null,
      };
    });

  const seen = new Map();
  for (const theme of ['light', 'dark', 'paper', 'sepia', 'contrast', 'minimal']) {
    await setTheme(theme);
    const s = await snapshot();
    seen.set(theme, s);
    check(
      `主题 ${theme}：根节点有对应的 class`,
      !!s && s.cls.includes(`scpdf-root--${theme}`),
      s?.cls,
    );
    check(`主题 ${theme}：定义了 surface 颜色`, !!s && s.surface.length > 0, s?.surface);
    check(`主题 ${theme}：定义了 primary 颜色`, !!s && s.primary.length > 0, s?.primary);
    check(`主题 ${theme}：定义了选区颜色`, !!s && s.selection.length > 0, s?.selection);
  }

  // ---- 3. 各主题之间确实不同 ----
  const surfaces = new Set([...seen.values()].map((s) => s.surface));
  check('**不同主题的 surface 颜色不同**', surfaces.size >= 5, `${surfaces.size} 种`);

  const highlights = new Set([...seen.values()].map((s) => s.highlightMy));
  check('**不同主题的高亮色不同**', highlights.size >= 4, `${highlights.size} 种`);

  // ---- 4. contrast / minimal 特殊：不要阴影、圆角为 0 ----
  const contrast = seen.get('contrast');
  const minimal = seen.get('minimal');
  check('contrast 主题：页阴影为 none', contrast?.pageShadow === 'none', contrast?.pageShadow);
  check('contrast 主题：圆角为 0', contrast?.radius === '0', contrast?.radius);
  check('minimal 主题：页阴影为 none', minimal?.pageShadow === 'none', minimal?.pageShadow);

  // ---- 5. appearance 的密度开关 ----
  const densityClass = async () =>
    page.evaluate(() => document.querySelector('.scpdf-root')?.className ?? '');

  await page.selectOption('select[aria-label="密度"]', 'compact');
  await page.waitForTimeout(300);
  const compact = await densityClass();
  check(
    '**密度 compact → 根节点有 class**',
    compact.includes('scpdf-root--density-compact'),
    compact,
  );

  const panelWidth = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-panel');
    return el ? getComputedStyle(el).width : null;
  });
  console.log(`  紧凑密度下侧栏宽度: ${panelWidth}`);

  await page.selectOption('select[aria-label="密度"]', 'comfortable');
  await page.waitForTimeout(300);
  const comfortable = await densityClass();
  check(
    '密度 comfortable → 根节点有 class',
    comfortable.includes('scpdf-root--density-comfortable'),
  );

  // ---- 6. auto 主题跟随系统 ----
  await setTheme('auto');
  const auto = await snapshot();
  check('主题 auto：根节点有 scpdf-root--auto', auto?.cls.includes('scpdf-root--auto'), auto?.cls);

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
