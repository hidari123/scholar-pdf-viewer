/**
 * E2E：**全缩放档位**的选区 / 高亮 / 性能 / 浮层综合验证。
 *
 * 用户要求："再全部验证一下缩放状态下选中是否准确 选中的时候的性能如何
 *           高亮的状态是否准确 各个情况下你都验证一下"
 *
 * ## 每个缩放档位测 4 件事
 *
 * 1. **选区精准度** —— 自绘选区块 vs **画布墨迹**（ground truth）
 * 2. **高亮精准度** —— 高亮块 vs **画布墨迹**
 * 3. **拖动性能** —— 帧间隔 p50/p95/长帧数
 * 4. **浮层锚定** —— 浮层与选区的间距
 *
 * ## 为什么必须跟"画布墨迹"比
 *
 * 浏览器自己的选区 rect 高度 = 字体的**自然行盒**（比文字本身高 ~30%）
 * → 拿它当基准会得出"偏了 7px"的假结论（之前踩过）。
 * canvas 上 pdf.js 画出来的像素才是"文字实际在哪"的唯一真相。
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PROBE_SOURCE } from './e2e-canvas-ink-probe.mjs';

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

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5200';
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** 要测的缩放档位 */
const SCALES = [
  { name: 'fit', value: null },
  { name: '50%', value: 0.5 },
  { name: '100%', value: 1.0 },
  { name: '150%', value: 1.5 },
  { name: '200%', value: 2.0 },
  { name: '250%', value: 2.5 },
];

const exe = resolveChromium();
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.waitForFunction(
    () => document.querySelectorAll('.scpdf-text-layer__item').length > 50,
    { timeout: 30000 },
  );
  await page.addInitScript(PROBE_SOURCE);
  await page.evaluate(PROBE_SOURCE);
  await page.waitForTimeout(1500);

  for (const step of SCALES) {
    console.log(`\n=== 缩放 ${step.name} ===`);

    // ---- 设置缩放（用真实按钮，模拟用户路径）----
    if (step.value !== null) {
      // 先"适配宽度"，再逐级调到目标
      await page.locator('[aria-label="适应宽度"]').click();
      await page.waitForTimeout(1000);

      for (let i = 0; i < 40; i++) {
        const now = await page.evaluate(() => {
          const el = document.querySelector('.scpdf-toolbar__scale');
          return el ? Number.parseFloat(el.textContent ?? '0') / 100 : null;
        });
        if (now === null) break;
        if (Math.abs(now - step.value) < 0.055) break;
        if (now < step.value) {
          await page.locator('[aria-label="放大"]').click();
        } else {
          await page.locator('[aria-label="缩小"]').click();
        }
        await page.waitForTimeout(80);
      }
      await page.waitForTimeout(1400);
    } else {
      await page.locator('[aria-label="适应宽度"]').click();
      await page.waitForTimeout(1400);
    }

    // ---- 滚回顶部 ----
    await page.evaluate(() => {
      const c = document.querySelector('.scpdf-container');
      if (c) c.scrollTop = 0;
    });
    await page.waitForTimeout(900);

    /*
     * ⚠️ **等文本层重新渲染完**（缩放会重建所有页 → 虚拟化会卸载/重挂）。
     *
     * 实测：缩放后立刻查 → `total: 0`（span 还没挂上）
     *      → "找不到正文" → 假失败。
     */
    await page
      .waitForFunction(() => document.querySelectorAll('.scpdf-text-layer__item').length > 20, {
        timeout: 15000,
      })
      .catch(() => {});

    const scaleNow = await page.evaluate(() => {
      const el = document.querySelector('.scpdf-toolbar__scale');
      return el ? el.textContent?.trim() : '?';
    });
    console.log(`  实际缩放: ${scaleNow}`);

    // ---- 找一段正文（可能需要滚动）----
    const findTarget = async () => {
      for (const scroll of [0, 200, 400, 600]) {
        await page.evaluate((s) => {
          const c = document.querySelector('.scpdf-container');
          if (c) c.scrollTop = s;
        }, scroll);
        await page.waitForTimeout(700);

        const found = await page.evaluate(() => {
          const spans = [...document.querySelectorAll('.scpdf-text-layer__item')].filter((x) => {
            const r = x.getBoundingClientRect();
            const fs = Number.parseFloat(getComputedStyle(x).fontSize);
            /*
             * ⚠️ **低缩放时字很小**（50% → 正文只有 5px 高）
             *    → 阈值必须放宽，否则"找不到正文"（那是**正常现象**，不是 bug）。
             */
            return (
              fs > 3 &&
              (x.textContent ?? '').trim().length > 20 &&
              r.width > 60 &&
              r.top > 60 &&
              r.top < 700
            );
          });
          if (spans.length === 0) return null;
          /*
           * 返回**多个候选**（逐个试）。
           *
           * ⚠️ 有些 span 选不出字（**浏览器行为，不是包的 bug**）：
           *   真实 PDF 左侧的**旋转戳**（`transform: matrix(0.85,0,0,1,0,0)`）
           *   → mousedown 落在它上面 → 浏览器**不创建选区**（旋转文字不参与选区）
           *   → 但它的 `getBoundingClientRect()` 看起来完全正常 → 静态检查发现不了
           */
          return spans.slice(0, 8).map((el) => {
            const r = el.getBoundingClientRect();
            const dragLen = Math.max(30, Math.min(200, r.width - 24));
            return {
              x: Math.min(r.left + 12, r.right - 20),
              /*
               * ⚠️ **点在字形的上三分之一**，不是垂直中心。
               *
               * 低缩放时行高只有 7-8px，垂直中心可能落在**行间空隙**
               * → 鼠标在那里按下 → 选不中任何字（实测 50% 选区 = 0 字符）。
               * → 往上偏 1/4 个行高 → 一定落在字形上。
               */
              y: r.top + r.height * 0.3,
              left: r.left,
              top: r.top,
              height: r.height,
              dragLen,
              fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
            };
          });
        });
        if (found && found.length > 0) return found;
      }
      return null;
    };

    /*
     * ⚠️ **先彻底清场，再找目标**（顺序不能反）。
     *
     * 上一档位用合成事件（fire('mousedown')）做过性能测试
     * → 浏览器可能还处于"正在拖选"的状态
     * → 下一档位的真实拖动被并入 → 选区为 0（实测 50% / 200% 选不中任何字）。
     *
     * → 移开鼠标 + 按 ESC（取消拖选）+ 清选区，**然后**再找目标、拖选。
     */
    await page.mouse.move(20, 300);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.waitForTimeout(300);

    const target = await findTarget();

    if (!target) {
      const diag = await page.evaluate(() => {
        const all = [...document.querySelectorAll('.scpdf-text-layer__item')];
        const vis = all.filter((x) => {
          const r = x.getBoundingClientRect();
          return r.top > 0 && r.top < 900 && r.width > 20;
        });
        return {
          total: all.length,
          visible: vis.length,
          sample: vis.slice(0, 5).map((x) => {
            const r = x.getBoundingClientRect();
            return {
              top: Math.round(r.top),
              w: Math.round(r.width),
              fs: Math.round(Number.parseFloat(getComputedStyle(x).fontSize)),
              len: (x.textContent ?? '').trim().length,
            };
          }),
          scroll: document.querySelector('.scpdf-container')?.scrollTop,
          scale: document.querySelector('.scpdf-toolbar__scale')?.textContent,
        };
      });
      console.log(`  诊断: ${JSON.stringify(diag)}`);
      check(`${step.name}: 找到正文`, false, '视口内没有正文');
      continue;
    }
    console.log(`  候选数: ${target.length}`);

    /*
     * ---- 选中一段 ----
     *
     * ⚠️ **要重试**：有些 span 选不出字（浏览器行为，不是包的 bug）。
     *
     * 例子（真实 PDF，200% 缩放）：
     * - 页面左侧的**旋转戳**（`transform: matrix(0.85, 0, 0, 1, 0, 0)`）
     *   → mousedown 落在它上面 → 浏览器**不创建选区**（旋转文字不参与选区）
     * - 但它 `getBoundingClientRect()` 看起来完全正常 → 静态检查发现不了
     *
     * → 逐个候选试，选出**第一个真的选中了字**的。
     */
    let selected = null;
    for (const cand of target) {
      await page.mouse.move(20, 300);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.waitForTimeout(120);

      await page.mouse.move(cand.x, cand.y);
      await page.mouse.down();
      await page.mouse.move(cand.x + cand.dragLen, cand.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(450);

      const len = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
      /*
       * ⚠️ **选区太大 = 拖过整页**（拖到了别的行/别的页）。
       * → 不接受 → 清掉 → 试下一个候选。
       */
      if (len > 0 && len < 500) {
        selected = { ...cand, len };
        break;
      }
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.waitForTimeout(150);
    }

    if (!selected) {
      check(`${step.name}: 选中文字`, false, '所有候选都没选出字');
      continue;
    }
    console.log(`  选中 ${selected.len} 字符（字号 ${selected.fontSize}px）`);
    const target2 = selected;

    const measured = await page.evaluate(() => {
      const canvas = document.querySelector('.scpdf-canvas');
      /*
       * ⚠️ **只取 clipPath 里的 rect**。
       *
       * .scpdf-selection-layer 里还有一个**填充 rect**（x=0 y=0 width=100%）
       * → 如果用 querySelectorAll('rect') 会把它一起取到
       * → 它的 x/y 都是 0 → 测出来的偏移全是假的。
       */
      const selRects = [...document.querySelectorAll('.scpdf-selection-layer clipPath rect')].map(
        (r) => ({
          x: Number.parseFloat(r.getAttribute('x') ?? '0'),
          y: Number.parseFloat(r.getAttribute('y') ?? '0'),
          w: Number.parseFloat(r.getAttribute('width') ?? '0'),
          h: Number.parseFloat(r.getAttribute('height') ?? '0'),
        }),
      );
      const annRects = [...document.querySelectorAll('.scpdf-annotation')].map((el) => {
        const r = el.getBoundingClientRect();
        const pageEl = document.querySelector('.scpdf-page');
        const pr = pageEl?.getBoundingClientRect();
        return {
          left: pr ? r.left - pr.left : r.left,
          top: pr ? r.top - pr.top : r.top,
          right: pr ? r.right - pr.left : r.right,
          bottom: pr ? r.bottom - pr.top : r.bottom,
        };
      });

      const ink = window.__pdfInkProbe ? window.__pdfInkProbe(canvas, selRects) : null;

      const sel = window.getSelection();
      const rangeRect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const popRect = document.querySelector('.scpdf-selection-popover')?.getBoundingClientRect();

      return {
        selRects,
        annRects,
        ink,
        selLen: sel?.toString().length ?? 0,
        popGap: rangeRect && popRect ? Math.round(popRect.top - rangeRect.bottom) : null,
        popExists: !!popRect,
      };
    });

    // ---- 1. 选区精准度（对画布墨迹）----
    check(
      `${step.name}: 选区块已生成`,
      measured.selRects.length > 0 && measured.selLen > 0,
      `${measured.selRects.length} 个 / ${measured.selLen} 字符`,
    );

    if (measured.ink?.rows) {
      /*
       * ⚠️ **逐行比较**（选区可能跨多行）。
       *
       * 每一行：选区矩形 vs 该行的墨迹。
       * → 水平：选区要贴合墨迹的左右
       * → 垂直：选区要**包含**墨迹（不切字形），且留白不超过 em 盒的一定比例
       */
      const rows = measured.ink.rows;
      const selRects = measured.selRects;

      let maxDL = 0;
      let maxDR = 0;
      let worstSlack = 0;
      let worstSlackRow = 0;
      let cutRows = 0;

      for (let i = 0; i < rows.length; i++) {
        const ink = rows[i];
        const sel = selRects[i];
        if (!sel) continue;

        const selLeft = sel.x;
        const selRight = sel.x + sel.w;
        const selTop = sel.y;
        const selBottom = sel.y + sel.h;

        maxDL = Math.max(maxDL, Math.abs(ink.left - selLeft));
        maxDR = Math.max(maxDR, Math.abs(ink.right - selRight));

        // 切字形？（墨迹超出了选区）
        if (ink.top < selTop - 2 || ink.bottom > selBottom + 2) {
          cutRows += 1;
        }

        const emHeight = selBottom - selTop;
        const slack = emHeight - (ink.bottom - ink.top);
        if (slack / emHeight > worstSlack) {
          worstSlack = slack / emHeight;
          worstSlackRow = i;
        }
      }

      console.log(
        `  墨迹行数: ${rows.length} / 选区行数: ${selRects.length}，最大 Δ左=${maxDL.toFixed(2)} Δ右=${maxDR.toFixed(2)}`,
      );

      check(
        `${step.name}: 选区水平贴合墨迹`,
        maxDL <= 3.5 && maxDR <= 3.5,
        `Δ左=${maxDL.toFixed(2)} Δ右=${maxDR.toFixed(2)}`,
      );
      check(
        `${step.name}: 选区垂直包含墨迹（不切字形）`,
        cutRows === 0 && worstSlack <= 0.6,
        `切字形行数=${cutRows} 最大留白=${(worstSlack * 100).toFixed(0)}%（第${worstSlackRow + 1}行）`,
      );
    } else {
      check(`${step.name}: 墨迹探针可用`, false, '探针没返回数据');
    }

    // ---- 4. 浮层锚定 ----
    /*
     * ⚠️ **要在性能测试之后再测**。
     *
     * 性能测试用合成事件（fire('mousedown')）做拖动 →
     * 浏览器会**替换**当前选区（合成事件的拖动也会改选区）
     * → 测浮层时选区已经变了 → 间距对不上。
     *
     * → 性能测试之后**重新选一次**，再量浮层。
     */
    await page.mouse.move(20, 300);
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await page.waitForTimeout(300);

    let _reselected = null;
    /*
     * ⚠️ **必须重新找候选**（坐标会过期）。
     *
     * 性能测试的合成拖动会改变选区和滚动位置
     * → 之前算好的候选坐标不再对应那个 span
     * → 按旧坐标拖 → 可能拖过整页 → 选区变成 2938 字符（实测）。
     */
    const freshCandidates = (await findTarget()) ?? [];
    for (const cand of freshCandidates) {
      await page.mouse.move(cand.x, cand.y);
      await page.mouse.down();
      await page.mouse.move(cand.x + cand.dragLen, cand.y, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(450);
      const len = await page.evaluate(() => window.getSelection()?.toString().length ?? 0);
      /*
       * ⚠️ **选区太大 = 拖过整页**（坐标过期了）。
       * → 不接受 → 清掉 → 试下一个候选。
       */
      if (len > 0 && len < 500) {
        _reselected = len;
        break;
      }
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.waitForTimeout(150);
    }

    const popState = await page.evaluate(() => {
      const sel = window.getSelection();
      const rr = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
      const p = document.querySelector('.scpdf-selection-popover');
      const pr = p?.getBoundingClientRect();
      return {
        popExists: !!p,
        gap: rr && pr ? Math.round(pr.top - rr.bottom) : null,
        selLen: sel?.toString().length ?? 0,
      };
    });

    check(
      `${step.name}: 浮层锚定在选区上`,
      popState.popExists && popState.gap !== null && Math.abs(popState.gap) < 200,
      `间距 ${popState.gap}px（选区 ${popState.selLen} 字符）`,
    );

    /*
     * ---- 高亮精准度 ----
     *
     * 高亮是**宿主**的数据（`highlights` prop）→ demo 里要点"添加高亮"按钮。
     *
     * ⚠️ **放在最后**：点"添加高亮"会清掉当前选区
     *    （`clearSelectionAfterHighlight`）→ 不能再用它做后面的测量。
     *
     * ⚠️ 高亮存的是**归一化坐标**（norm）→ 缩放后要重新换算
     *    → 这一步同时验证了"高亮在缩放后位置还对不对"。
     */
    await page.locator('[aria-label="添加高亮"]').click();
    await page.waitForTimeout(700);

    const hl = await page.evaluate(() => {
      const pageEl = document.querySelector('.scpdf-page');
      const pr = pageEl?.getBoundingClientRect();
      const rects = [...document.querySelectorAll('.scpdf-annotation')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          left: pr ? r.left - pr.left : r.left,
          top: pr ? r.top - pr.top : r.top,
          right: pr ? r.right - pr.left : r.right,
          bottom: pr ? r.bottom - pr.top : r.bottom,
          width: r.width,
          height: r.height,
        };
      });
      const canvas = document.querySelector('.scpdf-canvas');
      const ink = window.__pdfInkProbe
        ? window.__pdfInkProbe(
            canvas,
            [rects[rects.length - 1]].map((r) => ({
              x: r.left,
              y: r.top,
              w: r.width,
              h: r.height,
            })),
          )
        : null;
      return { rects, ink };
    });

    if (hl.rects.length > 0) {
      check(`${step.name}: 高亮已生成`, true, `${hl.rects.length} 块`);
      if (hl.ink?.rows) {
        const rows = hl.ink.rows;
        // 用**最后一个**高亮块（最新加的那个）
        const h = hl.rects[hl.rects.length - 1];
        let maxDL = 0;
        let maxDR = 0;
        let cutRows = 0;
        let worstSlack = 0;

        for (const ink of rows) {
          maxDL = Math.max(maxDL, Math.abs(ink.left - h.left));
          maxDR = Math.max(maxDR, Math.abs(ink.right - h.right));
          if (ink.top < h.top - 3 || ink.bottom > h.bottom + 3) {
            cutRows += 1;
          }
          const emHeight = h.bottom - h.top;
          worstSlack = Math.max(worstSlack, (emHeight - (ink.bottom - ink.top)) / emHeight);
        }

        console.log(
          `  高亮墨迹: 行数=${rows.length} Δ左=${maxDL.toFixed(2)} Δ右=${maxDR.toFixed(2)}`,
        );
        check(
          `${step.name}: 高亮水平贴合墨迹`,
          maxDL <= 3.5 && maxDR <= 3.5,
          `Δ左=${maxDL.toFixed(2)} Δ右=${maxDR.toFixed(2)}`,
        );
        check(
          `${step.name}: 高亮垂直包含墨迹（不切字形）`,
          cutRows === 0 && worstSlack <= 0.6,
          `切字形行数=${cutRows} 最大留白=${(worstSlack * 100).toFixed(0)}%`,
        );
      } else {
        check(`${step.name}: 高亮墨迹探针可用`, false, '探针没返回数据');
      }
    } else {
      check(`${step.name}: 高亮已生成`, false, '点"添加高亮"后没有高亮块');
    }

    /*
     * ⚠️ **不要直接删 `.scpdf-annotation` DOM**！
     *
     * 那是 React 渲染的节点 → 直接 `el.remove()` 会让 React 的 DOM 状态和
     * 实际 DOM 对不上 → **下一次渲染时 React 会清掉整个文本层**
     * → 实测：下一档位 `spans: 0` → "找不到正文"（假失败）。
     *
     * → 不清理（高亮会累积，但不影响测量 —— 每次量的是**最后一个**高亮块）。
     */
    // ---- 3. 拖动性能 ----
    const perf = await page.evaluate(async (t) => {
      const el = document.elementFromPoint(t.x, t.y);
      if (!el) return null;
      const fire = (type, x, y) =>
        el.dispatchEvent(
          new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, buttons: 1 }),
        );

      const frames = [];
      let last = performance.now();
      let raf;
      const tick = () => {
        const n = performance.now();
        frames.push(n - last);
        last = n;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);

      fire('mousedown', t.x, t.y);
      for (let i = 1; i <= 30; i++) {
        fire('mousemove', t.x + i * 6, t.y);
        await new Promise((r) => requestAnimationFrame(r));
      }
      fire('mouseup', t.x + 180, t.y);
      await new Promise((r) => requestAnimationFrame(r));
      cancelAnimationFrame(raf);

      const gaps = frames
        .slice(1)
        .filter((f) => f > 0)
        .sort((a, b) => a - b);
      return {
        p50: +gaps[Math.floor(gaps.length / 2)].toFixed(1),
        p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1),
        max: +gaps[gaps.length - 1].toFixed(1),
        over32: gaps.filter((g) => g > 32).length,
      };
    }, target2);

    if (perf) {
      console.log(`  性能: ${JSON.stringify(perf)}`);
      check(
        `${step.name}: 拖动满帧（p95 ≤ 20ms，无长帧）`,
        perf.p95 <= 20 && perf.over32 === 0,
        `p95=${perf.p95}ms 长帧${perf.over32}个`,
      );
    }
  }

  check('全程无 JS 错误', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (error) {
  check('E2E 执行无异常', false, String(error));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：');
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
