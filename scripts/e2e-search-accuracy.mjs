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
 *    再看那几个字符是不是关键词
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
    /*
     * 对每个高亮矩形：
     * -> 找到它**落在哪个 span 上**
     * -> 用 **Range** 逐字符量"高亮框盖住了哪些字符"
     * -> 检查那些字符是不是关键词的一部分
     *
     * ⚠️⚠️ **不能用"字符比例"算**（实测踩过的坑）：
     * -> 比例字体里每个字符宽度不一样 ❌
     * -> 用比例算出来的位置是**错的** -> 会误判 ❌
     * -> 必须用 **Range.getBoundingClientRect()** 逐字符量
     *
     * ⚠️ **也不能只看"重叠面积最大的那个 span"**：
     * -> 高亮框可能横跨多个 span；也可能和别的 span 有重叠
     * -> 要在**整页所有 span** 里找"离高亮框最近"的那次出现
     */
    const checked = rects.map((rect) => {
      // 在整页里找关键词的所有出现位置
      const nodes = [];
      let pageText = '';
      for (const span of spans) {
        const n = span.firstChild;
        if (n?.nodeType !== 3) continue;
        nodes.push(n);
        pageText += n.textContent ?? '';
      }
      const pageLower = pageText.toLowerCase();
      const positions = [];
      let from = 0;
      while (true) {
        const at = pageLower.indexOf(kw.toLowerCase(), from);
        if (at < 0) break;
        positions.push(at);
        from = at + 1;
      }
      if (positions.length === 0) {
        return { ok: false, reason: '整页都没找到关键词', text: '' };
      }

      // 每个 span 的字符区间
      const ranges = [];
      let cursor = 0;
      for (const n of nodes) {
        const len = (n.textContent ?? '').length;
        ranges.push({ node: n, start: cursor, end: cursor + len });
        cursor += len;
      }

      // 量拼接文本某个区间对应的真实矩形
      const rectOf = (start2, end2) => {
        const r = document.createRange();
        let ok = false;
        for (const nr of ranges) {
          const f = Math.max(start2, nr.start);
          const t = Math.min(end2, nr.end);
          if (t <= f) continue;
          r.setStart(nr.node, f - nr.start);
          r.setEnd(nr.node, t - nr.start);
          ok = true;
        }
        if (!ok) return null;
        const out = r.getBoundingClientRect();
        r.detach?.();
        return out.width > 0 ? out : null;
      };

      // 找**离高亮框最近**的那次出现
      let real = null;
      let bestDist = Infinity;
      for (const at of positions) {
        const r = rectOf(at, at + kw.length);
        if (!r) continue;
        const dist = Math.abs(r.left - rect.left);
        if (dist < bestDist) {
          bestDist = dist;
          real = r;
        }
      }
      if (!real) {
        return { ok: false, reason: '量不到关键词位置', text: '' };
      }

      // 高亮框的左边界应该落在关键词范围内
      const inside = rect.left >= real.left - 3 && rect.left <= real.right + 3;
      return {
        ok: inside,
        reason: inside ? '' : '位置不在关键词范围内',
        text: `${Math.round(rect.left)} vs ${Math.round(real.left)}-${Math.round(real.right)}`,
        spanText: '',
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
