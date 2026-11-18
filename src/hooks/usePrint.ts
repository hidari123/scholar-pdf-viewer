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

import { useCallback, useRef, useState } from 'react';
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

  const print = useCallback(() => {
    const target = root ?? document.querySelector<HTMLElement>('.scpdf-root');
    if (!target) {
      globalThis.print?.();
      return;
    }

    const paperSize = typeof paper === 'string' ? PAPER_SIZES[paper] : paper;
    const fullMargin: PrintMargin = { ...DEFAULT_PRINT_MARGIN, ...margin };

    // 算打印缩放（按纸张）
    const scale = pageSizePt ? computePrintScale(pageSizePt, paperSize, fullMargin) : 1;

    // 记住旧值（打印完要恢复）
    restoreRef.current = {
      scale: target.style.getPropertyValue('--scpdf-print-scale'),
      page: target.style.getPropertyValue('--scpdf-print-page-height'),
    };

    target.style.setProperty('--scpdf-print-scale', String(scale));

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

        // 打印对话框关掉后恢复（用 afterprint 事件更准，但 Safari 不支持）
        const restore = () => {
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
          onAfterPrint?.();
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
  }, [pageSizePt, paper, margin, root, onAfterPrint]);

  return { print, preparing };
}
