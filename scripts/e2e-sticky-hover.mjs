/**
 * E2E：便签**好 hover**（热区够大 + 不移开就消失）。
 *
 * ## 用户反馈
 *
 * > "5. 批注还是很难hover上 试了很多次都失败了 无法hover上
 * >    鼠标一移开批注按钮 批注内容区域就消失了"
 *
 * ## 根因（实测）
 *
 * ### ① 目标太小
 *
 * ```
 * 便签图标: 22 × 22 px
 * 命中测试:
 *   (+11, +11) -> SVG
 *   (+2,  +2)  -> 图标
 *   (-2,  -2)  -> 文本层     ❌ 差 2px 就落空
 *   (+11, -3)  -> 文本层     ❌ 差 3px 就落空
 * ```
 *
 * ### ② 中间有 4px 空隙
 *
 * -> 内容框在 `left: 26px` -> 图标右边**有 4px 空隙** ❌
 * -> 鼠标从图标移向内容框 -> **穿过**空隙 -> 图标触发 `mouseleave` ❌
 * -> 之前**立刻**清状态 -> 内容框**瞬间消失** ❌
 *
 * ## 修法
 *
 * - 图标加 **36×36 的透明热区**（`::before`）-> 视觉不变，命中范围变大
 * - 加**透明桥接区**盖住那 4px 空隙
 * - **`mouseleave` 延迟 200ms** 才关 -> 中间那一瞬间不会消失
 *
 * 用法：`node scripts/e2e-sticky-hover.mjs`
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
    document.execCommand('insertText', false, '测试批注内容');
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-annotation-dialog__btn')].find((x) =>
      /保存|Save/i.test(x.getAttribute('aria-label') ?? x.textContent ?? ''),
    );
    b?.click();
  });
  await page.waitForTimeout(2200);

  const note = await page.evaluate(() => {
    const n = document.querySelector('.scpdf-sticky-note__icon');
    if (!n) {
      return null;
    }
    const r = n.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  check('便签建好了', note !== null, JSON.stringify(note));
  if (!note) {
    throw new Error('没有便签');
  }

  // ---- ② 热区够大（边缘也能命中）----
  const offsets = [
    [-4, -4],
    [26, 26],
    [11, -6],
    [-6, 11],
    [11, 11],
  ];
  const misses = [];
  for (const [dx, dy] of offsets) {
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const cls = el?.className?.toString?.() ?? '';
        return cls.includes('scpdf-sticky-note__icon');
      },
      [note.x + dx, note.y + dy],
    );
    if (!hit) {
      misses.push(`(+${dx},+${dy})`);
    }
  }
  check(
    '**热区够大**（图标四周也能命中，修复前差 2px 就落空）',
    misses.length === 0,
    misses.length ? `没命中: ${misses.join(' ')}` : `${offsets.length} 个偏移全部命中`,
  );

  // ---- ③ hover -> 内容框出现 ----
  const center = { x: Math.round(note.x + note.w / 2), y: Math.round(note.y + note.h / 2) };
  await page.mouse.move(center.x, center.y);
  await page.waitForTimeout(700);
  const hovered = await page.evaluate(() =>
    document.querySelector('.scpdf-sticky-note__content')?.getAttribute('data-visible'),
  );
  check('hover 图标 -> 内容框出现', hovered === 'true', String(hovered));

  // ---- ④ 移到内容框 -> **不会消失** ----
  const content = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-sticky-note__content');
    if (!el) {
      return null;
    }
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 10) };
  });
  check('内容框有位置', content !== null, JSON.stringify(content));
  if (content) {
    // 分步移动（模拟真实鼠标轨迹 -> 会穿过中间的 4px 空隙）
    await page.mouse.move(content.x, content.y, { steps: 12 });
    await page.waitForTimeout(500);
  }
  const stillVisible = await page.evaluate(() =>
    document.querySelector('.scpdf-sticky-note__content')?.getAttribute('data-visible'),
  );
  check('**鼠标移到内容框上，内容框没有消失**', stillVisible === 'true', String(stillVisible));

  // ---- ⑤ 里面的按钮能点到 ----
  const editBtn = await page.evaluate(() => {
    const b = document.querySelector('.scpdf-sticky-note__action');
    if (!b) {
      return null;
    }
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  check('内容框里有操作按钮', editBtn !== null, JSON.stringify(editBtn));
  if (editBtn) {
    await page.mouse.click(editBtn.x, editBtn.y);
    await page.waitForTimeout(1200);
  }
  const dialogOpen = await page.evaluate(() =>
    document.querySelector('.scpdf-root')?.getAttribute('data-dialog-open'),
  );
  check('**点内容框里的按钮能生效**', dialogOpen === 'true', String(dialogOpen));

  // ---- ⑥ 真的移开 -> 会关闭（不会粘着不走）----
  await page.mouse.move(20, 20);
  await page.waitForTimeout(800);
  const closed = await page.evaluate(() =>
    document.querySelector('.scpdf-sticky-note__content')?.getAttribute('data-visible'),
  );
  check('**鼠标真的移开后会关闭**', closed === 'false', String(closed));

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
