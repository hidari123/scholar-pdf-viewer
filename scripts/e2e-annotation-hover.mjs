/**
 * E2E：**批注 hover 的操作按钮 + 富文本预览**（用户需求：
 * "我现在移动鼠标到批注的文字上面 框就消失了 需要可以移动到上面
 *  hover之后会出现编辑按钮，点击可以进行编辑 也可以点击展开，查看批注详情
 *  展示的时候要展示富文本形式的 不要带上标签 翻译成html展示出来"）。
 *
 * ## 验证什么
 *
 * 1. hover 便签 → 出现**内容预览**
 * 2. 预览里的内容是**富文本**（`<p>` 渲染成段落，不是显示标签）
 * 3. hover 时出现**编辑 / 展开**按钮
 * 4. **鼠标移到内容框上 → 框不消失**（用户反馈的核心问题）
 * 5. 点"编辑" → 打开**锚点弹窗**（有「保存」按钮）
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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  // 造一条带富文本的批注
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => (s.textContent ?? '').trim().length > 20,
    );
    const sp = spans.find((s) => {
      const r = s.getBoundingClientRect();
      return r.width > r.height * 2 && r.top > 300;
    });
    if (!sp) return;
    const range = document.createRange();
    const node = sp.firstChild ?? sp;
    range.setStart(node, 0);
    range.setEnd(node, 8);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  await page.locator('button[aria-label="加批注"]').first().click();
  await page.waitForTimeout(2500);
  await page.locator('.scpdf-annotation-dialog .ProseMirror').click();
  await page.keyboard.type('测试批注内容', { delay: 30 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.scpdf-annotation-dialog button')].find((b) =>
      (b.textContent ?? '').includes('保存'),
    );
    btn?.click();
  });
  await page.waitForTimeout(2000);

  // ① hover 便签图标
  const iconPos = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-sticky-note__icon');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  check('**便签图标存在**', Boolean(iconPos), JSON.stringify(iconPos));

  if (iconPos) {
    await page.mouse.move(iconPos.x, iconPos.y);
    await page.waitForTimeout(1000);

    const hovered = await page.evaluate(() => {
      const c = document.querySelector('.scpdf-sticky-note__content');
      const text = c?.querySelector('.scpdf-sticky-note__text');
      return {
        visible: c?.getAttribute('data-visible'),
        // 预览里有没有真正的段落元素（而不是一堆标签文本）
        hasParagraph: !!text?.querySelector('p, strong, em, ul, ol'),
        // 预览的 textContent 里**不该**出现标签名
        textContent: text?.textContent ?? '',
        html: text?.innerHTML ?? '',
        actions: c?.querySelectorAll('.scpdf-sticky-note__action').length,
      };
    });

    check('**hover → 出现内容预览**', hovered.visible === 'true');
    check(
      '**预览按富文本渲染（有真正的段落元素）**',
      hovered.hasParagraph,
      hovered.html.slice(0, 60),
    );
    check(
      '**预览里看不到标签（textContent 没有 `<p>` 这种）**',
      !hovered.textContent.includes('<p>'),
      `textContent="${hovered.textContent.slice(0, 40)}"`,
    );
    check('**hover → 出现编辑/展开按钮**', hovered.actions === 2, `${hovered.actions} 个`);

    // ② 鼠标移到内容框上 → 框不消失
    const contentPos = await page.evaluate(() => {
      const c = document.querySelector('.scpdf-sticky-note__content');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: Math.round(r.left + 20), y: Math.round(r.top + 12) };
    });
    if (contentPos) {
      await page.mouse.move(contentPos.x, contentPos.y);
      await page.waitForTimeout(800);
      const afterMove = await page.evaluate(() => {
        const c = document.querySelector('.scpdf-sticky-note__content');
        const r = c?.getBoundingClientRect();
        return {
          visible: c?.getAttribute('data-visible'),
          width: Math.round(r?.width ?? 0),
          height: Math.round(r?.height ?? 0),
        };
      });
      check(
        '**鼠标移到内容框上 → 框不消失（用户反馈的核心问题）**',
        afterMove.visible === 'true' && afterMove.width > 0,
        `visible=${afterMove.visible} ${afterMove.width}x${afterMove.height}`,
      );
    }

    /*
     * ③ 点"编辑" → **打开锚点弹窗**（不是右侧面板）
     *
     * ⚠️ **行为改过了**（用户需求：
     * "富文本编辑完之后没有保存按钮啊 保存都保存不了
     *  而且 富文本点了编辑 怎么富文本编辑框还在文档最上面啊
     *  要出现在视野里啊 就点的旁边"）
     * -> 之前打开的是**右侧便利贴面板**（离批注很远、没有保存按钮）❌
     * -> 现在打开**锚点弹窗**（贴在批注旁边、有保存按钮）
     */
    const editBtn = page.locator('.scpdf-sticky-note__action[aria-label="编辑批注"]');
    if ((await editBtn.count()) > 0) {
      await editBtn.click({ force: true });
      await page.waitForTimeout(1200);
      const editState = await page.evaluate(() => {
        const d = document.querySelector('.scpdf-annotation-dialog');
        return {
          dialogOpen: !!d,
          hasSave: d
            ? [...d.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === '保存')
            : false,
        };
      });
      check('**点"编辑" → 打开锚点弹窗**', editState.dialogOpen);
      check('**弹窗里有「保存」按钮**', editState.hasSave);
    } else {
      check('**点"编辑" → 打开锚点弹窗**', false, '找不到编辑按钮');
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
