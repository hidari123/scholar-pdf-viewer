/**
 * E2E：**多语言支持**（用户诉求）。
 *
 * > "页面要支持多种语言，先配置中英文，这个可以宿主通过固定json进行添加 要给出接口"
 *
 * ## 验证什么
 *
 * 1. 内置中英文能切换（工具栏的 aria-label 会变）
 * 2. **宿主能通过 JSON 添加一个新语言**（比如日语）→ 界面文案跟着变
 * 3. 宿主语言没写全 → **回退到内置**（不崩、不空）
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

/** 读工具栏上所有按钮的 aria-label */
async function readToolbarLabels() {
  return page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-toolbar__btn')]
      .map((b) => b.getAttribute('aria-label'))
      .filter(Boolean),
  );
}

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // ① 内置中文
  const zhLabels = await readToolbarLabels();
  check(
    '**内置中文文案生效**',
    zhLabels.includes('缩略图') && zhLabels.includes('目录'),
    zhLabels.slice(0, 4).join(' / '),
  );

  // ② 内置英文（demo 的语言切换器）
  /*
   * ⚠️ **不能再按中文 aria-label 找**（审计修复后它也是本地化的了）。
   * -> 在 en 模式下 aria-label 是 "Language" ❌
   * -> 改成：**按选项里有 'en' 来找**（语言无关）
   */
  const hasLangSelect = await page.evaluate(() =>
    [...document.querySelectorAll('select')].some((s) =>
      [...s.options].some((o) => o.value === 'en'),
    ),
  );
  check('**demo 提供语言切换器**', hasLangSelect);

  /** 切换语言 */
  async function switchLocale(value) {
    await page.evaluate((v) => {
      // ⚠️ 按【选项里有 en】找（语言无关）
      const select = [...document.querySelectorAll('select')].find((s) =>
        [...s.options].some((o) => o.value === 'en'),
      );
      if (!select) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value',
      ).set;
      setter.call(select, v);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
    await page.waitForTimeout(1200);
  }

  if (hasLangSelect) {
    await switchLocale('en');

    const enLabels = await readToolbarLabels();
    check(
      '**内置英文文案生效**',
      enLabels.includes('Thumbnails') && enLabels.includes('Outline'),
      enLabels.slice(0, 4).join(' / '),
    );

    // ③ 宿主通过 JSON 添加的语言（日语）
    await switchLocale('ja');

    const jaLabels = await readToolbarLabels();
    check(
      '**日语生效（内置的语言表）**',
      jaLabels.includes('目次'),
      jaLabels.slice(0, 4).join(' / '),
    );
    /*
     * ⚠️ **宿主的覆盖优先于内置**。
     * -> demo 覆盖了 `thumbnails.title` -> "ページ一覧"（不是内置的 "ページ"）
     */
    check(
      "**宿主的文案覆盖内置的（'ページ一覧'）**",
      jaLabels.includes('ページ一覧'),
      jaLabels.slice(0, 6).join(' / '),
    );

    // ④ 宿主语言没写全 → 回退到内置（英文）
    /*
     * ⚠️ **直接验包的接口**（比在 DOM 里找更可靠）。
     *
     * → 宿主 ja 表里写了 zoom.in / zoom.out / zoom.fitWidth / zoom.fitPage
     * → 但**没写** `zoom.reset` → 应该回退到内置英文 "Reset zoom"
     *
     * → ⚠️ "上一页"/"添加高亮"这些是**宿主自己的按钮**（不是包的文案）→ 不算数
     */
    const fallback = await page.evaluate(async () => {
      const mod = await import('/@fs/C:/work/scholar-pdf-viewer/dist/index.js').catch(() => null);
      if (!mod?.resolveMessage) return null;

      const ja = {
        'zoom.in': '拡大',
        'zoom.out': '縮小',
        'zoom.fitWidth': '幅に合わせる',
        'zoom.fitPage': 'ページ全体',
      };

      return {
        written: mod.resolveMessage('ja', 'zoom.in', undefined, undefined, { ja }),
        fallback: mod.resolveMessage('ja', 'zoom.reset', undefined, undefined, { ja }),
      };
    });

    check('**宿主写的文案生效**', fallback?.written === '拡大', fallback?.written ?? 'null');
    check(
      '**宿主没写的文案回退到内置（英文）**',
      fallback?.fallback === 'Reset zoom',
      fallback?.fallback ?? 'null',
    );

    // 切回中文（后续套件用中文）
    await switchLocale('zh');
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
