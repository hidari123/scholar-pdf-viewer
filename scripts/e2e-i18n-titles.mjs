/**
 * E2E：**选区浮层的 tooltip 跟着界面语言走**。
 *
 * ## 用户反馈
 *
 * > "选区的工具栏里面的中英文title还是会变来变去的
 * >  有时候hover上去 title显示中文 有时候英文 需要跟项目整体是一致的"
 *
 * ## 真因（实测）
 *
 * -> 色块的 `title` 之前直接写**原始色值**（`#ffd54a`）❌
 * -> 界面是中文也显示 `#ffd54a`，英文还是 `#ffd54a` ❌
 * -> -> **和界面语言完全脱节** ❌
 *
 * 用法：`node scripts/e2e-i18n-titles.mjs`
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

console.log('E2E：选区浮层的 tooltip 本地化');

/** 选一段文字（触发选区浮层） */
async function selectText() {
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const t = items.find((i) => i.textContent && i.textContent.trim().length > 40);
    if (!t) return;
    const r = t.getBoundingClientRect();
    const range = document.createRange();
    range.setStart(t.firstChild, 0);
    range.setEnd(t.firstChild, Math.min(30, t.firstChild.length ?? 30));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    t.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: r.x + 10, clientY: r.y + 8 }),
    );
  });
  await page.waitForTimeout(1200);
}

/** 展开颜色下拉 */
async function openPalette() {
  const split = page.locator('.scpdf-selection-popover__btn--split');
  if ((await split.count()) > 0) {
    await split.first().click();
    await page.waitForTimeout(700);
  }
}

/** 读浮层里所有 title */
async function readTitles() {
  return page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-selection-popover [title]')].map((b) => ({
      cls: b.className,
      title: b.getAttribute('title'),
      aria: b.getAttribute('aria-label'),
    })),
  );
}

/**
 * 切语言（按 **value** 切，不按 label）。
 *
 * ⚠️ **label 会跟着界面语言变** ❌
 * -> 中文界面里是"中文"，英文界面里就变成"Chinese" ❌
 * -> 按 label 找 -> 切回中文时找不到 ❌
 * -> -> 按 `value="zh"` 切 ✅
 */
async function switchLocale(value) {
  const selects = await page.locator('select').all();
  for (const s of selects) {
    const values = await s.locator('option').evaluateAll((os) => os.map((o) => o.value));
    if (values.includes(value)) {
      await s.selectOption(value);
      await page.waitForTimeout(1600);
      return true;
    }
  }
  return false;
}

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

  // ---------- 中文 ----------
  await selectText();
  await openPalette();

  const zh = await readTitles();
  console.log('   中文:', JSON.stringify(zh.map((t) => t.title)));

  check('**中文界面有 title**', zh.length > 0, `${zh.length} 个`);
  check(
    '**中文界面没有裸色值**（#xxxxxx）',
    zh.every((t) => !/^#[0-9a-f]{3,8}$/i.test(t.title ?? '')),
    zh.map((t) => t.title).join(' | '),
  );
  check(
    '**中文界面的 title 里有中文**',
    zh.some((t) => /[\u4e00-\u9fa5]/.test(t.title ?? '')),
  );
  check(
    '**title 和 aria-label 一致**',
    zh.every((t) => t.title === t.aria),
    zh
      .filter((t) => t.title !== t.aria)
      .map((t) => `${t.title} != ${t.aria}`)
      .join(' | '),
  );

  // ---------- 切英文 ----------
  const switched = await switchLocale('en');
  check('**能切到英文**', switched);

  await selectText();
  await openPalette();

  const en = await readTitles();
  console.log('   英文:', JSON.stringify(en.map((t) => t.title)));

  check('**英文界面有 title**', en.length > 0, `${en.length} 个`);
  check(
    '**英文界面没有裸色值**',
    en.every((t) => !/^#[0-9a-f]{3,8}$/i.test(t.title ?? '')),
    en.map((t) => t.title).join(' | '),
  );
  check(
    '**英文界面没有中文**',
    en.every((t) => !/[\u4e00-\u9fa5]/.test(t.title ?? '')),
    en.map((t) => t.title).join(' | '),
  );
  check(
    '**title 和 aria-label 一致**',
    en.every((t) => t.title === t.aria),
    en
      .filter((t) => t.title !== t.aria)
      .map((t) => `${t.title} != ${t.aria}`)
      .join(' | '),
  );

  // ---------- 切回中文，验证"跟着变" ----------
  const back = await switchLocale('zh');
  check('**能切回中文**', back);
  await selectText();
  await openPalette();
  const zh2 = await readTitles();
  check(
    '**切回中文后 title 也变回中文**',
    zh2.some((t) => /[\u4e00-\u9fa5]/.test(t.title ?? '')),
    zh2.map((t) => t.title).join(' | '),
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
