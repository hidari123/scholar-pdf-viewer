import { E2E_BASE_URL } from './e2e-base.mjs';
/**
 * E2E：选区浮层（选中文字后的操作条）。
 *
 * 断言：
 * 1. 选中文字后浮层出现
 * 2. 浮层在选区**下方**（下方空间够时）
 * 3. 下方空间不够时**真的翻转到上方**
 * 4. 浮层不超出容器可视区
 * 5. Esc 关闭
 * 6. 点击浮层外关闭
 * 7. 滚动时隐藏
 * 8. 颜色下拉可展开、可选色
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

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

const BASE = E2E_BASE_URL;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1500);

  /** 选中一段文字 */
  const selectText = async () => {
    const t = await page.evaluate(() => {
      const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
      const el = spans.find((x) => {
        const r = x.getBoundingClientRect();
        return r.top > 200 && r.top < 600 && (x.textContent ?? '').trim().length > 30;
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + 5, y: r.top + 2 };
    });
    if (!t) return null;
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    await page.mouse.move(t.x + 250, t.y, { steps: 15 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    return t;
  };

  await selectText();

  // ---- 1. 浮层出现 ----
  const pop = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-selection-popover');
    if (!p) return null;
    const r = p.getBoundingClientRect();
    const sel = window.getSelection();
    const sr = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    const container = document.querySelector('.scpdf-container');
    const cr = container?.getBoundingClientRect();
    return {
      rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
      sel: sr ? { l: sr.left, t: sr.top, r: sr.right, b: sr.bottom } : null,
      container: cr ? { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom } : null,
      buttons: [...p.querySelectorAll('.scpdf-selection-popover__btn')].map((b) =>
        b.getAttribute('aria-label'),
      ),
      arrowPlacement: p
        .querySelector('.scpdf-selection-popover__arrow')
        ?.getAttribute('data-placement'),
      position: getComputedStyle(p).position,
    };
  });

  check('选中文字后浮层出现', pop !== null);
  check('浮层用 position: fixed（视口坐标，不漂移）', pop?.position === 'fixed', pop?.position);

  check(
    '浮层在选区下方',
    pop?.arrowPlacement === 'bottom' && pop.sel !== null && pop.rect.t >= pop.sel.b,
    pop ? `浮层 top=${Math.round(pop.rect.t)} 选区 bottom=${Math.round(pop.sel?.b ?? 0)}` : '',
  );

  check(
    '浮层水平居中对齐选区',
    pop !== null &&
      pop.sel !== null &&
      Math.abs((pop.rect.l + pop.rect.r) / 2 - (pop.sel.l + pop.sel.r) / 2) < 3,
    pop
      ? `浮层中心=${Math.round((pop.rect.l + pop.rect.r) / 2)} 选区中心=${Math.round(((pop.sel?.l ?? 0) + (pop.sel?.r ?? 0)) / 2)}`
      : '',
  );

  check(
    '浮层不超出容器可视区',
    pop !== null &&
      pop.container !== null &&
      pop.rect.l >= pop.container.l &&
      pop.rect.r <= pop.container.r &&
      pop.rect.t >= pop.container.t &&
      pop.rect.b <= pop.container.b,
  );

  check(
    '有内置按钮（高亮/复制/翻译/提问/笔记）',
    pop?.buttons.includes('高亮') && pop.buttons.includes('复制') && pop.buttons.includes('翻译'),
    pop ? `按钮: ${pop.buttons.join(', ')}` : '',
  );

  // ---- 2. 颜色下拉 ----
  await page.locator('button[aria-label="选择高亮颜色"]').click();
  await page.waitForTimeout(400);

  const palette = await page.evaluate(() => {
    const p = document.querySelector('.scpdf-selection-popover__palette');
    if (!p) return null;
    return {
      count: p.querySelectorAll('.scpdf-selection-popover__swatch').length,
      colors: [...p.querySelectorAll('.scpdf-selection-popover__swatch')].map(
        (s) => getComputedStyle(s).backgroundColor,
      ),
    };
  });

  check(
    '颜色下拉可展开且有 6 个预设色',
    palette !== null && palette.count === 6,
    palette ? `${palette.count} 个色块` : '',
  );

  // 选色 -> 高亮
  await page.locator('.scpdf-selection-popover__swatch').nth(3).click();
  await page.waitForTimeout(700);

  const afterPick = await page.evaluate(() => ({
    paletteClosed: !document.querySelector('.scpdf-selection-popover__palette'),
    popoverClosed: !document.querySelector('.scpdf-selection-popover'),
    hint: document.querySelector('span[style*="primary"]')?.textContent ?? '',
  }));

  check('选色后色板关闭', afterPick.paletteClosed);
  check('选色后浮层关闭', afterPick.popoverClosed);
  check('选色触发高亮（宿主收到颜色）', afterPick.hint.includes('pink'), afterPick.hint);

  // ---- 3. Esc 关闭 ----
  await selectText();
  await page.waitForTimeout(300);
  const beforeEsc = await page.locator('.scpdf-selection-popover').count();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const afterEsc = await page.locator('.scpdf-selection-popover').count();

  check('Esc 关闭浮层', beforeEsc > 0 && afterEsc === 0, `${beforeEsc} → ${afterEsc}`);

  // ---- 4. 点击外部关闭 ----
  await selectText();
  await page.waitForTimeout(300);
  const beforeOutside = await page.locator('.scpdf-selection-popover').count();
  await page.mouse.click(200, 60);
  await page.waitForTimeout(300);
  const afterOutside = await page.locator('.scpdf-selection-popover').count();

  check(
    '点击浮层外关闭',
    beforeOutside > 0 && afterOutside === 0,
    `${beforeOutside} → ${afterOutside}`,
  );

  // ---- 5. 滚动时**跟随**（不是隐藏）----
  /*
   * ⚠️ **行为已按用户要求改过**（第九轮决策）：
   * 用户明确选了 **A. 跟随滚动**（像 Word 那样），不是"滚动就隐藏"。
   * → 滚动后浮层应该**还在**，而且**位置要跟着变**。
   */
  await selectText();
  await page.waitForTimeout(300);
  const beforeScrollRect = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-selection-popover');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left) };
  });
  await page.evaluate(() => {
    document.querySelector('.scpdf-container')?.scrollBy(0, 200);
  });
  await page.waitForTimeout(400);
  const afterScroll = await page.locator('.scpdf-selection-popover').count();
  const afterScrollRect = await page.evaluate(() => {
    const el = document.querySelector('.scpdf-selection-popover');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left) };
  });
  check('滚动时浮层跟随（不隐藏）', afterScroll === 1, `${afterScroll} 个`);
  check(
    '滚动时浮层位置跟着移动',
    afterScrollRect !== null &&
      beforeScrollRect !== null &&
      Math.abs(afterScrollRect.top - beforeScrollRect.top) > 20,
    `top ${beforeScrollRect?.top} → ${afterScrollRect?.top}`,
  );

  // ---- 6. 翻转到上方 ----
  await page.evaluate(() => {
    const c = document.querySelector('.scpdf-container');
    if (c) c.scrollTop = 0;
  });
  await page.waitForTimeout(400);

  const nearBottom = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];
    const container = document.querySelector('.scpdf-container');
    const cr = container?.getBoundingClientRect();
    if (!cr) return null;
    /*
     * 找**紧贴容器底部**的文本
     * （浮层高约 38px + gap 8 → 选区底部要在 container.bottom - 50 之后才放不下）
     */
    const el = spans.find((x) => {
      const r = x.getBoundingClientRect();
      return (
        r.bottom > cr.bottom - 50 && r.top < cr.bottom && (x.textContent ?? '').trim().length > 20
      );
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + 5, y: r.top + 2 };
  });

  if (nearBottom) {
    await page.mouse.move(nearBottom.x, nearBottom.y);
    await page.mouse.down();
    await page.mouse.move(nearBottom.x + 200, nearBottom.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);

    const flipped = await page.evaluate(() => {
      const p = document.querySelector('.scpdf-selection-popover');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      const sel = window.getSelection();
      const sr = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      return {
        placement: p
          .querySelector('.scpdf-selection-popover__arrow')
          ?.getAttribute('data-placement'),
        top: r.top,
        bottom: r.bottom,
        selTop: sr?.top,
        selBottom: sr?.bottom,
      };
    });

    check(
      '下方空间不够时翻转到上方',
      flipped?.placement === 'top' &&
        flipped.selTop !== undefined &&
        flipped.bottom <= flipped.selTop,
      flipped
        ? `placement=${flipped.placement} 浮层 bottom=${Math.round(flipped.bottom)} 选区 top=${Math.round(flipped.selTop ?? 0)}`
        : '',
    );
  } else {
    check('下方空间不够时翻转到上方', false, '找不到靠近底部的文本');
  }

  check('全程无 JS 错误', jsErrors.length === 0, jsErrors[0]?.slice(0, 140) ?? '');
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) process.exitCode = 1;
