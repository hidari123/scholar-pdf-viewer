/**
 * E2E：便签详情（"展开"）-> 贴着便签 + 默认只读 + 点"编辑"就地变编辑器。
 *
 * ## 用户反馈
 *
 * > "4. 批注的打开详细按钮目前是失效的 需要点击能打开一个稍微大一点的便利贴的样式"
 * > "便签详情打开的时候也是要有按钮可以选编辑的 选择编辑的时候便签详情就消失隐藏"
 *
 * ## 根因
 *
 * -> **demo 根本没传 `onAnnotationExpand`** -> 包**不渲染**"展开"按钮 ❌
 * -> 面板固定在"页面中间偏右" -> 便签在 `x=571`、面板在 `x=918` -> **离得很远** ❌
 * -> 面板**直接进编辑器** -> 不像"详情" ❌
 *
 * ## 修法
 *
 * - demo 补上 `onAnnotationExpand` + `onAnnotationChange` ✅
 * - 面板**贴着便签**（`anchorRect`）-> 右边放不下就翻到左边 ✅
 * - 面板**默认只读** + 标题栏加 **"编辑"按钮** -> 点它**就地变成编辑器** ✅
 *
 * 用法：`node scripts/e2e-annotation-detail.mjs`
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
  const dragSelect = async (y) => {
    const t = await page.evaluate((yy) => {
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
    }, y);
    if (!t) {
      return false;
    }
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 60, t.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(1000);
    return true;
  };

  // ---- ① 建一条批注 ----
  await dragSelect(250);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('批注'),
    );
    btn?.click();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const ed = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    ed?.focus();
    document.execCommand('insertText', false, '原始内容');
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-annotation-dialog__btn')].find((x) =>
      /保存|Save/i.test(x.getAttribute('aria-label') ?? x.textContent ?? ''),
    );
    b?.click();
  });
  await page.waitForTimeout(2200);

  const noteCount = await page.evaluate(
    () => document.querySelectorAll('.scpdf-sticky-note__icon').length,
  );
  check('便签建好了', noteCount > 0, `${noteCount} 个`);

  // ---- ② hover 便签 -> 有"展开"按钮 ----
  const note = await page.evaluate(() => {
    const n = document.querySelector('.scpdf-sticky-note__icon');
    if (!n) {
      return null;
    }
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  check('便签图标存在', note !== null, JSON.stringify(note));
  if (note) {
    await page.mouse.move(note.x, note.y);
    await page.waitForTimeout(900);
  }

  const actions = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-sticky-note__action')].map((b) =>
      b.getAttribute('aria-label'),
    ),
  );
  check(
    '**便签上有"展开"按钮**（之前压根没渲染）',
    actions.some((a) => (a ?? '').includes('展开')),
    actions.join(','),
  );

  // ---- ③ 点"展开" -> 打开详情面板 ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-sticky-note__action')].find((x) =>
      (x.getAttribute('aria-label') ?? '').includes('展开'),
    );
    b?.click();
  });
  await page.waitForTimeout(1200);

  const opened = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-panel');
    if (!p) {
      return null;
    }
    const r = p.getBoundingClientRect();
    const n = document.querySelector('.scpdf-sticky-note__icon')?.getBoundingClientRect();
    return {
      panel: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) },
      panelStyle: `${p.style.left}/${p.style.top}`,
      containerRect: (() => {
        const c = document.querySelector('.scpdf-container')?.getBoundingClientRect();
        return c ? `${Math.round(c.x)},${Math.round(c.y)}` : null;
      })(),
      noteIconExists: !!document.querySelector('.scpdf-sticky-note__icon[data-note-id]'),
      icons: [...document.querySelectorAll('.scpdf-sticky-note__icon')].map((e) => {
        const r = e.getBoundingClientRect();
        return { id: e.getAttribute('data-note-id'), x: Math.round(r.x), y: Math.round(r.y) };
      }),
      matchedBySelector: (() => {
        const c = document.querySelector('.scpdf-container');
        const el = c?.querySelector(
          `.scpdf-sticky-note__icon[data-note-id="${CSS.escape('note-h-1')}"]`,
        );
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), bottom: Math.round(r.bottom) };
      })(),
      note: n ? { x: Math.round(n.x), y: Math.round(n.y), w: Math.round(n.width) } : null,
      hasEditor: !!p.querySelector('.ProseMirror'),
      btns: [...p.querySelectorAll('.scpdf-annotation-panel__btn')].map((b) =>
        b.getAttribute('aria-label'),
      ),
      content: p.querySelector('.scpdf-annotation-panel__content')?.textContent?.slice(0, 20),
    };
  });
  check('**详情面板打开了**', opened !== null, JSON.stringify(opened?.panel));
  check(
    '**详情面板是"只读"的**（默认不是编辑器）',
    opened?.hasEditor === false,
    `hasEditor=${opened?.hasEditor}`,
  );
  check(
    '**详情面板显示的是富文本内容**',
    (opened?.content ?? '').includes('原始内容'),
    opened?.content ?? '',
  );
  check(
    '**详情面板有"编辑"按钮**',
    (opened?.btns ?? []).some((b) => (b ?? '').includes('编辑')),
    (opened?.btns ?? []).join(','),
  );

  // ---- ④ 面板贴着便签（不是离得很远）----
  const gap =
    opened?.panel && opened?.note
      ? Math.abs(opened.panel.x - (opened.note.x + opened.note.w))
      : Number.POSITIVE_INFINITY;
  check('**详情面板贴在便签旁边**（不是离得很远）', gap < 60, `距离 ${Math.round(gap)}px`);

  /*
   * ⚠️ **垂直方向也要在便签附近**（用户反馈：
   * "批注详情目前是出现在pdf的最上方 应该定位在批注按钮附近的"❌）。
   *
   * -> 之前**偏了 124px**（视口坐标当成了容器坐标）❌
   * -> 面板整体下移 -> "出现在 PDF 的最上方"❌
   */
  const verticalGap =
    opened?.panel && opened?.note
      ? Math.abs(opened.panel.y - opened.note.y)
      : Number.POSITIVE_INFINITY;
  check(
    '**详情面板在便签的垂直位置附近**（不是跑到 PDF 最上方）',
    verticalGap < 80,
    `垂直距离 ${Math.round(verticalGap)}px（便签 y=${opened?.note?.y} 面板 y=${opened?.panel?.y}）`,
  );

  // ---- ⑤ 点"编辑" -> 就地变成编辑器 ----
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-annotation-panel__btn')].find((x) =>
      (x.getAttribute('aria-label') ?? '').includes('编辑'),
    );
    b?.click();
  });
  await page.waitForTimeout(1000);

  const editing = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-panel');
    if (!p) {
      return null;
    }
    return {
      hasEditor: !!p.querySelector('.ProseMirror'),
      btns: [...p.querySelectorAll('.scpdf-annotation-panel__btn')].map((b) =>
        b.getAttribute('aria-label'),
      ),
    };
  });
  check('**点"编辑"后变成编辑器**', editing?.hasEditor === true, `hasEditor=${editing?.hasEditor}`);
  check(
    '**编辑时按钮变成"完成"**',
    (editing?.btns ?? []).some((b) => (b ?? '').includes('完成')),
    (editing?.btns ?? []).join(','),
  );

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
