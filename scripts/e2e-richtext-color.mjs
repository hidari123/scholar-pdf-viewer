/**
 * E2E：批注编辑器 —— **文字颜色真的生效** + **清空格式真的清掉**。
 *
 * ## 为什么要有这个（用户反馈）
 *
 * > "富文本修改文字颜色的功能还是没有实现 点击会打开一个空的窄的框
 *    清空format这个功能的按钮和修改文字颜色的按钮一样 需要区分开"
 *
 * ## 三个真 bug
 *
 * 1. **TipTap 缺 `TextStyle` 扩展**
 *    -> `Color` 扩展是**基于 `textStyle` 实现的** -> `setColor` 直接抛错 ❌
 *    -> 报错："There is no mark type named 'textStyle'" ❌
 *    -> **文字颜色完全失效** ❌
 *
 * 2. **TipTap 没有颜色面板**
 *    -> 点"文字颜色"-> **直接应用第一个颜色** ❌
 *    -> 用户反馈："点击会打开一个空的窄的框" ❌
 *    -> 现在：**弹出颜色面板**（和内置编辑器一致）✅
 *
 * 3. **TipTap 的 `hiliteColor` 没传颜色值**
 *    -> 选哪个色都一样（用的是默认色）❌
 *
 * ## 怎么跑
 *
 * ```
 * node scripts/e2e-richtext-color.mjs
 * ```
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5180';

/** 找到 Playwright 的 Chromium（Windows 下不是标准路径） */
function findChromium() {
  const root = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (!existsSync(root)) {
    return undefined;
  }
  const dirs = readdirSync(root)
    .filter((n) => n.startsWith('chromium-'))
    .map((n) => ({ n, v: Number.parseInt(n.replace('chromium-', ''), 10) || 0 }))
    .sort((a, b) => b.v - a.v);
  for (const d of dirs) {
    const exe = join(root, d.n, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) {
      return exe;
    }
  }
  return undefined;
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

const exePath = findChromium();
const browser = await chromium.launch(exePath ? { executablePath: exePath } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // ---- 1. 选中文字 -> 打开批注弹窗 ----
  const target = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => (s.textContent ?? '').trim().length > 20,
    );
    const sp = spans.find((s) => {
      const r = s.getBoundingClientRect();
      return r.width > r.height * 2 && r.top > 250 && r.top < 500;
    });
    if (!sp) return null;
    const r = sp.getBoundingClientRect();
    return { x: r.x + 4, y: r.y + r.height / 2 };
  });
  check('找到可拖选的正文', !!target);

  if (target) {
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 80, target.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1200);

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
        (b.getAttribute('aria-label') ?? '').includes('批注'),
      );
      btn?.click();
    });
    await page.waitForTimeout(2500);
  }

  const hasEditor = await page.evaluate(() => !!document.querySelector('.ProseMirror'));
  check('批注弹窗的编辑器打开了', hasEditor);

  if (hasEditor) {
    // ---- 2. 在编辑器里打字 ----
    await page.evaluate(() => {
      const ed = document.querySelector('.ProseMirror');
      ed.focus();
      document.execCommand('insertText', false, 'Hello');
    });
    await page.waitForTimeout(600);

    /** 选中前 5 个字符 */
    const selectHello = async () =>
      page.evaluate(() => {
        const ed = document.querySelector('.ProseMirror');
        const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode();
        if (!node) return false;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, Math.min(5, node.textContent.length));
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
      });

    // ---- 3. "文字颜色"按钮要弹【颜色面板】（不是直接应用）----
    await selectHello();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.scpdf-rich-text__btn')].find(
        (x) => x.getAttribute('aria-label') === '文字颜色',
      );
      b?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      b?.click();
    });
    await page.waitForTimeout(800);

    const palette = await page.evaluate(() => {
      const p = document.querySelector('.scpdf-rich-text__palette');
      if (!p) return { exists: false };
      const r = p.getBoundingClientRect();
      return {
        exists: true,
        width: Math.round(r.width),
        height: Math.round(r.height),
        swatches: p.querySelectorAll('.scpdf-rich-text__swatch').length,
      };
    });
    check('**点"文字颜色"弹出颜色面板**（不是空的窄框）', palette.exists);
    check('**颜色面板里有色块**（>= 4 个）', palette.swatches >= 4, `${palette.swatches} 个色块`);
    check(
      '**颜色面板不是"空的窄框"**（宽度 >= 100px）',
      palette.width >= 100,
      `${palette.width}x${palette.height}`,
    );

    // ---- 4. 选一个颜色 -> 真的生效 ----
    await selectHello();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const sw = document.querySelector('.scpdf-rich-text__palette .scpdf-rich-text__swatch');
      sw?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      sw?.click();
    });
    await page.waitForTimeout(800);

    const afterColor = await page.evaluate(
      () => document.querySelector('.ProseMirror')?.innerHTML ?? '',
    );
    check('**选色后文字真的变色了**', /color/i.test(afterColor), afterColor.slice(0, 90));
    check('**没有 textStyle 扩展的报错**', !errors.some((e) => e.includes('textStyle')));

    // ---- 5. "清除格式"是**另一个按钮**，而且真的能清掉颜色 ----
    const btnKinds = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.scpdf-rich-text__btn')];
      const color = btns.find((b) => b.getAttribute('aria-label') === '文字颜色');
      const clear = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('清除格式'));
      return {
        hasColor: !!color,
        hasClear: !!clear,
        sameButton: color === clear,
        colorExpanded: color?.getAttribute('aria-expanded'),
      };
    });
    check('**有"文字颜色"按钮**', btnKinds.hasColor);
    check('**有"清除格式"按钮**', btnKinds.hasClear);
    check('**"文字颜色"和"清除格式"是两个不同的按钮**', !btnKinds.sameButton);

    await selectHello();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.scpdf-rich-text__btn')].find((x) =>
        (x.getAttribute('aria-label') ?? '').includes('清除格式'),
      );
      b?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      b?.click();
    });
    await page.waitForTimeout(800);

    const afterClear = await page.evaluate(
      () => document.querySelector('.ProseMirror')?.innerHTML ?? '',
    );
    check('**点"清除格式"后颜色真的清掉了**', !/color/i.test(afterClear), afterClear.slice(0, 90));
    check('**文字还在**（没被清空）', afterClear.includes('Hello'));
  }

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  console.log(`FAIL 运行异常 - ${String(error).slice(0, 200)}`);
  failed += 1;
} finally {
  await browser.close();
}

console.log(`\n结果：${passed}/${passed + failed} 通过`);
if (failed > 0) {
  process.exitCode = 1;
}
