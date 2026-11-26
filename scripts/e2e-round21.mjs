/**
 * E2E：**第 21 轮**（用户的 4 条反馈）。
 *
 * ## 验证什么
 *
 * 1. **链接弹窗能弹出**（内置编辑器也要有！之前只有 TipTap 有）
 * 2. **删除线的 icon 完整**（上半 + 下半 + 中间的横线）
 * 3. **fitWidth 两边留空隙 + 下面没有滚动条**
 * 4. **fit 之后点 +/- 就近取整到 10%**（237% -> 240% / 230%）
 * 5. **点 PDF 里的链接能跳转**（之前被高亮的 handler 挡住了）
 * 6. **鼠标在链接上 -> 光标是小手**
 * 7. **点目录能跳转**
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

  // ——— ③④ 缩放 ———
  // 点"适应宽度"
  await page.locator('.scpdf-toolbar button[aria-label*="适应宽度"]').first().click();
  await page.waitForTimeout(1200);
  const zoom = await page.evaluate(() => {
    const container = document.querySelector('.scpdf-container');
    const page1 = document.querySelector('.scpdf-page');
    const c = container.getBoundingClientRect();
    const p = page1.getBoundingClientRect();
    return {
      scaleText: document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
      gapLeft: Math.round(p.left - c.left),
      gapRight: Math.round(c.right - p.right),
      pageHeight: Math.round(p.height),
      containerHeight: Math.round(c.height),
      hasVerticalScroll: container.scrollHeight > container.clientHeight + 2,
      hasHorizontalScroll: container.scrollWidth > container.clientWidth + 2,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
  });
  console.log('  fit 后:', JSON.stringify(zoom));

  check(
    '**fitWidth 两边有留白**（用户反馈："两边也要留一点空隙的"）',
    zoom.gapLeft >= 16 && zoom.gapRight >= 16,
    `左 ${zoom.gapLeft}px / 右 ${zoom.gapRight}px`,
  );
  /*
   * ⚠️ **"下面有滚动条"指的是"横向滚动条"**（在容器的**下面**那条）。
   *
   * -> 竖版 PDF 堆在一起 -> **纵向**滚动条是必然的（翻页要用）
   * -> 用户说的是**下面那条横向的** -> 页宽 > 容器宽才会出现 ❌
   *   （实测（修之前）：容器 1384px、页宽 1408px -> **横向溢出 24px** ❌）
   * -> 修之后：页宽 = 容器 - 48 -> **横向不溢出**
   */
  check(
    '**fitWidth 之后没有横向滚动条**（用户反馈："下面还会出现滚动条"）',
    zoom.hasHorizontalScroll === false,
    `scrollWidth=${zoom.scrollWidth} clientWidth=${zoom.clientWidth}`,
  );

  // 缩放显示不是整数（比如 237%）时，+/- 要就近取整到 10%
  const scaleNum = Number.parseInt(zoom.scaleText.replace('%', ''), 10);
  void scaleNum;
  await page.locator('.scpdf-toolbar button[aria-label*="放大"]').first().click();
  await page.waitForTimeout(700);
  const afterIn = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
  );
  await page.locator('.scpdf-toolbar button[aria-label*="缩小"]').first().click();
  await page.waitForTimeout(700);
  const afterOut = await page.evaluate(
    () => document.querySelector('.scpdf-toolbar__scale')?.textContent ?? '',
  );
  console.log(`  缩放: ${zoom.scaleText} -> 放大 ${afterIn} -> 缩小 ${afterOut}`);

  const inNum = Number.parseInt(afterIn.replace('%', ''), 10);
  const outNum = Number.parseInt(afterOut.replace('%', ''), 10);
  check(
    '**放大后就近取整到 10%**（用户反馈："237% 加号到 240"）',
    inNum % 10 === 0,
    `${zoom.scaleText} -> ${afterIn}`,
  );
  check(
    '**缩小后就近取整到 10%**（用户反馈："减号到 230"）',
    outNum % 10 === 0,
    `${afterIn} -> ${afterOut}`,
  );
  check(
    '**缩放不超过 250%**（用户反馈："最大不能超过250%"）',
    inNum <= 250 && outNum <= 250,
    `放大 ${inNum}% / 缩小 ${outNum}%`,
  );

  // ——— ⑥ 链接的光标 + ⑤ 链接能点 ———
  const link = await page.evaluate(() => {
    for (const l of document.querySelectorAll('.scpdf-link')) {
      const r = l.getBoundingClientRect();
      if (
        r.width > 4 &&
        r.height > 4 &&
        r.top > 150 &&
        r.bottom < 880 &&
        r.left > 100 &&
        r.right < 1300
      ) {
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
          url: l.getAttribute('data-link-url'),
        };
      }
    }
    return null;
  });
  check('**页面上有可见的链接**', link !== null, JSON.stringify(link));

  if (link) {
    await page.mouse.move(link.x, link.y);
    await page.waitForTimeout(500);
    const cursor = await page.evaluate(
      () => getComputedStyle(document.querySelector('.scpdf-container')).cursor,
    );
    check(
      '**鼠标在链接上 -> 光标是小手**（用户反馈："光标还是文字光标 没有变成小手"）',
      cursor === 'pointer',
      cursor,
    );

    await page.mouse.click(link.x, link.y);
    await page.waitForTimeout(1200);
    const hint = await page.evaluate(() => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n = walk.nextNode();
      while (n) {
        const t = (n.textContent ?? '').trim();
        if (t.includes('外链')) return t;
        n = walk.nextNode();
      }
      return '';
    });
    check(
      '**点 PDF 里的链接能跳转**（用户反馈："还是没办法进行跳转"）',
      hint.includes('github.com'),
      hint,
    );
  }

  // ——— ⑦ 目录能跳转 ———
  await page.locator('.scpdf-toolbar button[aria-label*="目录"]').first().click();
  await page.waitForTimeout(1500);
  const outlineItem = page.locator('.scpdf-outline__item').first();
  if ((await outlineItem.count()) > 0) {
    const outlineCursor = await outlineItem.evaluate((el) => getComputedStyle(el).cursor);
    check('**目录项的光标是小手**', outlineCursor === 'pointer', outlineCursor);

    const before = await page.evaluate(
      () => document.querySelector('.scpdf-container')?.scrollTop ?? 0,
    );
    await outlineItem.click();
    await page.waitForTimeout(2000);
    const after = await page.evaluate(
      () => document.querySelector('.scpdf-container')?.scrollTop ?? 0,
    );
    check('**点目录能跳转**', after !== before, `scrollTop ${before} -> ${after}`);
  } else {
    check('**点目录能跳转**', false, '没找到目录项');
  }

  // ——— ① 链接弹窗 + ② 删除线 icon ———
  await page
    .locator('.scpdf-toolbar button[aria-label*="关闭"]')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(800);
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
  await page.waitForTimeout(1500);
  await page.locator('button[aria-label="加批注"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.locator('.scpdf-annotation-dialog .ProseMirror').click();
  await page.keyboard.type('hello world', { delay: 40 });
  await page.waitForTimeout(600);
  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(400);

  // ② 删除线的 icon
  const strike = await page.evaluate(() => {
    const btn = document.querySelector('.scpdf-annotation-dialog button[aria-label="删除线"]');
    const svg = btn?.querySelector('svg');
    if (!svg) return null;
    return {
      pathCount: svg.querySelectorAll('path').length,
      lineCount: svg.querySelectorAll('line').length,
      paths: [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')),
      lines: [...svg.querySelectorAll('line')].map((l) => l.getAttribute('y1')),
      // 上下两段是不是都在
      hasUpper: [...svg.querySelectorAll('path')].some((p) =>
        (p.getAttribute('d') ?? '').includes('4.5'),
      ),
      hasLower: [...svg.querySelectorAll('path')].some((p) =>
        (p.getAttribute('d') ?? '').includes('19.5'),
      ),
    };
  });
  check(
    '**删除线的 icon 有上下两段**（用户反馈："下半部分没有展示出来"）',
    strike?.pathCount === 2 && strike?.hasUpper === true && strike?.hasLower === true,
    `path ${strike?.pathCount} 个 / line ${strike?.lineCount} 个`,
  );
  check('**删除线的 icon 中间有横线**', strike?.lineCount === 1, `y1=${strike?.lines?.join(',')}`);

  // ① 链接弹窗
  await page.locator('.scpdf-annotation-dialog button[aria-label="链接"]').first().click();
  await page.waitForTimeout(1000);
  const popover = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-link-popover');
    if (!p) return null;
    return {
      inputs: p.querySelectorAll('input').length,
      values: [...p.querySelectorAll('input')].map((i) => i.value),
    };
  });
  check(
    '**点「链接」按钮弹窗能出来**（用户反馈："弹框不出现了"）',
    popover !== null && popover.inputs === 2,
    JSON.stringify(popover),
  );
  check(
    '**第 2 行带上了选中的文字**',
    popover?.values?.[1] === 'hello world',
    `"${popover?.values?.[1]}"`,
  );

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
