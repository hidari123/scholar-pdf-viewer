/**
 * E2E：合并组的"选择批注"列表 -> 渲染富文本 + 点某项打开那一条的详情。
 *
 * ## 用户反馈
 *
 * > "这里 第一展示有问题 没有渲染出html 第二 点击每一项没反应
 * >  应该打开对应项的便签详情 然后可以编辑"
 *
 * ## 根因
 *
 * -> **HTML 没渲染**：\`{record.content.slice(0, 60)}\` -> React **转义** ✅
 *    -> 用户看到字面量 `<p>第一条</p>` ❌
 *    -> 实测：\`itemHTML: "&lt;p&gt;第一条&lt;/p&gt;"\` ❌
 * -> **点了没反应**：只调 \`onAnnotationClick\`（宿主的通知回调）❌
 *    -> demo 里只是 \`setHint(...)\` -> **看不到任何变化** ❌
 *
 * ## 修法
 *
 * - 用 \`<RichTextPreview>\` 渲染（**自带消毒**）✅
 * - 点某项 -> 调 \`onAnnotationExpand\` -> **打开那一条的详情** ✅
 * - 点某项 -> **关闭选择列表**（别挡住详情）✅
 *
 * 用法：`node scripts/e2e-sticky-picker.mjs`
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5180';

/** 找 Playwright 的 Chromium */
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

let pass = 0;
let fail = 0;

/**
 * 断言。
 *
 * @param {string} name 名称
 * @param {boolean} ok 是否通过
 * @param {string} [detail] 详情
 */
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS **${name}**${detail ? ` - ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL **${name}**${detail ? ` - ${detail}` : ''}`);
  }
}

const browser = await chromium.launch(findChromium() ? { executablePath: findChromium() } : {});
const page = await browser.newPage({ viewport: { width: 1442, height: 732 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  /** 拖选一小段 */
  const dragSelect = async (y, len) => {
    const t = await page.evaluate(
      ([yy, _ll]) => {
        const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
          (s) => (s.textContent ?? '').trim().length > 20,
        );
        const sp = spans.find((s) => {
          const r = s.getBoundingClientRect();
          return r.width > r.height * 2 && r.top > yy && r.top < yy + 150;
        });
        if (!sp) {
          return null;
        }
        const r = sp.getBoundingClientRect();
        return { x: r.x + 4, y: r.y + r.height / 2 };
      },
      [y, len],
    );
    if (!t) {
      return false;
    }
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + len, t.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    return true;
  };

  // ---- ① 建两条批注（同一行 -> 合并组）----
  for (const [len, text] of [
    [40, '第一条'],
    [80, '第二条'],
  ]) {
    await dragSelect(250, len);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
        (b.getAttribute('aria-label') ?? '').includes('批注'),
      );
      btn?.click();
    });
    await page.waitForTimeout(2000);
    await page.evaluate((t) => {
      const ed = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
      if (ed) {
        ed.focus();
        document.execCommand('insertText', false, t);
      }
    }, text);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.scpdf-annotation-dialog__btn')].find((x) =>
        /保存|Save/i.test(x.getAttribute('aria-label') ?? x.textContent ?? ''),
      );
      b?.click();
    });
    await page.waitForTimeout(2000);
  }

  const groupCount = await page.evaluate(
    () => document.querySelectorAll('.scpdf-sticky-note[data-group="true"]').length,
  );
  check('两条批注合并成一个图标', groupCount > 0, `${groupCount} 组`);

  // ---- ② hover -> 弹出选择列表 ----
  const note = await page.evaluate(() => {
    const n = document.querySelector('.scpdf-sticky-note__icon');
    if (!n) {
      return null;
    }
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (note) {
    await page.mouse.move(note.x, note.y);
    await page.waitForTimeout(900);
  }

  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-sticky-note__picker-item')].map((i) => ({
      text: (i.textContent ?? '').trim(),
      hasParagraph: i.querySelector('p') !== null,
      html: i.innerHTML,
    })),
  );
  check('选择列表弹出来了', items.length === 2, `${items.length} 项`);
  check(
    '**每一项都渲染成了富文本**（真的有 <p> 标签）',
    items.length > 0 && items.every((i) => i.hasParagraph),
    JSON.stringify(items.map((i) => i.html.slice(0, 80))),
  );
  check(
    '**没有把 HTML 转义成文本**（之前是 `&lt;p&gt;`）',
    items.length > 0 && !items.some((i) => i.html.includes('&lt;')),
    '',
  );
  check('第一项内容正确', items[0]?.text.includes('第一条'), items[0]?.text ?? '');
  check('第二项内容正确', items[1]?.text.includes('第二条'), items[1]?.text ?? '');

  // ---- ③ 点第一项 -> 打开"那一条"的详情 ----
  const item = await page.evaluate(() => {
    const el = document.querySelectorAll('.scpdf-sticky-note__picker-item')[0];
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (item) {
    await page.mouse.click(item.x, item.y);
    await page.waitForTimeout(1500);
  }

  const after = await page.evaluate(() => ({
    panel: !!document.querySelector('.scpdf-annotation-panel'),
    content: document.querySelector('.scpdf-annotation-panel__content')?.textContent?.slice(0, 20),
    pickerVisible: document
      .querySelector('.scpdf-sticky-note__picker')
      ?.getAttribute('data-visible'),
    hasEditBtn: [...document.querySelectorAll('.scpdf-annotation-panel__btn')].some((b) =>
      (b.getAttribute('aria-label') ?? '').includes('编辑'),
    ),
  }));
  check('**点某项打开了详情面板**', after.panel, JSON.stringify(after));
  check(
    '**打开的是"那一条"的详情**',
    (after.content ?? '').includes('第一条'),
    after.content ?? '',
  );
  check(
    '**选择列表关掉了**（别挡住详情）',
    after.pickerVisible === 'false',
    String(after.pickerVisible),
  );
  check('**详情里有"编辑"按钮**（可以编辑）', after.hasEditBtn, '');

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  console.log(`  FAIL 运行出错：${error?.message ?? error}`);
  fail += 1;
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) {
  process.exitCode = 1;
}
