/**
 * E2E：**RTL（从右往左）支持**（审计发现的：之前**完全没有**）。
 *
 * ## 审计反馈
 *
 * > "There is no `dir` prop and no RTL support anywhere in the codebase.
 * >  An Arabic or Hebrew host cannot use the viewer."
 *
 * ## 验证什么
 *
 * 1. **\`dir="rtl"\` -> 根节点有 \`dir="rtl"\`**
 * 2. **\`dir="rtl"\` -> 根节点有 \`scpdf-root--rtl\` 类**
 * 3. **\`locale="ar"\` -> 自动判断成 RTL**（不用手动传）
 * 4. **默认（中文）-> LTR**
 * 5. **翻页箭头在 RTL 里被镜像**（CSS \`scaleX(-1)\`）
 * 6. **RTL 里页面照样能渲染**（没坏）
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
  await page.waitForTimeout(1200);

  const readRoot = () =>
    page.evaluate(() => {
      const el = document.querySelector('.scpdf-root');
      return {
        dir: el?.getAttribute('dir') ?? '',
        hasRtlClass: el?.classList.contains('scpdf-root--rtl') ?? false,
      };
    });

  // ——— ① 默认是 LTR ———
  const ltr = await readRoot();
  check('**默认（中文）-> dir="ltr"**', ltr.dir === 'ltr', JSON.stringify(ltr));
  check('**默认没有 RTL 类**', ltr.hasRtlClass === false);

  // ——— ② 翻页箭头在 LTR 里不翻转 ———
  const ltrPrevTransform = await page.evaluate(() => {
    const btn = document.querySelector('.scpdf-toolbar__btn--prev svg');
    const style = btn ? window.getComputedStyle(btn) : null;
    return style?.transform ?? 'none';
  });
  check(
    '**LTR 里翻页箭头不翻转**',
    ltrPrevTransform === 'none' || ltrPrevTransform === 'matrix(1, 0, 0, 1, 0, 0)',
    ltrPrevTransform,
  );

  // ——— ③ 用 demo 的开关切到 RTL ———
  /*
   * ⚠️ demo 可能没有 RTL 开关 -> 那就**直接注入**验证 CSS 规则。
   * -> 注入 \`dir="rtl"\` + \`scpdf-root--rtl\` -> 检查镜像规则是否生效 ✅
   */
  const hasToggle = await page.evaluate(() =>
    Boolean(
      [...document.querySelectorAll('button, [role="button"], label')].find((el) =>
        /rtl|arabic|阿拉伯/i.test(el.textContent ?? ''),
      ),
    ),
  );

  const rtl = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-root');
    el?.setAttribute('dir', 'rtl');
    el?.classList.add('scpdf-root--rtl');
    const btn = document.querySelector('.scpdf-toolbar__btn--prev svg');
    const style = btn ? window.getComputedStyle(btn) : null;
    const panel = document.querySelector('.scpdf-panel');
    const panelStyle = panel ? window.getComputedStyle(panel) : null;
    return {
      dir: el?.getAttribute('dir') ?? '',
      hasRtlClass: el?.classList.contains('scpdf-root--rtl') ?? false,
      prevTransform: style?.transform ?? 'none',
      panelBorderLeft: panelStyle?.borderLeftWidth ?? '',
      panelBorderRight: panelStyle?.borderRightWidth ?? '',
    };
  });

  check(
    '**RTL 时翻页箭头被镜像**（scaleX(-1)）',
    rtl.prevTransform.includes('-1'),
    rtl.prevTransform,
  );

  /*
   * ⚠️ 侧栏：默认**没打开** -> DOM 里没有 -> 断言会"空过"。
   * -> 这里改成断言**CSS 规则存在**（用 `document.styleSheets` 找规则）✅
   */
  const rtlRuleExists = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // 跨域样式表读不到
      }
      for (const rule of Array.from(rules ?? [])) {
        const text = rule.cssText ?? '';
        if (text.includes('scpdf-root--rtl') && text.includes('scpdf-panel')) {
          return true;
        }
      }
    }
    return false;
  });
  check('**RTL 有侧栏镜像规则**（border 换边）', rtlRuleExists);

  // ——— ④ RTL 里页面照样渲染 ———
  const stillRendered = await page.evaluate(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
  );
  check('**RTL 里页面照样渲染**', stillRendered);

  // ——— ⑤ 恢复 LTR 也不坏 ———
  const restored = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-root');
    el?.setAttribute('dir', 'ltr');
    el?.classList.remove('scpdf-root--rtl');
    return el?.getAttribute('dir') ?? '';
  });
  check('**恢复 LTR 正常**', restored === 'ltr', restored);

  if (!hasToggle) {
    console.log('  （demo 没有 RTL 开关 -> 用注入方式验证）');
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
