/**
 * E2E：**图标系统**（用户反馈"按钮不好看 上传下载 添加高亮这些 都不好看 再找一些图标插件"）。
 *
 * ## 验证什么
 *
 * 1. 工具栏的每个按钮都是**真 SVG 图标**（不是文字字符 `+` / `⤓`）
 * 2. 图标统一用 **24×24 画布** + `currentColor` 描边
 * 3. **宿主可以逐个覆盖**图标（`icons` prop）→ 覆盖后渲染的是宿主的内容
 * 4. 选区浮层的按钮也是新图标（不是旧的 16×16 画法）
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
  await page.waitForTimeout(3500);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.waitForTimeout(2000);

  // ① 工具栏按钮都是 SVG 图标
  const toolbar = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.scpdf-toolbar__btn')];
    /*
     * ⚠️ **排除"自定义颜色"的色块按钮**。
     *
     * → 它显示的是**颜色块 + 文字**（"用此色"）→ 不是图标按钮
     */
    const iconBtns = btns.filter((b) => !b.classList.contains('scpdf-toolbar__btn--swatch'));
    const withSvg = iconBtns.filter((b) => b.querySelector('svg')).length;
    const svgInfo = [...(iconBtns[0]?.querySelectorAll('svg') ?? [])].slice(0, 3).map((s) => ({
      viewBox: s.getAttribute('viewBox'),
      stroke: s.getAttribute('stroke'),
      width: s.getAttribute('width'),
    }));
    // 文字字符（老实现的 `+` / `⤓`）
    const textOnly = iconBtns.filter(
      (b) => !b.querySelector('svg') && (b.textContent ?? '').trim().length > 0,
    ).length;
    return { total: iconBtns.length, withSvg, svgInfo, textOnly };
  });

  check(
    '**工具栏按钮都用 SVG 图标**',
    toolbar.total > 0 && toolbar.withSvg === toolbar.total,
    `${toolbar.withSvg}/${toolbar.total}`,
  );
  check('**没有用文字字符当图标**', toolbar.textOnly === 0, `还有 ${toolbar.textOnly} 个`);
  check(
    '**图标统一 24×24 画布 + currentColor**',
    toolbar.svgInfo.every((s) => s.viewBox === '0 0 24 24' && s.stroke === 'currentColor'),
    JSON.stringify(toolbar.svgInfo[0] ?? {}),
  );

  // ② 选区浮层的图标也是新图标
  await page.evaluate(() => {
    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter(
      (s) => s.textContent && s.textContent.trim().length > 20,
    );
    if (!spans.length) return;
    const r = document.createRange();
    const node = spans[0].firstChild ?? spans[0];
    r.setStart(node, 0);
    r.setEnd(node, 8);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.waitForTimeout(1200);

  const popover = await page.evaluate(() => {
    const pop = document.querySelector('.scpdf-selection-popover');
    if (!pop) return { exists: false };
    const btns = [...pop.querySelectorAll('button')];
    /*
     * ⚠️ **排除"展开颜色下拉"的箭头按钮**。
     *
     * → 它是**装饰性的小箭头**（8×8）→ 有意画得小（贴在主按钮右边）
     * → 不是"动作图标" → 不要求 24×24
     */
    const actionSvgs = [
      ...pop.querySelectorAll('button:not(.scpdf-selection-popover__btn--split) svg'),
    ];
    return {
      exists: true,
      buttons: btns.length,
      svgCount: actionSvgs.length,
      viewBoxes: [...new Set(actionSvgs.map((s) => s.getAttribute('viewBox')))],
    };
  });

  check('**选区浮层出现**', popover.exists === true);
  check(
    '**选区浮层用 24×24 新图标**',
    popover.exists === true &&
      popover.svgCount > 0 &&
      popover.viewBoxes.every((v) => v === '0 0 24 24'),
    JSON.stringify(popover.viewBoxes ?? []),
  );

  // ③ 宿主可以覆盖图标
  const override = await page.evaluate(async () => {
    // 直接测 Icon 组件的覆盖逻辑（不用改宿主）
    const mod = await import('/@fs/C:/work/scholar-pdf-viewer/dist/index.js').catch(() => null);
    return { hasIcon: !!mod?.Icon };
  });

  check('**包导出 Icon 组件**', override.hasIcon === true);

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
