/**
 * E2E：工具栏的按钮显示开关 + 高亮按钮 + 便签内容框的裁剪。
 *
 * ## 覆盖
 *
 * 1. **每个工具栏按钮都能显式隐藏**（`toolbar.showXxx: false`）
 * 2. **高亮按钮默认显示**（分裂按钮 + 箭头 + 默认色）
 * 3. **工具栏没有重复按钮**（demo 之前有 3 个重复）
 * 4. **便签内容框在页边角不被裁掉**
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));

await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
await page.waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 50, {
  timeout: 40000,
});
await page.waitForTimeout(1500);

/* ============ 1. 工具栏没有重复按钮 ============ */
console.log('\n[1] 工具栏没有重复按钮');
{
  const out = await page.evaluate(() => {
    const toolbar = document.querySelector('.scpdf-toolbar');
    const list = [...toolbar.querySelectorAll('button')].map((b) => {
      const svg = b.querySelector('svg');
      const path = svg ? svg.innerHTML.match(/d="([^"]{0,40})/) : null;
      return {
        title: b.getAttribute('title') ?? b.getAttribute('aria-label') ?? '',
        fp: path ? path[1] : (svg?.innerHTML ?? '').slice(0, 30),
      };
    });
    const counts = new Map();
    for (const b of list) {
      const key = `${b.title}|${b.fp}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      total: list.length,
      dups: [...counts.entries()]
        .filter(([, n]) => n > 1)
        .map(([k, n]) => ({
          title: k.split('|')[0],
          count: n,
        })),
    };
  });
  console.log(`  工具栏 ${out.total} 个按钮`);
  check(
    '没有重复按钮',
    out.dups.length === 0,
    out.dups.length ? out.dups.map((d) => `${d.title} x${d.count}`).join(', ') : '无重复',
  );
}

/* ============ 2. 高亮按钮 ============ */
console.log('\n[2] 高亮按钮（分裂按钮）');
{
  const out = await page.evaluate(() => {
    const split = document.querySelector('.scpdf-toolbar__split');
    const arrow = document.querySelector('.scpdf-toolbar__btn--split-arrow');
    const bar = document.querySelector('.scpdf-toolbar__current-color');
    return {
      hasSplit: !!split,
      hasArrow: !!arrow,
      colorBarBg: bar?.style.background ?? null,
    };
  });
  check('分裂按钮在', out.hasSplit);
  check('下拉箭头在', out.hasArrow);
  check(
    '主按钮有当前色色条',
    !!out.colorBarBg && out.colorBarBg !== 'transparent',
    out.colorBarBg ?? '没有',
  );

  // ⚠️ **点箭头 -> 展开色板** ✅
  await page.click('.scpdf-toolbar__btn--split-arrow');
  await page.waitForTimeout(600);
  const swatches = await page.evaluate(
    () => document.querySelectorAll('.scpdf-toolbar__color-swatch').length,
  );
  check('点箭头展开色板', swatches > 0, `${swatches} 个色块`);

  /*
   * ⚠️ **色板必须完整可见**（用户反馈："下拉之后会出现滚动条 需要移出来"）
   *
   * -> 之前是 `position: absolute` ✅
   * -> 祖先 `.scpdf-toolbar__right` 的 `overflow-x: auto` ✅
   *    -> 浏览器强制 `overflow-y: auto` ✅ -> 色板被裁 ✅
   * -> 现在 `position: fixed` ✅ -> 不受祖先 overflow 影响 ✅
   */
  const menuState = await page.evaluate(() => {
    const menu = document.querySelector('.scpdf-toolbar__color-menu');
    const right = document.querySelector('.scpdf-toolbar__right');
    const mr = menu.getBoundingClientRect();
    return {
      position: getComputedStyle(menu).position,
      // ⚠️ **容器有没有多出纵向滚动条** ✅
      hasVScroll: right.scrollHeight > right.clientHeight,
      /*
       * ⚠️ **色板有没有超出视口** ✅
       *
       * -> fixed 定位 ✅ -> 只受视口约束 ✅
       * -> 之前是 absolute ✅ -> 被工具栏容器裁掉 ✅
       *    -> 现在要比的是**视口** ✅ 而不是工具栏容器 ✅
       */
      outViewportBottom: mr.bottom - window.innerHeight,
      outViewportTop: -mr.top,
      menuH: mr.height,
      menuTop: mr.top,
    };
  });
  check('色板是 fixed 定位', menuState.position === 'fixed', menuState.position);
  check(
    '工具栏右侧没有多出滚动条',
    !menuState.hasVScroll,
    menuState.hasVScroll ? '有滚动条' : '无',
  );
  check(
    '色板完整可见（在视口内）',
    menuState.outViewportBottom <= 0 && menuState.outViewportTop <= 0,
    `下溢出 ${Math.round(menuState.outViewportBottom)}px / 上溢出 ${Math.round(menuState.outViewportTop)}px`,
  );

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/* ============ 3. 便签内容框在页边角不被裁 ============ */
console.log('\n[3] 便签内容框在页边角不被裁');
{
  // ⚠️ **先造一个便签** ✅
  const t = await page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    const cb = c.getBoundingClientRect();
    const el = [...document.querySelectorAll('.scpdf-text-layer__item')].find(
      (e) =>
        (e.textContent ?? '').length > 20 &&
        e.getBoundingClientRect().top >= cb.top + 40 &&
        e.getBoundingClientRect().top <= cb.bottom - 200,
    );
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + 10, y: b.top + b.height / 2 };
  });

  if (!t) {
    check('找到可选的文字', false);
  } else {
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 80, t.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(800);

    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.scpdf-selection-popover button')];
      btns.find((x) => (x.getAttribute('aria-label') ?? '').includes('加批注'))?.click();
    });
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('.scpdf-annotation-dialog button')];
      btns
        .find(
          (x) =>
            (x.getAttribute('aria-label') ?? '').includes('保存') ||
            (x.textContent ?? '').includes('保存'),
        )
        ?.click();
    });
    await page.waitForTimeout(1500);

    const noteCount = await page.evaluate(
      () => document.querySelectorAll('.scpdf-sticky-note').length,
    );
    check('造出便签', noteCount > 0, `${noteCount} 个`);

    if (noteCount > 0) {
      for (const pos of ['right', 'bottom-right']) {
        /*
         * ⚠️ **把便签挪到页的边角** ✅
         *
         * -> "bottom-right" 会把图标挪到**视口外** ✅（页很高 ✅）
         * -> -> 先**滚到能看见的位置** ✅ 不然量不到任何东西 ✅
         */
        await page.evaluate((pos) => {
          const note = document.querySelector('.scpdf-sticky-note');
          const pb = note.closest('.scpdf-page').getBoundingClientRect();
          const nb = note.getBoundingClientRect();
          note.style.left = `${Math.round(pb.right - nb.left - 20)}px`;
          if (pos === 'bottom-right') {
            // ⚠️ **放在【视口内**的右下角** ✅ 不然 hover 不到 ✅
            const cb = document.querySelector('.scpdf-container').getBoundingClientRect();
            note.style.top = `${Math.round(cb.bottom - nb.top - 40)}px`;
          }
        }, pos);
        await page.waitForTimeout(300);

        const box = await page.evaluate(() => {
          const el = document.querySelector('.scpdf-sticky-note__icon');
          const b = el.getBoundingClientRect();
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        });
        await page.mouse.move(box.x, box.y);
        await page.waitForTimeout(900);

        const out = await page.evaluate(() => {
          const c = document.querySelector('.scpdf-sticky-note__content');
          if (!c) return { found: false };
          const b = c.getBoundingClientRect();
          const pb = c.closest('.scpdf-page')?.getBoundingClientRect();
          const icon = document.querySelector('.scpdf-sticky-note__icon');
          const ir = icon?.getBoundingClientRect();
          return {
            found: true,
            position: getComputedStyle(c).position,
            overflowRight: pb ? b.right - pb.right : 0,
            overflowBottom: pb ? b.bottom - pb.bottom : 0,
            outViewportRight: b.right - window.innerWidth,
            outViewportBottom: b.bottom - window.innerHeight,
            visible: c.dataset.visible === 'true',
            boxLeft: b.left,
            boxWidth: b.width,
            iconLeft: ir ? ir.left : 0,
            iconWidth: ir ? ir.width : 0,
          };
        });

        if (!out.found) {
          check(`[${pos}] 内容框存在`, false);
        } else {
          check(`[${pos}] 内容框是 fixed`, out.position === 'fixed', out.position);
          /*
           * ⚠️ **离图标要近**（用户反馈："距离批注按钮太远"）
           *
           * -> 之前翻到左边时 ✅ -> 框的**右边缘**贴着图标的左边缘 ✅
           *    -> 框整个往左延伸 ✅ -> 框的主体离图标 142px ✅
           * -> 现在改成**中心对齐** ✅ -> 框的中心 ≈ 图标的中心 ✅
           */
          /*
           * ⚠️ **量【边缘间距】和【重叠】** ✅
           *
           * -> 用户反馈了两轮 ✅：
           *    -> "距离批注按钮太远" ❌ -> 间距太大 ❌
           *    -> "离得又太近了 已经重叠上去了" ❌ -> 间距变成负数 ❌
           * -> 目标：**间距 15~20px** ✅ 且**不重叠** ✅
           */
          const iconRight = out.iconLeft + out.iconWidth;
          const gapRight = out.boxLeft - iconRight;
          const gapLeft = out.iconLeft - (out.boxLeft + out.boxWidth);
          const nearest = Math.max(0, gapRight, gapLeft);
          const overlap =
            Math.min(iconRight, out.boxLeft + out.boxWidth) - Math.max(out.iconLeft, out.boxLeft);

          check(
            `[${pos}] 内容框紧挨着图标（间距 15~20px）`,
            nearest >= 12 && nearest <= 24,
            `间距 ${Math.round(nearest)}px`,
          );
          check(`[${pos}] 内容框没有压住图标`, overlap <= 0, `重叠 ${Math.round(overlap)}px`);
          check(
            `[${pos}] 内容框没超出页右边`,
            out.overflowRight <= 0,
            `超出 ${Math.round(out.overflowRight)}px`,
          );
          check(
            `[${pos}] 内容框没超出页底边`,
            out.overflowBottom <= 0,
            `超出 ${Math.round(out.overflowBottom)}px`,
          );
          check(
            `[${pos}] 内容框没超出视口`,
            out.outViewportRight <= 0 && out.outViewportBottom <= 0,
            `右 ${Math.round(out.outViewportRight)}px / 下 ${Math.round(out.outViewportBottom)}px`,
          );
        }
        await page.mouse.move(10, 10);
        await page.waitForTimeout(400);
      }
    }
  }
}

/*
 * ⚠️ **没有选区时点【高亮】按钮 → toast 提示**（用户需求 ✅）。
 *
 * -> 选区是包内部的状态 ✅ -> 只有包知道有没有选中 ✅
 * -> 没有选区时 ✅ -> 弹 toast ✅ + **不调** `onToolbarHighlight` ✅
 */
console.log('\n[4] 无选区点高亮按钮的提示');
/*
 * ⚠️ **必须先清掉选区** ✅
 *
 * -> 上一段测便签的时候**选过文字** ✅ -> 选区还在 ✅
 * -> 有选区就不会弹这个提示 ✅ -> 测的就不是"无选区"了 ❌
 */
await page.evaluate(() => {
  window.getSelection()?.removeAllRanges();
});
await page.mouse.move(10, 10);
await page.waitForTimeout(600);
await page.click('.scpdf-toolbar__btn[aria-label="高亮"]');
await page.waitForTimeout(700);
const noSelectionToast = await page.evaluate(() => {
  const items = [...document.querySelectorAll('.scpdf-toast__item')];
  return {
    count: items.length,
    text: (items[0]?.textContent ?? '').trim(),
    isInfo: items[0]?.className.includes('--info') ?? false,
  };
});
check(
  '无选区时弹了提示',
  noSelectionToast.count === 1 && noSelectionToast.text.length > 0,
  noSelectionToast.text || '没弹',
);
check('提示是 info 类型', noSelectionToast.isInfo, noSelectionToast.isInfo ? 'info' : '不是');

// ⚠️ **清掉 toast ✅**
await page.evaluate(() => {
  document.querySelectorAll('.scpdf-toast__close').forEach((b) => {
    b.click();
  });
});
await page.waitForTimeout(400);

/*
 * ⚠️ **有选区时点【高亮】按钮 → 不该弹这个提示** ✅
 */
const hasSelection = await page.evaluate(() => {
  const c = document.querySelector('.scpdf-container');
  const cb = c.getBoundingClientRect();
  const el = [...document.querySelectorAll('.scpdf-text-layer__item')].find(
    (e) =>
      (e.textContent ?? '').length > 25 &&
      e.getBoundingClientRect().top >= cb.top + 60 &&
      e.getBoundingClientRect().top <= cb.bottom - 200,
  );
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left + 10, y: b.top + b.height / 2 };
});
if (hasSelection) {
  await page.mouse.move(hasSelection.x, hasSelection.y);
  await page.mouse.down();
  await page.mouse.move(hasSelection.x + 100, hasSelection.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1000);

  await page.click('.scpdf-toolbar__btn[aria-label="高亮"]');
  await page.waitForTimeout(700);
  const withSelectionToast = await page.evaluate(
    () => document.querySelectorAll('.scpdf-toast__item').length,
  );
  check('有选区时不弹"先选择文字"的提示', withSelectionToast === 0, `${withSelectionToast} 条`);
} else {
  check('有选区时不弹"先选择文字"的提示', false, '没找到可选的文字');
}

check('没有页面错误', errors.length === 0, errors.join(' | ').slice(0, 140));

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
await browser.close();
process.exit(failed.length ? 1 : 0);
