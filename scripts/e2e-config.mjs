/**
 * E2E：**统一配置对象**（"万物可配置"）。
 *
 * > "需要万物可配置 比如说图标、高亮颜色等很多功能都要能支持宿主自主配置。"
 *
 * ## 验证什么
 *
 * 1. **旧写法**（只用单独 props）**行为不变**（向后兼容）
 * 2. **优先级**：单独的 prop > `config` 里的同名项
 * 3. 包导出 `mergeConfig` / `resolveConfigValue`
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

  const base = await page.evaluate(() => {
    const root = document.querySelector('.scpdf-root');
    return {
      className: root?.className ?? '',
      icons: document.querySelectorAll('.scpdf-toolbar__btn svg').length,
      buttons: document.querySelectorAll('.scpdf-toolbar__btn').length,
    };
  });

  check(
    '**旧写法（只用单独 props）行为不变**',
    /scpdf-root--(light|dark|auto|paper|sepia|contrast|minimal)/.test(base.className) &&
      base.icons > 0 &&
      base.buttons > 0,
    `${base.className.slice(0, 50)} / ${base.icons} 个图标`,
  );

  const mod = await page.evaluate(async () => {
    const m = await import('/@fs/C:/work/scholar-pdf-viewer/dist/index.js');
    return {
      propWins: m.resolveConfigValue('dark', 'paper'),
      configUsed: m.resolveConfigValue(undefined, 'paper'),
      neither: m.resolveConfigValue(undefined, undefined) ?? null,
      falsyKept: m.resolveConfigValue(false, true),
      merged: m.mergeConfig({ theme: 'paper' }, { theme: 'dark' }),
    };
  });

  check('**单独 prop 优先于 config**', mod.propWins === 'dark', String(mod.propWins));
  check('**prop 没给 → 用 config**', mod.configUsed === 'paper', String(mod.configUsed));
  check('**都没给 → undefined**（走默认值）', mod.neither === null, String(mod.neither));
  check('**falsy 值也算『有值』**', mod.falsyKept === false, String(mod.falsyKept));
  check(
    '**mergeConfig：单独 prop 覆盖 config**',
    mod.merged?.theme === 'dark',
    String(mod.merged?.theme),
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
