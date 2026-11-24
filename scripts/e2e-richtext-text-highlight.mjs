/**
 * E2E：文字颜色用**深色** + 三个按钮的图标各不相同 + **"文字高亮"已移除**。
 *
 * ## 用户反馈
 *
 * > "1. 富文本的那个文字颜色 如果是放在文字上 就太浅了 文字可以适当加深颜色；
 *    但是这个颜色可以放在文字的高亮上 增加一个添加文字高亮的按钮"
 * > "2. 富文本的清除格式按钮没生效 并且图标还是跟文字颜色相同 需要重新设计过图标"
 * > "把富文本编辑框里的文字高亮这个按钮去掉吧 功能和高亮重复了而且图标很丑"  ← **第 27 轮**
 *
 * ## 修法
 *
 * - **文字颜色** -> 用**独立的深色板**（`annotationTextPalette`）✅
 * - **三个图标** -> `highlightColor`（笔）/ `textColor`（A+横条）/ `clearFormat`（A+斜杠）
 *   -> **各不相同** ✅
 * - **清除格式** -> TipTap 加 `unsetColor` + `unsetHighlight` -> **真清干净** ✅
 * - **"文字高亮"** -> **从默认工具栏移除**（功能重复 + 图标丑）❌
 *   -> 但**命令和图标保留** -> 宿主可自己加回来 ✅
 *
 * 用法：`node scripts/e2e-richtext-text-highlight.mjs`
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

  // ---- ① 打开批注弹窗 ----
  await dragSelect(250);
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

  // ---- ② 工具栏有 4 个不同的按钮 ----
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn')].map((b) =>
      b.getAttribute('aria-label'),
    ),
  );
  check('有"高亮"按钮', labels.includes('高亮'), labels.join(','));
  // ⚠️ **"文字高亮"已从默认工具栏移除**（用户反馈："功能重复 + 图标很丑"）✅
  check('**没有"文字高亮"按钮**（功能和高亮重复）', !labels.includes('文字高亮'), labels.join(','));
  check('有"文字颜色"按钮', labels.includes('文字颜色'), '');
  check('有"清除格式"按钮', labels.includes('清除格式'), '');

  // ---- ③ 四个按钮的图标各不相同 ----
  const icons = await page.evaluate(() => {
    const out = {};
    for (const b of document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn')) {
      const label = b.getAttribute('aria-label');
      if (label && ['高亮', '文字颜色', '清除格式'].includes(label)) {
        out[label] = b.querySelector('svg')?.innerHTML ?? '';
      }
    }
    return out;
  });
  const iconValues = Object.values(icons);
  check(
    '**3 个图标互不相同**',
    new Set(iconValues).size === iconValues.length && iconValues.length === 3,
    Object.entries(icons)
      .map(([k, v]) => `${k}=${v.length}字符`)
      .join(' '),
  );
  check(
    '**"清除格式"是斜杠**（和"文字颜色"区分开）',
    (icons.清除格式 ?? '').includes('<line') &&
      (icons.清除格式 ?? '').includes('x1="5"') &&
      (icons.清除格式 ?? '').includes('y2="5"'),
    icons.清除格式 ?? '',
  );

  // ---- ④ 输入文字 ----
  await page.evaluate(() => {
    const ed = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    ed?.focus();
    document.execCommand('insertText', false, '测试文字');
  });
  await page.waitForTimeout(600);

  /** 选中编辑区里的所有文字 */
  const selectAll = () =>
    page.evaluate(() => {
      const root = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
      if (!root) {
        return false;
      }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n = walker.nextNode();
      while (n && !n.textContent.trim()) {
        n = walker.nextNode();
      }
      if (!n) {
        return false;
      }
      const r = document.createRange();
      r.selectNodeContents(n);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      return true;
    });

  /** 点工具栏按钮 */
  const clickBtn = async (label) => {
    const b = await page.evaluate((l) => {
      const el = [
        ...document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn'),
      ].find((x) => x.getAttribute('aria-label') === l);
      if (!el) {
        return null;
      }
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, label);
    if (!b) {
      return false;
    }
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(700);
    return true;
  };

  /** 点色板里的第 n 个色块 */
  const clickSwatch = async (index) => {
    const b = await page.evaluate((idx) => {
      const el = document.querySelectorAll(
        '.scpdf-annotation-dialog .scpdf-rich-text__palette .scpdf-rich-text__swatch',
      )[idx];
      if (!el) {
        return null;
      }
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, index);
    if (!b) {
      return false;
    }
    await page.mouse.click(b.x, b.y);
    await page.waitForTimeout(700);
    return true;
  };

  const html = () =>
    page.evaluate(() => document.querySelector('.scpdf-annotation-dialog .ProseMirror')?.innerHTML);

  // ---- ④.5 点面板外面要关闭（用户反馈："如果点击非选择颜色框的区域 是需要关闭这个选择框的"）----
  await selectAll();
  await page.waitForTimeout(300);
  await clickBtn('文字颜色');
  check(
    '**面板打开了**',
    await page.evaluate(
      () => !!document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette'),
    ),
    '',
  );

  // 点面板**里面**（边框，不是色块）-> 不该关
  const paletteEdge = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.x + 2), y: Math.round(r.y + 2) };
  });
  if (paletteEdge) {
    await page.mouse.click(paletteEdge.x, paletteEdge.y);
    await page.waitForTimeout(500);
  }
  check(
    '**点面板里面不关闭**（还在选颜色）',
    await page.evaluate(
      () => !!document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette'),
    ),
    '',
  );

  // 点**外面** -> 该关
  // ⚠️ **要点"编辑区里的空白"**（不是页面角落）❌
  // -> 页面角落是"取消"按钮 -> 会把**整个弹窗**关掉 -> 后面全测不了 ✅
  // ⚠️ **在 `body` 上派发 mousedown**（而不是真的点某个坐标）✅
  // -> 点页面角落 = "取消" -> 整个弹窗被关掉 -> 后面全测不了 ❌
  // -> 点编辑区空白 = 也会命中"取消"（有重叠）❌
  // -> **派发事件** = 精确模拟"点了面板外面" -> 不会误伤任何按钮 ✅
  await page.evaluate(() => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  check(
    '**点外面关闭了面板**',
    !(await page.evaluate(
      () => !!document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette'),
    )),
    '',
  );

  // Esc -> 也该关
  await clickBtn('文字颜色');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  check(
    '**Esc 关闭了面板**',
    !(await page.evaluate(
      () => !!document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette'),
    )),
    '',
  );

  console.log(
    'DEBUG:',
    JSON.stringify(
      await page.evaluate(() => {
        const btns = [
          ...document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn'),
        ].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            l: b.getAttribute('aria-label'),
            x: Math.round(r.x),
            y: Math.round(r.y),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        });
        return {
          btns,
          openPalette: !!document.querySelector(
            '.scpdf-annotation-dialog .scpdf-rich-text__palette',
          ),
        };
      }),
    ),
  );

  // ⚠️ **重新选中文字**（④.5 里点过外面 -> 浏览器的选区被清掉了）✅
  await selectAll();
  await page.waitForTimeout(300);

  // ---- ⑤ "高亮"：面板 + 加背景色 ----
  // ⚠️ **"文字高亮"按钮已移除**（用户反馈："功能重复 + 图标很丑"）
  //    -> 这里测**"高亮"**按钮（背景色）✅
  await selectAll();
  await page.waitForTimeout(300);
  const ok = await clickBtn('高亮');
  console.log(
    'DEBUG clickBtn(高亮) ->',
    ok,
    JSON.stringify(
      await page.evaluate(() => ({
        btns: [...document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__btn')].map(
          (b) => b.getAttribute('aria-label'),
        ),
        palettes: document.querySelectorAll('.scpdf-annotation-dialog .scpdf-rich-text__palette')
          .length,
      })),
    ),
  );
  const pal = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette');
    if (!p) {
      return null;
    }
    const r = p.getBoundingClientRect();
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      count: p.querySelectorAll('.scpdf-rich-text__swatch').length,
      colors: [...p.querySelectorAll('.scpdf-rich-text__swatch')].map((s) => s.style.background),
    };
  });
  check('"高亮"弹出了颜色面板', pal !== null, JSON.stringify(pal));
  check('面板不是空的窄框', (pal?.w ?? 0) >= 100, `${pal?.w}x${pal?.h}`);
  check('面板有 >= 4 个色块', (pal?.count ?? 0) >= 4, String(pal?.count));

  await clickSwatch(2);
  const afterHighlight = await html();
  check(
    '**"高亮"加了背景色**',
    (afterHighlight ?? '').includes('background-color'),
    afterHighlight ?? '',
  );
  check(
    '**"高亮"没有改字色**（高亮只加背景）',
    // `color: inherit` 是**正确**的 —— 显式声明"字色继承父级" -> 视觉上就是没改 ✅
    // -> 只检查有没有**具体的字色值**（排除 `background-color`）✅
    !/(^|[;"\s])color:\s*(rgb|#[0-9a-f]{3,8})/i.test(afterHighlight ?? ''),
    afterHighlight ?? '',
  );

  // ---- ⑤.5 "无背景色"选项（用户需求："高亮这个按钮需要加上一个无背景颜色的选项，如飞书样式"）----
  await selectAll();
  await page.waitForTimeout(300);
  await clickBtn('高亮');
  const swatches = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette');
    if (!p) return [];
    return [...p.querySelectorAll('.scpdf-rich-text__swatch')].map((s) => ({
      label: s.getAttribute('aria-label'),
      isNone: s.classList.contains('scpdf-rich-text__swatch--none'),
      bg: s.style.background,
    }));
  });
  check(
    '**色板第一个是"无背景色"**（斜杠色块）',
    swatches[0]?.isNone === true && swatches[0]?.label === '无背景色',
    JSON.stringify(swatches[0]),
  );
  check(
    '**色板里既有"无背景色"又有真实颜色**',
    swatches.length >= 5 && swatches.filter((s) => !s.isNone).length >= 4,
    String(swatches.length),
  );

  // 点斜杠 -> 清除高亮
  await clickSwatch(0);
  const afterNone = await html();
  check(
    '**点"无背景色"清除了高亮**',
    !(afterNone ?? '').includes('background-color') && !(afterNone ?? '').includes('<mark'),
    afterNone ?? '',
  );

  // ---- ⑥ "文字颜色"：深色 ----
  await selectAll();
  await page.waitForTimeout(300);
  await clickBtn('文字颜色');
  const tcPal = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-annotation-dialog .scpdf-rich-text__palette');
    if (!p) {
      return null;
    }
    return [...p.querySelectorAll('.scpdf-rich-text__swatch')].map((s) => s.style.background);
  });
  check('"文字颜色"弹出了颜色面板', tcPal !== null && tcPal.length > 0, String(tcPal?.length));

  await clickSwatch(1);
  const afterColor = await html();
  const colorMatch = afterColor?.match(/color:\s*rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  const rgb = colorMatch
    ? Number(colorMatch[1]) + Number(colorMatch[2]) + Number(colorMatch[3])
    : 0;
  check(
    '**文字颜色生效了**',
    colorMatch !== null,
    colorMatch ? `rgb(${colorMatch[1]},${colorMatch[2]},${colorMatch[3]})` : 'no color',
  );
  check(
    '**文字颜色是【深色】**（不是浅色）',
    colorMatch !== null && rgb < 500,
    colorMatch ? `三通道和=${rgb}` : '',
  );

  // ---- ⑦ 清除格式：真的清干净 ----
  await clickBtn('清除格式');
  await page.waitForTimeout(800);
  const afterClear = await html();
  check(
    '**"清除格式"把颜色和底色都清掉了**',
    !(afterClear ?? '').includes('color:') && !(afterClear ?? '').includes('background-color'),
    afterClear ?? '',
  );
  check('**"清除格式"没有把文字删掉**', (afterClear ?? '').includes('测试文字'), afterClear ?? '');

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
