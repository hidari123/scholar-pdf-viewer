/**
 * E2E：宿主怎么**按需关掉**包的功能（`features`）。
 *
 * ⚠️ **为什么要有这个用例**（第 29 轮审核补的）：
 *
 * -> 之前 demo **完全没用过** `features` ❌
 *    -> 宿主看不到"怎么关掉某个功能" ❌
 *    -> `features` 是 **opt-out**（只有显式 `false` 才关）✅ -> **容易用错** ❌
 * -> 而且 `features.themePicker` **类型上原本不存在** ❌（第 29 轮才补上 ✅）
 *
 * 覆盖：
 * 1. 默认全开
 * 2. 关掉搜索 -> 搜索按钮消失
 * 3. 关掉缩略图 -> 缩略图按钮消失
 * 4. 关掉目录 -> 目录按钮消失
 * 5. 关掉打印 -> 打印按钮消失
 * 6. 关掉主题 -> 主题按钮消失
 * 7. 恢复 -> 全部回来
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { E2E_BASE_URL } from './e2e-base.mjs';

/**
 * 找到本机装的 Chromium（Playwright 默认的 headless shell 没装）。
 *
 * @returns {string | undefined} 可执行文件路径
 */
function resolveChromium() {
  const cacheRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(cacheRoot)) {
    return undefined;
  }
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

/** 断言计数 */
let passed = 0;
let failed = 0;

/**
 * 断言。
 *
 * @param {boolean} condition 条件
 * @param {string} message 说明
 */
function assert(condition, message) {
  if (condition) {
    passed += 1;
    console.log(`    ✓ ${message}`);
  } else {
    failed += 1;
    console.log(`    × ${message}`);
  }
}

/** 浏览器 */
const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
/** 页面 */
const page = await browser.newPage({ viewport: { width: 1442, height: 732 } });

/** 页面错误 */
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(6000);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 30000,
});
await page.waitForTimeout(2000);

/**
 * 工具栏里有没有某个按钮（按 aria-label 找）。
 *
 * @param {string} label aria-label
 * @returns {Promise<boolean>} 有没有
 */
async function hasToolbarButton(label) {
  return page.evaluate((wanted) => {
    const buttons = [...document.querySelectorAll('.scpdf-toolbar button')];
    return buttons.some((b) => (b.getAttribute('aria-label') || '') === wanted);
  }, label);
}

/**
 * 通过 demo 的测试 API 开关功能。
 *
 * @param {string[]} list 关掉的功能
 */
async function setDisabled(list) {
  await page.evaluate((features) => {
    window.__scpdfDemo.setDisabledFeatures(features);
  }, list);
  await page.waitForTimeout(1200);
}

console.log('\n=== 功能开关（features）===');

// ① 默认全开
const initial = {
  search: await hasToolbarButton('搜索文档'),
  thumbnails: await hasToolbarButton('缩略图'),
  outline: await hasToolbarButton('目录'),
  print: await hasToolbarButton('打印'),
  theme: await hasToolbarButton('主题'),
};
console.log('  默认状态:', JSON.stringify(initial));
assert(initial.search, '默认：搜索按钮在');
assert(initial.thumbnails, '默认：缩略图按钮在');
assert(initial.outline, '默认：目录按钮在');
assert(initial.print, '默认：打印按钮在');
assert(initial.theme, '默认：主题按钮在');

// ② 逐个关掉
await setDisabled(['search']);
assert(!(await hasToolbarButton('搜索文档')), '关掉搜索 -> 搜索按钮消失');
assert(await hasToolbarButton('打印'), '关掉搜索 -> 别的按钮不受影响');

await setDisabled(['thumbnails']);
assert(!(await hasToolbarButton('缩略图')), '关掉缩略图 -> 缩略图按钮消失');

await setDisabled(['outline']);
assert(!(await hasToolbarButton('目录')), '关掉目录 -> 目录按钮消失');

await setDisabled(['print']);
assert(!(await hasToolbarButton('打印')), '关掉打印 -> 打印按钮消失');

await setDisabled(['themePicker']);
assert(!(await hasToolbarButton('主题')), '关掉主题 -> 主题按钮消失');

// ③ 一次关多个
await setDisabled(['search', 'thumbnails', 'outline', 'print', 'themePicker']);
const allOff = {
  search: await hasToolbarButton('搜索文档'),
  thumbnails: await hasToolbarButton('缩略图'),
  outline: await hasToolbarButton('目录'),
  print: await hasToolbarButton('打印'),
  theme: await hasToolbarButton('主题'),
};
assert(
  !allOff.search && !allOff.thumbnails && !allOff.outline && !allOff.print && !allOff.theme,
  `一次关掉全部 -> 全都不在了（${JSON.stringify(allOff)}）`,
);

// ④ 恢复
await setDisabled([]);
const restored = {
  search: await hasToolbarButton('搜索文档'),
  thumbnails: await hasToolbarButton('缩略图'),
  outline: await hasToolbarButton('目录'),
  print: await hasToolbarButton('打印'),
  theme: await hasToolbarButton('主题'),
};
assert(restored.search, '恢复 -> 搜索按钮回来了');
assert(restored.thumbnails, '恢复 -> 缩略图按钮回来了');
assert(restored.outline, '恢复 -> 目录按钮回来了');
assert(restored.print, '恢复 -> 打印按钮回来了');
assert(restored.theme, '恢复 -> 主题按钮回来了');

// ⑤ 页面没崩
assert(pageErrors.length === 0, `没有 JS 错误（${pageErrors.length}）`);

await browser.close();

console.log(`\n通过 ${passed} / ${passed + failed}`);
if (failed > 0) {
  console.log(`失败 ${failed} 项`);
  process.exit(1);
}
