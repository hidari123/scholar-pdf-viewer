/**
 * E2E：**搜索高亮的定位准确性**（用户反馈"搜索功能高亮定位不准确 这个是个bug 有的不准"）。
 *
 * ## 根因（实测）
 *
 * 搜索索引的项和渲染的项**不是同一份**：
 * ```
 * 索引: content.items 全部（保持 PDF 原始顺序）
 * 渲染: layoutTextItems → 跳过空项 / 定位失败 / **旋转文字**
 * ```
 * → 索引文本 **3010** 字符 / 渲染文本 **2553** 字符 → **差 457**
 * → 偏移错位 → **高亮跑到别的字上** ❌
 *
 * ## 修法
 *
 * ① 索引建的时候**也跳过旋转文字**（需要视口）→ 两边文本**完全一致**
 * ② 渲染侧按**字符位置**（而不是项的下标）映射 → 兜底也对
 *
 * ## 验证什么
 *
 * 搜索一个关键词 → 每个高亮矩形**必须盖住含该关键词的文字**。
 *
 * ⚠️ **验证方法**：文本层的 span 是**按屏幕坐标排序**的，
 *    而高亮矩形是按**字符比例**裁出来的 →
 *    所以要按**比例**算出"命中落在 span 的哪个字符"，
 *    再看那几个字符是不是关键词 ✅
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

/**
 * 搜一个词，然后检查每个高亮矩形**下面**是不是那个词。
 */
async function searchAndVerify(keyword) {
  await page.evaluate((kw) => {
    const input = document.querySelector('.scpdf-search__input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, kw);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, keyword);
  await page.waitForTimeout(2500);

  return page.evaluate((kw) => {
    const rects = [...document.querySelectorAll('.scpdf-annotation--search')].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width };
    });

    const spans = [...document.querySelectorAll('.scpdf-text-layer__item')];

    /*
     * 对每个高亮矩形：
     * → 找到它**落在哪个 span 上**（垂直重叠 + 水平重叠最大）
     * → 按**字符比例**算出"命中在这个 span 的哪个字符开始"
     * → 检查那几个字符是不是关键词
     */
    const checked = rects.map((rect) => {
      let best = null;
      let bestOverlap = 0;

      for (const span of spans) {
        const sr = span.getBoundingClientRect();
        const ox = Math.min(rect.right, sr.right) - Math.max(rect.left, sr.left);
        const oy = Math.min(rect.bottom, sr.bottom) - Math.max(rect.top, sr.top);
        if (ox <= 0 || oy <= 0) continue;
        const overlap = ox * oy;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = span;
        }
      }

      if (!best) {
        return { ok: false, reason: '找不到对应的文字', text: '' };
      }

      const sr = best.getBoundingClientRect();
      const text = best.textContent ?? '';

      /*
       * ⚠️ **按比例**算字符位置。
       *
       * → 高亮矩形可能是 span 的一部分（关键词在中间）
       * → 用 "高亮左边界在 span 里的相对位置" × 文本长度 → 起始字符
       * → 起始字符 + 关键词长度 → 应该正好是关键词
       */
      if (sr.width <= 0 || text.length === 0) {
        return { ok: false, reason: 'span 宽度为 0', text };
      }
      const ratio = (rect.left - sr.left) / sr.width;
      const start = Math.max(0, Math.round(ratio * text.length));
      const slice = text.slice(start, start + kw.length);

      return {
        ok: slice.toLowerCase() === kw.toLowerCase(),
        reason: '',
        text: slice,
        spanText: text.slice(0, 40),
      };
    });

    return {
      count: rects.length,
      matched: checked.filter((c) => c.ok).length,
      samples: checked
        .filter((c) => !c.ok)
        .slice(0, 3)
        .map((c) => ({ reason: c.reason, text: c.text, span: c.spanText })),
    };
  }, keyword);
}

try {
  await page.goto(E2E_BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    {
      timeout: 30000,
    },
  );
  await page.waitForTimeout(2500);

  // 打开搜索面板
  const hasInput = await page.evaluate(() => !!document.querySelector('.scpdf-search__input'));
  if (!hasInput) {
    const buttons = await page.locator('.scpdf-toolbar button').all();
    for (const b of buttons) {
      const title = await b.getAttribute('aria-label');
      const t = await b.getAttribute('title');
      if ((title ?? '').includes('搜索') || (t ?? '').includes('搜索')) {
        await b.click();
        break;
      }
    }
    await page.waitForTimeout(800);
  }

  for (const kw of ['Auditing', 'Agent', 'benchmark', 'harness']) {
    const result = await searchAndVerify(kw);
    console.log(`  搜索 "${kw}": ${result.count} 个高亮，${result.matched} 个命中位置正确`);
    if (result.samples.length > 0) {
      console.log(`    错的样本: ${JSON.stringify(result.samples)}`);
    }
    if (result.count === 0) {
      console.log('    （没有高亮，跳过）');
      continue;
    }
    check(
      `**搜索"${kw}"的高亮都落在正确的字上**`,
      result.matched === result.count,
      `${result.matched}/${result.count}`,
    );
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
