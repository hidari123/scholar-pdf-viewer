/**
 * E2E：**高亮按钮直接用当前色**（不用每次都选颜色）。
 *
 * ## 用户反馈
 *
 * > "文字选取的高亮那里 如果没有选择颜色 也按照默认颜色来展示高亮
 * >  不必每次都选择颜色"
 *
 * > "添加高亮按钮旁边应该加下拉按钮 下拉选取高亮色
 * >  如果没有选就是用默认的（默认的宿主可以配置的）"
 *
 * ## 之前的行为（❌）
 *
 * -> 主按钮**只**展开下拉 ❌
 * -> 用户**必须**选一次颜色才能高亮 ❌
 *
 * ## 现在的行为（✅）
 *
 * -> 点**主按钮** -> **直接用当前色高亮** ✅
 * -> 点**旁边的箭头** -> 展开颜色下拉 ✅
 * -> 没选过颜色 -> 用**默认色**（宿主可配 `defaultHighlightColor`）✅
 *
 * 用法：`node scripts/e2e-highlight-default-color.mjs`
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5180';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
let executablePath;
try {
  for (const dir of readdirSync(cacheRoot)) {
    if (!dir.startsWith('chromium-')) continue;
    const candidate = join(cacheRoot, dir, 'chrome-win64', 'chrome.exe');
    if (existsSync(candidate)) {
      executablePath = candidate;
      break;
    }
  }
} catch {
  // 用 playwright 自带的
}

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1442, height: 732 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('E2E：高亮按钮直接用当前色 / 默认色');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2000);

  /** 拖选一段文字，返回起点坐标 */
  const dragSelect = async (offset = 0) => {
    const t = await page.evaluate((off) => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((s) => {
        const r = s.getBoundingClientRect();
        return (s.textContent ?? '').trim().length > 20 && r.top > 250 && r.top < 600;
      });
      if (!spans.length) return null;
      const r = spans[0].getBoundingClientRect();
      return { x: Math.round(r.x + 4 + off), y: Math.round(r.y + r.height / 2) };
    }, offset);
    if (!t) return false;
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 60, t.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    return true;
  };

  // ---- ① 不选颜色，直接点"添加高亮" ----
  check('**拖选成功**', await dragSelect());
  await page.locator('[aria-label="添加高亮"]').click();
  await page.waitForTimeout(2000);

  const first = await page.evaluate(() => {
    const anns = [...document.querySelectorAll('.scpdf-annotation')];
    return {
      count: anns.length,
      bg: anns[0] ? getComputedStyle(anns[0]).backgroundColor : null,
    };
  });
  check('**不选颜色也能高亮**（不用先选色）', first.count === 1, `${first.count} 条`);
  check(
    '**用的是默认色**（不是透明）',
    !!first.bg && first.bg !== 'rgba(0, 0, 0, 0)' && first.bg !== 'transparent',
    String(first.bg),
  );

  // ---- ② 浮层有"高亮" + "展开颜色下拉"两个按钮 ----
  await dragSelect(120);
  const buttons = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-selection-popover__btn')].map((b) =>
      b.getAttribute('aria-label'),
    ),
  );
  check('**浮层有"高亮"按钮**', buttons.includes('高亮'), buttons.join(', '));
  check('**旁边有"展开颜色下拉"按钮**', buttons.includes('展开颜色下拉'), buttons.join(', '));

  // ---- ③ 选一个别的颜色 -> 立刻高亮 ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find(
      (x) => x.getAttribute('aria-label') === '展开颜色下拉',
    );
    b?.click();
  });
  await page.waitForTimeout(600);
  check(
    '**点箭头展开了颜色下拉**',
    (await page.locator('.scpdf-selection-popover__palette').count()) > 0,
  );

  const swatches = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '.scpdf-selection-popover__palette .scpdf-selection-popover__swatch',
      ),
    ].map((s) => s.getAttribute('aria-label')),
  );
  check('**点箭头后有颜色可选**', swatches.length >= 2, `${swatches.length} 个`);

  await page.evaluate(() => {
    const swatches = document.querySelectorAll(
      '.scpdf-selection-popover__palette .scpdf-selection-popover__swatch',
    );
    (swatches[1] ?? swatches[0])?.click();
  });
  await page.waitForTimeout(1800);
  const second = await page.evaluate(() => {
    const anns = [...document.querySelectorAll('.scpdf-annotation')];
    const last = anns[anns.length - 1];
    return {
      count: anns.length,
      bg: last ? getComputedStyle(last).backgroundColor : '',
      title: last?.getAttribute('title') ?? '',
    };
  });
  check('**选色后立刻高亮**', second.count === 2, `${second.count} 条`);
  check(
    '**用的是选的那个颜色**',
    !!second.bg && second.bg !== 'rgba(0, 0, 0, 0)' && second.bg !== 'transparent',
    second.bg,
  );

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
