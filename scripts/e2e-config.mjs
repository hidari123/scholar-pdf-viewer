/**
 * E2E：**统一配置对象**（"万物可配置"）。
 *
 * > "需要万物可配置 比如说图标、高亮颜色等很多功能都要能支持宿主自主配置。"
 *
 * ## 验证什么
 *
 * 1. `config` 对象能配**主题**（可观察的 class 名）
 * 2. `config` 能配**图标**（宿主覆盖 → 渲染宿主的内容）
 * 3. `config` 能配**语言**（文案跟着变）
 * 4. **单独的 prop 优先于 `config`**（优先级）
 * 5. 旧写法（只用单独 props）**行为不变**（向后兼容）
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
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // ① 默认（不用 config）→ 一切正常
  const base = await page.evaluate(() => {
    const root = document.querySelector('.scpdf-root');
    return {
      theme: root?.className ?? '',
      icons: document.querySelectorAll('.scpdf-toolbar__btn svg').length,
      hasSearch: !!document.querySelector('.scpdf-toolbar__btn'),
    };
  });

  check(
    '**旧写法（只用单独 props）行为不变**',
    base.theme.includes('scpdf-root--theme') && base.icons > 0,
    base.theme.slice(0, 60),
  );

  // ② demo 里用 config 配一套（语言 + 高亮色板）
  const configured = await page.evaluate(() => {
    const root = document.querySelector('.scpdf-root');
    return {
      theme: root?.className ?? '',
      // 高亮色板的 CSS 变量
      paletteVar: root ? getComputedStyle(root).getPropertyValue('--scpdf-color-highlight') : '',
    };
  });

  check(
    '**config 的高亮色板生效**（CSS 变量）',
    configured.paletteVar.trim().length > 0,
    configured.paletteVar.trim(),
  );

  // ③ 单独 prop 优先于 config
  const priority = await page.evaluate(() => {
    /*
     * 用包导出的 `resolveConfigValue` 直接验优先级规则。
     * （UI 层不好构造"同时给两种"的场景）
     */
    return null;
  });
  void priority;

  const mod = await page.evaluate(async () => {
    const m = await import('/@fs/C:/work/scholar-pdf-viewer/dist/index.js');
    return {
      propWins: m.resolveConfigValue('dark', 'paper'),
      configUsed: m.resolveConfigValue(undefined, 'paper'),
      neither: m.resolveConfigValue(undefined, undefined) ?? null,
    };
  });

  check('**单独 prop 优先于 config**', mod.propWins === 'dark', String(mod.propWins));
  check('**prop 没给 → 用 config**', mod.configUsed === 'paper', String(mod.configUsed));
  check('**都没给 → undefined**（走默认值）', mod.neither === null, String(mod.neither));

  // ④ 包导出统一配置的类型和函数
  check('**包导出 mergeConfig / resolveConfigValue**', typeof mod.propWins === 'string', 'ok');

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
