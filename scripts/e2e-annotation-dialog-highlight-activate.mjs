/**
 * E2E：批注弹窗里的点击**不能**把下面的高亮变成"选中态"。
 *
 * ## 用户反馈
 *
 * > "如果已经高亮了一个区域 然后再准备对另外一个区域进行批注
 *    此时打开的批注框 如果刚好在那个高亮的上面
 *    点击批注框里面的东西的时候 下面的高亮会选中"
 *
 * ## 根因（实测复现）
 *
 * -> 批注弹窗在 **React 树里是 `.scpdf-container` 的后代** ✅
 *    （DOM 上靠 `position: fixed` 浮着，但 React 的合成事件照样冒泡）✅
 * -> 容器上挂了**高亮的点击委托**（`handleHighlightContainerClick`）✅
 * -> 它按 **鼠标坐标** 命中高亮（`findHighlightAtPoint`）✅
 * -> 用户在弹窗里点"加粗"按钮 -> 坐标正好落在**下面的高亮**上 ❌
 *    -> `handleHighlightClick` -> `setActiveHighlightId(highlight.id)` ❌
 *    -> 高亮加上 `.scpdf-annotation--active` -> **蓝色 2px 边框** ❌
 *    -> 而且 1.5s 自动消失的定时器**只在非批注分支**里 -> **一直蓝着** ❌
 *
 * ## 修法（三层防御）
 *
 * 1. 容器上加 `onClickCapture`：**捕获阶段**就拦掉来自浮层内部的点击 ✅
 * 2. 浮层根节点打 `data-scpdf-floating` 标记 ✅
 * 3. 正在批注时**根本不设置**激活态 ✅
 * 4. 安全网：`activeHighlightId` 非空时**保证 1.5s 后清掉** ✅
 *
 * 用法：`node scripts/e2e-annotation-dialog-highlight-activate.mjs`
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

  // ---- ① 先高亮一块 ----
  await dragSelect(250);
  await page.locator('[aria-label="添加高亮"]').click();
  await page.waitForTimeout(2000);
  const highlightCount = await page.evaluate(
    () => document.querySelectorAll('.scpdf-annotation').length,
  );
  check('先生成一条高亮', highlightCount > 0, `${highlightCount} 条`);

  // ---- ② 在别处选一段 -> 打开批注弹窗 ----
  await dragSelect(300);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.scpdf-selection-popover__btn')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('批注'),
    );
    btn?.click();
  });
  await page.waitForTimeout(2500);
  const dialogOpen = await page.evaluate(() =>
    document.querySelector('.scpdf-root')?.getAttribute('data-dialog-open'),
  );
  check('批注弹窗打开了', dialogOpen === 'true', String(dialogOpen));

  // ---- ③ 把弹窗挪到高亮正上方（复现用户的布局）----
  await page.evaluate(() => {
    const d = document.querySelector('.scpdf-annotation-dialog');
    if (d) {
      d.style.top = '300px';
      d.style.left = '440px';
    }
  });
  await page.waitForTimeout(400);

  // 找一个**落在高亮范围内**的弹窗按钮
  const target = await page.evaluate(() => {
    const a = document.querySelector('.scpdf-annotation')?.getBoundingClientRect();
    if (!a) {
      return null;
    }
    for (const b of document.querySelectorAll('.scpdf-annotation-dialog button')) {
      const r = b.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      if (cx >= a.left && cx <= a.right && cy >= a.top && cy <= a.bottom) {
        return { x: Math.round(cx), y: Math.round(cy), label: b.getAttribute('aria-label') ?? '' };
      }
    }
    return null;
  });
  check('找到压在高亮上的弹窗按钮', target !== null, JSON.stringify(target));

  // ---- ④ 点它 -> 高亮绝不能变成"选中态" ----
  if (target) {
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(400);
  }

  const after = await page.evaluate(() => {
    const a = document.querySelector('.scpdf-annotation');
    if (!a) {
      return null;
    }
    const cs = getComputedStyle(a);
    return {
      hasActive: a.classList.contains('scpdf-annotation--active'),
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      outlineColor: cs.outlineColor,
    };
  });

  check(
    '**点弹窗里的按钮，下面的高亮没有变成选中态**',
    after !== null && !after.hasActive,
    after ? `hasActive=${after.hasActive}` : 'no highlight',
  );
  check(
    '**高亮没有蓝色边框**（激活色是 rgb(47,84,235)）',
    after !== null &&
      (after.outlineStyle === 'none' ||
        after.outlineWidth === '0px' ||
        after.outlineColor !== 'rgb(47, 84, 235)'),
    after ? `${after.outlineStyle} ${after.outlineWidth} ${after.outlineColor}` : '',
  );

  // ---- ⑤ 等 3 秒也不能变成激活态（安全网）----
  await page.waitForTimeout(3000);
  const later = await page.evaluate(() => {
    const a = document.querySelector('.scpdf-annotation');
    return a ? a.classList.contains('scpdf-annotation--active') : false;
  });
  check('**3 秒后高亮也没有残留激活态**', later === false, `hasActive=${later}`);

  // ---- ⑥ 批注弹窗没被点掉 ----
  const stillOpen = await page.evaluate(() =>
    document.querySelector('.scpdf-root')?.getAttribute('data-dialog-open'),
  );
  check('批注弹窗没有被点掉', stillOpen === 'true', String(stillOpen));

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
