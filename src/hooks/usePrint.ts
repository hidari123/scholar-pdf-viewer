/**
 * `usePrint` —— 打印的**编排**（算缩放 → 应用 → 打印 → 恢复）。
 *
 * ## 为什么需要
 *
 * 打印不只是调 `window.print()`：
 *
 * 1. **缩放要按纸张算**（屏幕是"适合窗口"，打印是"适合纸张"）
 * 2. **等重排完成**再打印（否则打印的是缩放前的布局）
 * 3. **打印完要恢复**（不能让用户的缩放被改掉）
 *
 * ## 用法
 *
 * ```tsx
 * const { print, preparing } = usePrint({
 *   pageSizePt: { width: 595, height: 842 },   // 页的点尺寸
 *   paper: 'A4',
 * });
 *
 * <button onClick={print} disabled={preparing}>打印</button>
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  computePrintScale,
  computePrintScaleForRender,
  DEFAULT_PRINT_MARGIN,
  PAPER_SIZES,
  type PaperSize,
  type PrintMargin,
  type PrintOrientation,
} from '../core/print';

/**
 * **打印时"页数对不上"最多重试多少帧**（约 1 秒）。
 *
 * ⚠️ 审计发现的**无限 rAF 风险**：
 * -> 宿主给的 \`pageCount\` 永远对不上 -> **无限递归 rAF** ❌
 *    -> CPU 100% + **永远停不下来** ❌
 * -> 现在：**有上限** -> 放弃也算完成 ✅
 */
const MAX_PRINT_RETRIES = 60;

/** usePrint 的参数 */
export interface UsePrintOptions {
  /** 页面的**点**尺寸（72dpi，如 A4 = 595 × 842） */
  pageSizePt?: { width: number; height: number };
  /** 纸张规格（名字或尺寸） */
  paper?: keyof typeof PAPER_SIZES | PaperSize;
  /**
   * **打印方向**（用户确认："允许"）。
   *
   * - `portrait` 纵向（默认）
   * - `landscape` 横向（**竖版 PDF 旋转 90° 打印**，像 WPS / Word）
   * - `auto` 跟着用户打印对话框走
   */
  orientation?: PrintOrientation;
  /** 打印边距（mm） */
  margin?: Partial<PrintMargin>;
  /** 目标元素（默认找 `.scpdf-root`） */
  root?: HTMLElement | null;
  /**
   * **页数**。
   *
   * ⚠️ 用来在"页数变化"时重算每页的高度（打印 CSS 依赖它）。
   */
  pageCount?: number;
  /** 打印完的回调 */
  onAfterPrint?: () => void;
}

/** usePrint 的返回值 */
export interface UsePrintResult {
  /** 触发打印 */
  print: () => void;
  /** 正在准备打印（算缩放 + 等重排） */
  preparing: boolean;
}

/**
 * 打印。
 *
 * @param options 参数
 * @returns 打印函数 + 准备状态
 */
export function usePrint(options: UsePrintOptions = {}): UsePrintResult {
  const {
    pageSizePt,
    paper = 'A4',
    orientation = 'auto',
    margin,
    root,
    pageCount,
    onAfterPrint,
  } = options;

  /** 正在准备 */
  const [preparing, setPreparing] = useState(false);

  /**
   * ⚠️ **把 margin 拆成 4 个 number**（避免每次渲染都是新对象）。
   *
   * `margin` 是对象 → 宿主每次传字面量 `{ margin: {...} }` → 引用每次都变
   * → 放进 `useCallback` 的依赖 → **`print` 每次都是新函数**
   * → 宿主把它放进 `useEffect` 依赖 → **反复触发**。
   */
  const marginTop = margin?.top ?? DEFAULT_PRINT_MARGIN.top;
  const marginRight = margin?.right ?? DEFAULT_PRINT_MARGIN.right;
  const marginBottom = margin?.bottom ?? DEFAULT_PRINT_MARGIN.bottom;
  const marginLeft = margin?.left ?? DEFAULT_PRINT_MARGIN.left;

  /*
   * ⚠️ **`onAfterPrint` 放进 ref**（避免它进依赖数组）。
   *
   * 宿主传 inline 箭头函数 → 每次渲染都是新引用 → 同上问题。
   */
  const onAfterPrintRef = useRef(onAfterPrint);
  useEffect(() => {
    onAfterPrintRef.current = onAfterPrint;
  }, [onAfterPrint]);

  /*
   * ⚠️ **打印用的 CSS 变量要"一直"在**（不是只在点打印按钮时才写）。
   *
   * ### 为什么要一直写（用户反馈"目前的打印预览效果还是不对"）
   *
   * 打印 CSS 依赖两个变量：
   * ```
   * --scpdf-print-scale        ← 页面按纸张的缩放
   * --scpdf-print-page-height  ← 每页的原高度（用来把布局盒也缩掉）
   * ```
   *
   * → 之前**只在 `print()` 里写**（点工具栏的打印按钮）
   * → 但用户按 **Ctrl+P**（浏览器的打印预览）**不会走 `print()`**
   * → 变量是空的 → `scale(1)` + `height: 0`
   * → **打印预览里页被裁掉 / 消失** ❌（用户看到的就是这个）
   *
   * ### 修法
   *
   * **用一个 effect 把变量一直写好**（页尺寸变化时更新）：
   * → 任何打印路径（按钮 / Ctrl+P / 宿主自己的按钮）都能拿到正确的缩放 ✅
   *
   * ⚠️ 打印**结束后**不用恢复（因为它本来就该是"打印时的正确值"）
   *    → 屏幕上的显示**不受影响**（这些变量只在 `@media print` 里用）。
   */
  useEffect(() => {
    const target = root ?? document.querySelector<HTMLElement>('.scpdf-root');
    if (!target) {
      return;
    }

    const paperSize = typeof paper === 'string' ? PAPER_SIZES[paper] : paper;
    const fullMargin: PrintMargin = {
      top: marginTop,
      right: marginRight,
      bottom: marginBottom,
      left: marginLeft,
    };

    /*
     * ⚠️⚠️ **缩放要按"渲染后的像素尺寸"算**（实测踩过的坑）。
     *
     * ```
     * 屏幕上的页: 1408 × 1821.6 px   ← "适合宽度"的缩放（2.3×）
     * A4 可打印区: 703 × 1032 px
     *
     * 旧做法（物理比例 0.861）: 1213 × 1569 px = 322 × 415 mm
     *   → 远超 A4 → **18 页的 PDF 打印成 36 页**（每页溢出到第二张纸）❌
     *
     * 正确做法: min(703/1408, 1032/1821.6) = 0.499
     *   → 703 × 909 px = 186 × 240 mm → **正好落在 A4 可打印区里** ✅
     */
    const applyPrintScale = () => {
      const firstPage = target.querySelector<HTMLElement>('.scpdf-page');
      if (!firstPage) {
        // 还没有页 → 先用物理比例兜底（页渲染出来后会再算）
        const fallback = pageSizePt ? computePrintScale(pageSizePt, paperSize, fullMargin) : 1;
        target.style.setProperty('--scpdf-print-scale', String(fallback));
        return;
      }

      // ⚠️ 用**内联**的宽高（不受打印 CSS 的 `calc()` 影响）
      const rawWidth = Number.parseFloat(firstPage.style.width);
      const rawHeight = Number.parseFloat(firstPage.style.height);
      const renderedWidth =
        Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : firstPage.offsetWidth;
      const renderedHeight =
        Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : firstPage.offsetHeight;

      const scale = computePrintScaleForRender(
        { width: renderedWidth, height: renderedHeight },
        paperSize,
        fullMargin,
        orientation,
      );
      target.style.setProperty('--scpdf-print-scale', String(scale));
    };

    applyPrintScale();

    /*
     * ⚠️ **逐页写高度**（历史遗留的变量）。
     *
     * ⚠️ 现在打印 CSS 用的是 **`zoom`**（同时改布局盒和视觉）
     *    → 不再**必须**有 `--scpdf-print-page-height` / `--scpdf-print-page-width`
     *    → 但**保留写入**（万一宿主的 CSS 依赖它们）。
     *
     * ⚠️ **页可能还没渲染出来**（首帧 / 虚拟滚动）
     * → 用 `ResizeObserver` 盯着第一页 → 尺寸变了就重算。
     */
    const applyPageHeights = (retryCount = 0) => {
      const pages = target.querySelectorAll<HTMLElement>('.scpdf-page');
      for (const pageEl of pages) {
        /*
         * ⚠️⚠️ **必须量"未缩放"的高度**（实测踩过的坑）。
         *
         * ```
         * 用 getBoundingClientRect().height:
         *   → 打印态下 height 已经被 `calc(原高 × scale)` 缩过了
         *   → 量到 0.013px → 再写回变量 → 下一帧更小 → **高度塌成 0** ❌
         *   → 页全部消失
         * ```
         *
         * → **用内联的 `style.height`**（那才是"原始高度"，不受打印 CSS 影响）。
         * → 拿不到就退回 `offsetHeight`（也是布局盒高度，不含 transform）。
         */
        const rawHeight = Number.parseFloat(pageEl.style.height);
        const height =
          Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : pageEl.offsetHeight;

        if (height > 0) {
          pageEl.style.setProperty('--scpdf-print-page-height', `${height}px`);
        }

        /*
         * ⚠️ **宽度也要写**（打印时按纸张缩放）。
         *
         * → 同样要用**内联**的宽度（不受打印 CSS 影响）。
         */
        const rawWidth = Number.parseFloat(pageEl.style.width);
        const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : pageEl.offsetWidth;

        if (width > 0) {
          pageEl.style.setProperty('--scpdf-print-page-width', `${width}px`);
        }
      }
      /*
       * ⚠️⚠️ **页数对不上 -> 再等下一帧**（页可能正在渲染）
       * -> `pageCount` 是宿主给的页数（用来触发这个 effect 重跑）
       *
       * ⚠️⚠️ **但必须有上限**（审计发现的**无限 rAF 风险**）：
       * -> 如果宿主给的 \`pageCount\` **永远对不上**（比如数错了）❌
       *   -> 这里会**无限递归 rAF** -> **永远停不下来** ❌
       *   -> 每次 rAF 都重新量所有页 -> **CPU 100%** ❌
       * -> 现在：**最多重试 60 帧（约 1 秒）** -> 之后放弃 ✅
       */
      if (pageCount !== undefined && pages.length !== pageCount && retryCount < MAX_PRINT_RETRIES) {
        requestAnimationFrame(() => {
          applyPageHeights(retryCount + 1);
        });
      }
    };

    applyPageHeights();

    const firstPage = target.querySelector<HTMLElement>('.scpdf-page');
    if (!firstPage || typeof ResizeObserver === 'undefined') {
      return;
    }

    /*
     * ⚠️ **页的尺寸变了 → 缩放也要重算**。
     *
     * → 用户改缩放 / 窗口大小变 → 渲染像素变了 → 打印缩放跟着变。
     */
    const observer = new ResizeObserver(() => {
      applyPrintScale();
      applyPageHeights();
    });
    observer.observe(firstPage);

    return () => {
      observer.disconnect();
    };
    // ⚠️ `pageCount` 在依赖里 → 页数变了 → 重新写每页的高度
  }, [
    pageSizePt,
    paper,
    marginTop,
    marginRight,
    marginBottom,
    marginLeft,
    root,
    pageCount,
    orientation,
  ]);

  const print = useCallback(() => {
    const target = root ?? document.querySelector<HTMLElement>('.scpdf-root');
    if (!target) {
      globalThis.print?.();
      return;
    }

    const paperSize = typeof paper === 'string' ? PAPER_SIZES[paper] : paper;
    const fullMargin: PrintMargin = {
      top: marginTop,
      right: marginRight,
      bottom: marginBottom,
      left: marginLeft,
    };

    const pages = target.querySelectorAll<HTMLElement>('.scpdf-page');

    /*
     * ⚠️⚠️ **缩放要按"渲染后的像素尺寸"算**（实测踩过的坑）。
     *
     * ```
     * 屏幕上的页: 1408 × 1821.6 px   ← "适合宽度"的缩放（2.3×）
     * A4 可打印区: 703 × 1032 px
     *
     * 旧做法（物理比例 0.861）: 1213 × 1569 px = 322 × 415 mm
     *   → 远超 A4 → **18 页的 PDF 打印成 36 页**（每页溢出到第二张纸）❌
     *
     * 正确做法: min(703/1408, 1032/1821.6) = 0.499
     *   → 703 × 909 px = 186 × 240 mm → **正好落在 A4 可打印区里** ✅
     */
    const firstPage = pages[0];
    if (firstPage) {
      // ⚠️ 用**内联**的宽高（不受打印 CSS 的 `calc()` 影响）
      const rawWidth = Number.parseFloat(firstPage.style.width);
      const rawHeight = Number.parseFloat(firstPage.style.height);
      const renderedWidth =
        Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : firstPage.offsetWidth;
      const renderedHeight =
        Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : firstPage.offsetHeight;

      const scale = computePrintScaleForRender(
        { width: renderedWidth, height: renderedHeight },
        paperSize,
        fullMargin,
      );
      target.style.setProperty('--scpdf-print-scale', String(scale));
    } else {
      // 还没有页 → 用物理比例兜底
      const fallback = pageSizePt ? computePrintScale(pageSizePt, paperSize, fullMargin) : 1;
      target.style.setProperty('--scpdf-print-scale', String(fallback));
    }

    /*
     * ⚠️ **写每页的宽高**（配合打印 CSS 的 `height/width: calc(...)`）。
     *
     * ⚠️ 所有页的尺寸一样吗？**不一定**（PDF 每页可以不同尺寸）
     *    → 所以要**逐页写**（写在页元素上）。
     */
    for (const pageEl of pages) {
      // ⚠️ 用**内联**的宽高（不受打印 CSS 的 `calc()` 影响）
      const rawHeight = Number.parseFloat(pageEl.style.height);
      const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : pageEl.offsetHeight;
      if (height > 0) {
        pageEl.style.setProperty('--scpdf-print-page-height', `${height}px`);
      }
      const rawWidth = Number.parseFloat(pageEl.style.width);
      const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : pageEl.offsetWidth;
      if (width > 0) {
        pageEl.style.setProperty('--scpdf-print-page-width', `${width}px`);
      }
    }

    setPreparing(true);

    /*
     * ⚠️ **必须等重排完成再打印**。
     *
     * `window.print()` 是**同步阻塞**的 → 浏览器会打印**当前**的布局
     * → 如果缩放刚设上去还没重排 → 印出来的是旧的尺寸。
     *
     * → 用 `requestAnimationFrame` 等两帧（第一帧应用样式，第二帧布局完成）。
     */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPreparing(false);
        globalThis.print?.();

        /*
         * ⚠️⚠️ **不要恢复打印变量**（实测踩过的坑，用户反馈"打印预览效果还是不对"）。
         *
         * ```
         * 旧行为: 打印完 → removeProperty('--scpdf-print-scale')
         *        → 变量没了 → **再按 Ctrl+P 就是坏的**
         * ```
         *
         * → 现在变量由 **effect 一直维护**（见上面）
         * → 打印变量只在 `@media print` 里用 → **屏幕显示不受影响**
         * → 所以**不需要恢复**。
         *
         * ⚠️ 只保留 `onAfterPrint` 的回调（宿主可能要刷新统计等）。
         */
        let restored = false;
        const restore = () => {
          if (restored) {
            return;
          }
          restored = true;
          onAfterPrintRef.current?.();
        };

        if (typeof globalThis.addEventListener === 'function') {
          globalThis.addEventListener('afterprint', restore, { once: true });
          // 兜底：有些浏览器不发 afterprint
          setTimeout(restore, 1000);
        } else {
          restore();
        }
      });
    });
  }, [pageSizePt, paper, marginTop, marginRight, marginBottom, marginLeft, root]);

  return { print, preparing };
}
