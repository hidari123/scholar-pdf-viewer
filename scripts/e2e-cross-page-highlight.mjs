/**
 * E2E：**跨页选择高亮**（两页都要有，且位置正确）。
 *
 * ## 用户反馈
 *
 * > "跨页选择高亮的时候 实测只能高亮第一页的内容
 * >  第二页的内容也高亮到了第一页 修复这个bug"
 *
 * ## 根因（实测）
 *
 * -> 拖到页面下面时浏览器**自动滚动**
 * -> 滚动后浏览器的 Range 被**向前扩展到页首** ❌
 *    -> 选区长度 1726 字符（本来只有 ~84）❌
 *    -> 页 1 的**页眉**也被选中了 ❌
 * -> -> 高亮全落在**第 1 页** ❌
 *
 * ## 修法
 *
 * -> 过滤在**内容坐标**里做（起点用"按下时"的滚动量）
 * -> 提取也用**内容坐标**（不二次换算）
 * -> 只保留下界（起点）—— 上界会被自动滚动搞坏 ❌
 *
 * 用法：`node scripts/e2e-cross-page-highlight.mjs`
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
const page = await browser.newPage({ viewport: { width: 1442, height: 732 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

console.log('E2E：跨页选择高亮');

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

  // ---- 滚到第 1 页底部（让第 1 页的最后一行在视口里）----
  await page.evaluate(() => {
    document.querySelector('.scpdf-container').scrollTop = 1300;
  });
  await page.waitForTimeout(1500);

  const start = await page.evaluate(() => {
    const p1 = document.querySelector('.scpdf-page');
    const spans = [...p1.querySelectorAll('.scpdf-text-layer__item')];
    const last = spans[spans.length - 1];
    const r = last.getBoundingClientRect();
    const pr = p1.getBoundingClientRect();
    return {
      x: Math.round(r.x + 4),
      y: Math.round(r.y + r.height / 2),
      page1Bottom: Math.round(pr.bottom),
    };
  });
  check('**找到第 1 页的最后一行**', !!start);

  // ---- 往下拖到第 2 页（一点点，别触发太多自动滚动）----
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y, { steps: 5 });
  await page.mouse.move(start.x + 60, start.page1Bottom + 30, { steps: 8 });
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(1500);

  // ---- 加高亮 ----
  await page.locator('[aria-label="添加高亮"]').click();
  await page.waitForTimeout(2500);

  const dist = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.scpdf-page')];
    return pages
      .map((p, i) => {
        const anns = [...p.querySelectorAll('.scpdf-annotation')];
        if (!anns.length) return null;
        const rects = anns.map((a) => a.getBoundingClientRect());
        return {
          page: i + 1,
          count: anns.length,
          minY: Math.round(Math.min(...rects.map((r) => r.y))),
          maxY: Math.round(Math.max(...rects.map((r) => r.bottom))),
        };
      })
      .filter(Boolean);
  });
  console.log('   分布:', JSON.stringify(dist));

  const page1 = dist.find((d) => d.page === 1);
  const page2 = dist.find((d) => d.page === 2);

  check('**第 1 页有高亮**', !!page1, page1 ? `${page1.count} 个` : '没有');
  check('**第 2 页也有高亮**', !!page2, page2 ? `${page2.count} 个` : '没有');

  /*
   * ⚠️ **第 1 页的高亮必须在【最后一行附近】**
   * -> 不能跑到页首（那是页眉被选中了）❌
   */
  if (page1) {
    const p1Rect = await page.evaluate(() => {
      const p1 = document.querySelector('.scpdf-page');
      const r = p1.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    check(
      '**第 1 页的高亮在页面【下半部分】**（不是页眉）',
      page1.maxY > p1Rect.top + (p1Rect.bottom - p1Rect.top) * 0.6,
      `maxY=${page1.maxY} 页=${p1Rect.top}~${p1Rect.bottom}`,
    );
  }

  if (page2) {
    const p2Rect = await page.evaluate(() => {
      const p2 = document.querySelectorAll('.scpdf-page')[1];
      const r = p2.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    check(
      '**第 2 页的高亮在页面【上半部分】**（是接着第 1 页选的）',
      page2.minY < p2Rect.top + (p2Rect.bottom - p2Rect.top) * 0.5,
      `minY=${page2.minY} 页=${p2Rect.top}~${p2Rect.bottom}`,
    );
  }

  check('**全程无 JS 错误**', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  fail += 1;
  console.log(`  FAIL 运行异常 - ${e}`);
} finally {
  await browser.close();
}

console.log(`\n结果：${pass}/${pass + fail} 通过`);
if (fail > 0) process.exit(1);
