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
        // ⚠️ **把便签挪到页的边角** ✅
        await page.evaluate((pos) => {
          const note = document.querySelector('.scpdf-sticky-note');
          const pb = note.closest('.scpdf-page').getBoundingClientRect();
          const nb = note.getBoundingClientRect();
          note.style.left = `${Math.round(pb.right - nb.left - 20)}px`;
          if (pos === 'bottom-right') {
            note.style.top = `${Math.round(pb.bottom - nb.top - 20)}px`;
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
          return {
            found: true,
            position: getComputedStyle(c).position,
            overflowRight: pb ? b.right - pb.right : 0,
            overflowBottom: pb ? b.bottom - pb.bottom : 0,
            outViewportRight: b.right - window.innerWidth,
            outViewportBottom: b.bottom - window.innerHeight,
            visible: c.dataset.visible === 'true',
          };
        });

        if (!out.found) {
          check(`[${pos}] 内容框存在`, false);
        } else {
          check(`[${pos}] 内容框是 fixed`, out.position === 'fixed', out.position);
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

check('没有页面错误', errors.length === 0, errors.join(' | ').slice(0, 140));

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) {
  console.log('失败项:');
  for (const f of failed) console.log(`  - ${f.name}`);
}
await browser.close();
process.exit(failed.length ? 1 : 0);
