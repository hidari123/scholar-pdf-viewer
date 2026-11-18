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
  DEFAULT_PRINT_MARGIN,
  PAPER_SIZES,
  type PaperSize,
  type PrintMargin,
} from '../core/print';

/** usePrint 的参数 */
export interface UsePrintOptions {
  /** 页面的**点**尺寸（72dpi，如 A4 = 595 × 842） */
  pageSizePt?: { width: number; height: number };
  /** 纸张规格（名字或尺寸） */
  paper?: keyof typeof PAPER_SIZES | PaperSize;
  /** 打印边距（mm） */
  margin?: Partial<PrintMargin>;
  /** 目标元素（默认找 `.scpdf-root`） */
  root?: HTMLElement | null;
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
  const { pageSizePt, paper = 'A4', margin, root, onAfterPrint } = options;

  /** 正在准备 */
  const [preparing, setPreparing] = useState(false);

  /** 恢复用的旧值 */
  const restoreRef = useRef<{ scale: string; page: string } | null>(null);

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

    // 算打印缩放（按纸张）
    const scale = pageSizePt ? computePrintScale(pageSizePt, paperSize, fullMargin) : 1;

    // 记住旧值（打印完要恢复）
    restoreRef.current = {
      scale: target.style.getPropertyValue('--scpdf-print-scale'),
      page: target.style.getPropertyValue('--scpdf-print-page-height'),
    };

    target.style.setProperty('--scpdf-print-scale', String(scale));

    /*
     * ⚠️ **写每页的高度**（配合打印 CSS 的 `height: calc(...)`）。
     *
     * 打印时页要：
     * 1. 绝对定位 → 静态流（否则重叠 / 丢页）
     * 2. 按纸张缩放 → 但 `transform: scale()` **不改变布局盒**
     *    → 页在流里仍占**原高度** → 每页后面多一截空白 → **空白页**
     *
     * → 所以要把 `height` 也缩掉 → 需要知道"原高度" → 写进 CSS 变量。
     *
     * ⚠️ 所有页的高度一样吗？**不一定**（PDF 每页可以不同尺寸）
     *    → 所以要**逐页写**（用 `--scpdf-print-page-height` + 页的 index）。
     */
    const pages = target.querySelectorAll<HTMLElement>('.scpdf-page');
    for (const pageEl of pages) {
      const height = pageEl.getBoundingClientRect().height;
      if (height > 0) {
        pageEl.style.setProperty('--scpdf-print-page-height', `${height}px`);
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
         * ⚠️ **恢复只能执行一次**（实测踩过的坑）。
         *
         * 两条恢复路径：`afterprint` 事件 + `setTimeout` 兜底
         * → 谁先触发都行 → **但只能恢复一次**（否则 `onAfterPrint` 会调两次）。
         */
        let restored = false;
        const restore = () => {
          if (restored) {
            return;
          }
          restored = true;

          const saved = restoreRef.current;
          if (saved) {
            if (saved.scale) {
              target.style.setProperty('--scpdf-print-scale', saved.scale);
            } else {
              target.style.removeProperty('--scpdf-print-scale');
            }
            if (saved.page) {
              target.style.setProperty('--scpdf-print-page-height', saved.page);
            } else {
              target.style.removeProperty('--scpdf-print-page-height');
            }
          }
          restoreRef.current = null;

          // 逐页清掉高度变量
          for (const pageEl of pages) {
            pageEl.style.removeProperty('--scpdf-print-page-height');
          }

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
