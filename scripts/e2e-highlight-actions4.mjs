/**
 * E2E：**高亮浮层的 4 个按钮** + **WPS 式小便签批注**。
 *
 * 用户需求：
 * > "pdf高亮区域选中后目前三个选项里面 第一个是高亮 但是没有什么效果
 * >  可以改成四个按钮 第一个是添加批注 具体添加方式和wps的批注一样
 * >  也是加一个小便签纸一样的在上面 hover会展示出来
 * >  第二个是选择高亮颜色 第三个是复制 第四个是删除"
 *
 * ## 验证什么
 *
 * 1. 点高亮块 → 浮层有 **4 个按钮**，顺序是
 *    **添加批注 / 选择高亮颜色 / 复制 / 删除**
 * 2. "选择高亮颜色"能**展开颜色下拉**（之前"没有什么效果"）
 * 3. 点"添加批注" → 抛 `onHighlightComment`
 * 4. 宿主传了批注 → 渲染出**小便签图标**；**hover** → 显示**便签内容**
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
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(1200);

  // ---- 加一条高亮 ----
  const t = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
      const r = x.getBoundingClientRect();
      const fs = Number.parseFloat(getComputedStyle(x).fontSize);
      return fs >= 12 && r.top > 250 && r.top < 500 && r.width > 150;
    });
    if (!spans.length) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.left + 30, y: r.top + 8 };
  });

  if (!t) {
    check('找到可拖选的正文', false);
  } else {
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 200, t.y + 60, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(700);

    const addBtn = page.getByRole('button', { name: '添加高亮', exact: true });
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await page.waitForTimeout(900);
    }
    check(
      '先加一条高亮',
      (await page.evaluate(() => document.querySelectorAll('.scpdf-annotation').length)) > 0,
    );
  }

  // ---- 点高亮块 → 浮层 ----
  await page.evaluate(() => {
    const el = document.querySelector('.scpdf-annotation');
    if (el) {
      const r = el.getBoundingClientRect();
      const ev = new MouseEvent('click', {
        bubbles: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      });
      el.dispatchEvent(ev);
    }
  });
  await page.waitForTimeout(800);

  const popover = page.locator('.scpdf-selection-popover');
  const hasPopover = (await popover.count()) > 0;
  check('**点高亮块 → 浮层出现**', hasPopover);

  if (hasPopover) {
    const labels = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.scpdf-selection-popover__btn')];
      return items.map((b) => b.getAttribute('aria-label'));
    });
    console.log(`  浮层按钮: ${JSON.stringify(labels)}`);

    check('**有"添加批注"按钮**', labels.includes('添加批注'), labels.join(' / '));
    check('**有"选择高亮颜色"按钮**', labels.includes('选择高亮颜色'), labels.join(' / '));
    check('**有"复制"按钮**', labels.includes('复制'), labels.join(' / '));
    check('**有"删除"按钮**', labels.includes('删除'), labels.join(' / '));

    // 顺序：添加批注 → 选择高亮颜色 → 复制 → 删除
    const wanted = ['添加批注', '选择高亮颜色', '复制', '删除'];
    const filtered = labels.filter((l) => wanted.includes(l ?? ''));
    check(
      '**顺序是：添加批注 / 选择高亮颜色 / 复制 / 删除**',
      JSON.stringify(filtered) === JSON.stringify(wanted),
      filtered.join(' → '),
    );

    // ---- 颜色下拉 ----
    const paletteBefore = await page.evaluate(
      () => document.querySelectorAll('.scpdf-selection-popover__palette').length,
    );
    const splitBtn = page.locator('.scpdf-selection-popover__btn--split');
    if ((await splitBtn.count()) === 0) {
      check('**"选择高亮颜色"有下拉箭头**（之前"没有什么效果"）', false);
    } else {
      await splitBtn.first().click();
      await page.waitForTimeout(500);
      const paletteAfter = await page.evaluate(
        () => document.querySelectorAll('.scpdf-selection-popover__palette').length,
      );
      check(
        '**"选择高亮颜色"能展开颜色下拉**（之前"没有什么效果"）',
        paletteAfter > paletteBefore,
        `${paletteBefore} → ${paletteAfter}`,
      );
    }
  }

  // ---- 点"添加批注" → 宿主弹框 → 小便签出现 ----
  page.once('dialog', async (d) => {
    await d.accept('这是测试批注内容');
  });
  const commentBtn = page.getByRole('button', { name: '添加批注', exact: true });
  if ((await commentBtn.count()) === 0) {
    check('找到"添加批注"按钮', false);
  } else {
    await commentBtn.first().click();
    await page.waitForTimeout(900);

    /*
     * ⚠️ 现在点"添加批注" → 弹出**富文本弹窗**（不是直接建便签）。
     * → 用户需求："写批注的时候不要用系统默认的alert，设计一个富文本弹窗来写批注"
     */
    const dialogOpen = await page.evaluate(
      () => !!document.querySelector('.scpdf-annotation-dialog'),
    );
    check('**点了"添加批注" → 弹出富文本弹窗**', dialogOpen);

    // 在弹窗里写内容 → 保存
    if (dialogOpen) {
      /*
       * ⚠️ **必须真的"输入"**（不能用 textContent 直接赋值）。
       * → `textContent = ...` **不触发 input 事件** → React 的 onChange 不触发
       * → 内容没进 state → 保存的是空内容 ❌
       */
      const editor = page.locator('.scpdf-annotation-dialog .scpdf-rich-text__editor');
      if ((await editor.count()) > 0) {
        await editor.click();
        await page.keyboard.type('这是测试批注内容');
      }
      await page.waitForTimeout(400);
      await page.evaluate(() => {
        const save = [...document.querySelectorAll('.scpdf-annotation-dialog button')].find((b) =>
          (b.textContent ?? '').includes('保存'),
        );
        save?.click();
      });
      await page.waitForTimeout(1200);
    }

    const stickyCount = await page.evaluate(
      () => document.querySelectorAll('.scpdf-sticky-note').length,
    );
    check('**保存后 → 出现小便签**', stickyCount > 0, `${stickyCount} 个`);

    // ---- hover 小便签 → 显示内容 ----
    if (stickyCount > 0) {
      const before = await page.evaluate(() => {
        const el = document.querySelector('.scpdf-sticky-note__content');
        return el ? el.getAttribute('data-visible') : null;
      });
      await page.locator('.scpdf-sticky-note__icon').first().hover();
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => {
        const el = document.querySelector('.scpdf-sticky-note__content');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          visible: el.getAttribute('data-visible'),
          opacity: cs.opacity,
          text: el.textContent,
        };
      });
      console.log(`  便签内容: ${JSON.stringify(after)}`);
      check(
        '**hover 小便签 → 显示批注内容**（WPS 的行为）',
        before !== 'true' && after?.visible === 'true' && after?.opacity === '1',
        `before=${before} after=${after?.visible}`,
      );
      check('**批注内容正确**', after?.text?.includes('这是测试批注内容') ?? false, after?.text);
    }
  }

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error).slice(0, 200));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
