/**
 * E2E：**没选文字时只有"清除格式"置灰**。
 *
 * ## 用户反馈（第 27 轮的更正）
 *
 * > "没选字时格式按钮置灰这个你修错了 应该是没选字的时候清除格式按钮置灰
 * >  其他的还是可以用的"
 * >
 * > "在刚进去的时候没有修改历史记录的时候，撤销和重做还有清除格式按钮都是置灰的；
 * >  如果选择了文字 清除按钮就恢复；其他的方面撤销和重做按照现有逻辑是可以的；
 * >  其余按钮都是可以点击的。"
 *
 * ## 逻辑
 *
 * | 场景 | 撤销 | 重做 | 清除格式 | 其余按钮 |
 * |---|---|---|---|---|
 * | 刚进去 | 置灰 | 置灰 | 置灰 | **全部可用** |
 * | 选了文字 | 按逻辑 | 按逻辑 | 恢复 | **全部可用** |
 *
 * 用法：`node scripts/e2e-editor-disabled-state.mjs`
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
const page = await browser.newPage({ viewport: { width: 1442, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('E2E：没选文字时只有"清除格式"置灰');

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(5000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2000);

  // ---- 打开批注弹窗（里面有富文本编辑器）----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((s) => {
      const r = s.getBoundingClientRect();
      return (s.textContent ?? '').trim().length > 20 && r.top > 250 && r.top < 600;
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: Math.round(r.x + 4), y: Math.round(r.y + r.height / 2) };
  });
  check('**找到文字**', !!t);

  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  await page.mouse.move(t.x + 60, t.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('批注'),
    );
    btn?.click();
  });
  await page.waitForTimeout(2200);

  const editorOpen = await page.evaluate(
    () => !!document.querySelector('.scpdf-annotation-dialog .ProseMirror'),
  );
  check('**批注弹窗打开了**', editorOpen);

  /** 读每个按钮的置灰状态 */
  const readStates = () =>
    page.evaluate(() => {
      const out = {};
      for (const btn of document.querySelectorAll(
        '.scpdf-annotation-dialog .scpdf-rich-text__btn',
      )) {
        const label = btn.getAttribute('aria-label') ?? '';
        if (label) out[label] = btn.hasAttribute('disabled');
      }
      return out;
    });

  // ---- ① 没选文字 ----
  const before = await readStates();
  console.log('   状态:', JSON.stringify(before));
  check('**没选文字时"清除格式"置灰**', before.清除格式 === true, String(before.清除格式));
  check('**没选文字时"撤销"置灰**（刚进去没有历史）', before.撤销 === true, String(before.撤销));
  check('**没选文字时"重做"置灰**（刚进去没有历史）', before.重做 === true, String(before.重做));
  for (const label of [
    '加粗',
    '斜体',
    '下划线',
    '删除线',
    '文字颜色',
    '高亮',
    '链接',
    '无序列表',
    '引用',
  ]) {
    check(`**"${label}"没选字也能点**`, before[label] === false, String(before[label]));
  }

  // ---- ② 选了文字 -> 清除格式恢复 ----
  await page.evaluate(() => {
    const ed = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    ed?.focus();
    document.execCommand('insertText', false, '测试文字');
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const ed = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    const range = document.createRange();
    range.selectNodeContents(ed);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.waitForTimeout(900);
  const after = await readStates();
  console.log('   状态:', JSON.stringify(after));
  check('**选了文字后"清除格式"恢复可用**', after.清除格式 === false, String(after.清除格式));

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
