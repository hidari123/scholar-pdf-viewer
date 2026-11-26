/**
 * E2E：**批注详情贴在便签旁边**（不管在第几页）。
 *
 * ## 用户反馈（第 27 轮的第二次反馈）
 *
 * > "批注详情这里还是有问题 不管在哪个页面哪个地方点击批注按钮
 * >  批注详情都会出现在pdf首页的位置 这个逻辑还是没修复"
 *
 * ## 根因（实测）
 *
 * ```
 * 便签位置:   y = 140
 * 详情面板:   y = -6806     ← ❌ 跑到屏幕外老高了
 * panelStyleTop: "70.21px" ← 样式是对的，但渲染位置错
 * ```
 *
 * -> 面板是 `position: absolute` -> 相对 **.scpdf-container 的内容原点**
 * -> 锚点是 `getBoundingClientRect()` -> **视口坐标**
 * -> 换算要 `视口坐标 - 容器视口原点 + scrollTop`
 * -> ⚠️ **只减了视口偏移，漏了 scrollTop** ❌ -> 差 7000px ❌
 *
 * 用法：`node scripts/e2e-annotation-panel-position.mjs`
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

console.log('E2E：批注详情贴在便签旁边（不管在第几页）');

/**
 * 在当前视口里建一条批注，然后打开详情，看面板和便签的差。
 *
 * @param scrollTop 滚到哪
 * @param label 用例名
 */
async function scenario(scrollTop, label) {
  /*
   * ⚠️ **先关掉上一个详情面板**
   *
   * -> 不关 -> 上一个面板**还在 DOM 里** ❌
   * -> 后面找"视口内的面板"可能找到**旧的** ❌
   */
  await page.evaluate(() => {
    // 点面板的关闭按钮（比 Esc 可靠）
    const btn = document.querySelector('.scpdf-annotation-panel [aria-label="关闭"]');
    btn?.click();
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);

  await page.evaluate((st) => {
    document.querySelector('.scpdf-container').scrollTop = st;
  }, scrollTop);
  await page.waitForTimeout(1500);

  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((s) => {
      const r = s.getBoundingClientRect();
      return (s.textContent ?? '').trim().length > 20 && r.top > 150 && r.top < 700;
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return {
      page: spans[0].closest('.scpdf-page')?.getAttribute('data-page-number'),
      x: Math.round(r.x + 4),
      y: Math.round(r.y + r.height / 2),
    };
  });
  if (!t) {
    check(`${label}：找到文字`, false);
    return;
  }

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
  await page.evaluate((text) => {
    const ed = document.querySelector('.scpdf-annotation-dialog .ProseMirror');
    ed?.focus();
    document.execCommand('insertText', false, text);
  }, `批注-${label}`);
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.scpdf-annotation-dialog__btn')].find((x) =>
      /保存|Save/i.test(x.getAttribute('aria-label') ?? x.textContent ?? ''),
    );
    b?.click();
  });
  await page.waitForTimeout(2500);

  /*
   * ⚠️ **要选"视口内"的便签**
   *
   * -> 之前的页留下的便签**还在 DOM 里**（只是滚出屏幕了）❌
   * -> `querySelector` 取**第一个** -> 拿到的是**旧页的** ❌
   * -> -> 面板位置当然对不上 ❌
   */
  const note = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.scpdf-sticky-note__icon')];
    const visible = all.filter((n) => {
      const r = n.getBoundingClientRect();
      return r.top > -50 && r.top < window.innerHeight;
    });
    const n = visible[0];
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), total: all.length, visible: visible.length };
  });
  check(`${label}：便签出现了`, !!note);
  if (!note) return;

  await page.mouse.move(note.x + 12, note.y + 12);
  await page.waitForTimeout(900);
  /*
   * ⚠️ **要点"视口内"那个便签的"展开"按钮**
   *
   * -> 之前的页留下的便签**还在 DOM 里**（只是滚出屏幕了）❌
   * -> `querySelectorAll` 取**第一个** -> 拿到的是**旧页的** ❌
   *    -> 点它 -> 打开的是**旧批注**的详情 -> 位置当然对不上 ❌
   */
  /*
   * ⚠️ **"展开"按钮要【真实点击】**（不是 `element.click()`）
   *
   * -> 按钮在 **hover 时**才出现 ❌
   * -> `element.click()` 不触发 hover -> 按钮**还不存在** ❌
   * -> 所以：**先 hover 让它出来 -> 再用鼠标点它的位置**
   */
  const expandPos = await page.evaluate((noteId) => {
    const icon = document.querySelector(
      `.scpdf-sticky-note__icon[data-note-id="${CSS.escape(noteId)}"]`,
    );
    const group = icon?.closest('.scpdf-sticky-note');
    const actions = group ? [...group.querySelectorAll('.scpdf-sticky-note__action')] : [];
    const expand = actions.find((x) => (x.getAttribute('aria-label') ?? '').includes('展开'));
    if (!expand) {
      return null;
    }
    const r = expand.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, note.id);

  if (expandPos) {
    await page.mouse.move(expandPos.x, expandPos.y);
    await page.waitForTimeout(400);
    await page.mouse.click(expandPos.x, expandPos.y);
  } else {
    // 兜底：直接点图标（打开详情）
    await page.mouse.click(note.x + 12, note.y + 12);
  }
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('.scpdf-annotation-panel')];
    const p = panels.find((el) => {
      const r = el.getBoundingClientRect();
      return r.top > -50 && r.top < window.innerHeight;
    });
    if (!p) return { noPanel: true, panelCount: panels.length };

    const notes = [...document.querySelectorAll('.scpdf-sticky-note__icon')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.top > -50 && r.top < window.innerHeight;
    });
    const n = notes[0];
    const pr = p.getBoundingClientRect();
    const nr = n?.getBoundingClientRect();
    return {
      panelY: Math.round(pr.y),
      noteY: nr ? Math.round(nr.y) : null,
      dy: nr ? Math.round(pr.y - nr.y) : null,
      inViewport: pr.top > -50 && pr.top < window.innerHeight,
      styleTop: p.style.top,
      containerScrollTop: document.querySelector('.scpdf-container')?.scrollTop ?? -1,
      containerTop: Math.round(
        document.querySelector('.scpdf-container')?.getBoundingClientRect().top ?? -1,
      ),
    };
  });

  check(`${label}：详情面板打开了`, !result.noPanel, JSON.stringify(result));
  check(
    `${label}：面板在视口内**（不是跑到首页去了）**`,
    result.inViewport === true,
    `panelY=${result.panelY}`,
  );
  check(
    `${label}：面板贴着便签**（垂直差 < 80px）**`,
    typeof result.dy === 'number' && Math.abs(result.dy) < 80,
    `dy=${result.dy}`,
  );
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

  // ---- ① 第 1 页 ----
  await scenario(0, '第 1 页');

  // ---- ② 第 4 页（之前错得最离谱的）----
  await scenario(7000, '第 4 页');

  // ---- ③ 第 10 页 ----
  await scenario(17000, '第 10 页');

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
