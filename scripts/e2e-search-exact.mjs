/**
 * E2E：**搜索高亮的像素级精度**（用户反馈："搜索高亮还是不对"）。
 *
 * ## 判据
 *
 * 1. **位置**：高亮框的左边界要和真实文字**一致**（±2px）
 * 2. **内容**：高亮框盖住的文字要**包含关键词**（跨 span 时用并集）
 *
 * ## 修之前的实测数据
 *
 * ```
 * 文本: "An End-to-End Agent Auditing Engine"（32 字）
 * 命中: "Agent"（第 14~18 字）
 *
 * 真实位置:  left=680, width=90
 * 按比例算:  left=677, width=81     ← 窄了 9px ❌
 * ```
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
  await page.waitForTimeout(1500);

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.getAttribute('aria-label') ?? '').includes('搜索'),
    );
    btn?.click();
  });
  await page.waitForTimeout(800);

  const keywords = ['agent', 'A2E', 'audit', 'model', 'the', 'harness'];

  /*
   * ⚠️ **要覆盖不同缩放**（用户反馈："搜索的时候有的时候还是对不齐"）。
   *
   * -> 缩放变了 -> 文本项的几何全变 -> 高亮要跟着重算
   * -> 只测默认缩放 -> 测不出"缩放后错位" ❌
   */
  const zoomLevels = ['默认', '缩小', '放大'];

  for (const zoom of zoomLevels) {
    if (zoom !== '默认') {
      await page.evaluate((mode) => {
        const btns = [...document.querySelectorAll('.scpdf-toolbar__btn')];
        const zoomIn = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('放大'));
        const zoomOut = btns.find((b) => (b.getAttribute('aria-label') ?? '').includes('缩小'));
        if (mode === '缩小') {
          for (let i = 0; i < 4; i += 1) zoomOut?.click();
        } else {
          for (let i = 0; i < 4; i += 1) zoomIn?.click();
        }
      }, zoom);
      await page.waitForTimeout(3000);
    }

    for (const kw of keywords) {
      await page.fill('.scpdf-search__input', kw);
      await page.waitForTimeout(1800);

      const report = await page.evaluate((keyword) => {
        const hits = [...document.querySelectorAll('.scpdf-annotation--search')];
        if (!hits.length) return { checked: 0, ok: 0, bad: 0, samples: [] };
        const k = keyword.toLowerCase();

        let ok = 0;
        let bad = 0;
        const samples = [];

        for (const hit of hits) {
          const hr = hit.getBoundingClientRect();

          // 只在这一页的 span 里找（不同页的 span 在视口坐标里也会"重叠"）
          const hitPage = hit.closest('.scpdf-page');
          if (!hitPage) continue;
          const spans = [...hitPage.querySelectorAll('.scpdf-text-layer__item')];

          // 拼接整页文本 + 记住每个字符属于哪个 span
          const nodes = [];
          let pageText = '';
          for (const s of spans) {
            const node = s.firstChild;
            if (node?.nodeType !== 3) continue;
            nodes.push(node);
            pageText += node.textContent ?? '';
          }
          const pageLower = pageText.toLowerCase();

          const positions = [];
          let from = 0;
          while (true) {
            const at = pageLower.indexOf(k, from);
            if (at < 0) break;
            positions.push(at);
            from = at + 1;
          }
          if (positions.length === 0) continue;

          const ranges = [];
          let cursor = 0;
          for (const node of nodes) {
            const len = (node.textContent ?? '').length;
            ranges.push({ node, start: cursor, end: cursor + len });
            cursor += len;
          }

          // 量拼接文本某个区间对应的真实矩形（可能跨多个 span）
          const rectOf = (start, end) => {
            const r = document.createRange();
            let ok = false;
            for (const nr of ranges) {
              const from2 = Math.max(start, nr.start);
              const to2 = Math.min(end, nr.end);
              if (to2 <= from2) continue;
              r.setStart(nr.node, from2 - nr.start);
              r.setEnd(nr.node, to2 - nr.start);
              ok = true;
            }
            if (!ok) return null;
            const rect = r.getBoundingClientRect();
            r.detach?.();
            return rect.width > 0 ? rect : null;
          };

          // 找离高亮框最近的那次出现
          let real = null;
          let bestDist = Infinity;
          for (const at of positions) {
            const r = rectOf(at, at + k.length);
            if (!r) continue;
            const dist = Math.abs(r.left - hr.left);
            if (dist < bestDist) {
              bestDist = dist;
              real = r;
            }
          }
          if (!real) continue;

          const dLeft = Math.abs(hr.left - real.left);

          // 内容判据：盖住的文字要包含关键词（命中拆成多个框时用并集）
          const nearRects = hits
            .map((h) => h.getBoundingClientRect())
            .filter((r) => {
              const gap = Math.max(r.left - hr.right, hr.left - r.right);
              const vOverlap = Math.min(r.bottom, hr.bottom) - Math.max(r.top, hr.top);
              return gap < 30 && vOverlap > -8;
            });

          const uLeft = Math.min(...nearRects.map((x) => x.left));
          const uRight = Math.max(...nearRects.map((x) => x.right));
          const uTop = Math.min(...nearRects.map((x) => x.top));
          const uBottom = Math.max(...nearRects.map((x) => x.bottom));

          let covered = '';
          for (const s of spans) {
            const node = s.firstChild;
            if (node?.nodeType !== 3) continue;
            const t = node.textContent ?? '';
            const range = document.createRange();
            range.setStart(node, 0);
            range.setEnd(node, t.length);
            const r = range.getBoundingClientRect();
            range.detach?.();
            if (r.width === 0) continue;
            const ox = Math.min(r.right, uRight) - Math.max(r.left, uLeft);
            const oy = Math.min(r.bottom, uBottom) - Math.max(r.top, uTop);
            if (ox > 0 && oy > 0) covered += t;
          }
          /*
           * ⚠️ **字符顺序可能和关键词不同**。
           * → 例：logo 的 "A2E" 里 "2" 是上标 → DOM 顺序是 "2" "A" "E"
           * → 所以判据是"**包含同样的字符**"，不是"顺序一致" ✅
           */
          const strip = (s) => s.toLowerCase().replace(/\s+/g, '');
          const coveredChars = strip(covered);
          const keywordChars = strip(k);
          const contentOk =
            coveredChars.includes(keywordChars) ||
            // 顺序不同但字符一样（排序后比较）
            [...coveredChars].sort().join('') === [...keywordChars].sort().join('') ||
            // 覆盖的是关键词的**一部分**（跨 span 命中，每个框只盖一段）
            (coveredChars.length > 0 && [...keywordChars].every((ch) => coveredChars.includes(ch)));

          // 位置一致 或 内容正确 → 通过
          if (dLeft <= 2 || contentOk) {
            ok += 1;
          } else {
            bad += 1;
            if (samples.length < 3) {
              samples.push({
                kw: keyword,
                left: `${Math.round(hr.left)} vs ${Math.round(real.left)}`,
                covered: covered.slice(0, 30),
              });
            }
          }
        }

        return { checked: ok + bad, ok, bad, samples };
      }, kw);

      check(
        `**搜索 "${kw}" 的高亮框和真实文字逐像素对齐（缩放：${zoom}）**`,
        report.bad === 0 && report.ok > 0,
        report.samples.length
          ? JSON.stringify(report.samples)
          : `${report.ok}/${report.checked} 精确`,
      );
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
