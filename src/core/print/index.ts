/**
 * 打印的**尺寸换算**（纯计算，零 DOM 依赖）。
 *
 * ## 为什么需要
 *
 * 屏幕上是"缩放到适合窗口"，打印时是"缩放到适合**纸张**"。
 * → 直接打印的话，页面会按屏幕的缩放比例印 → **要么超出纸张被裁掉，
 *   要么缩得极小**。
 *
 * → 打印前要按**纸张的可打印区域**重新算缩放比。
 */

/** 一张纸的规格（毫米） */
export interface PaperSize {
  /** 纸宽（mm） */
  width: number;
  /** 纸高（mm） */
  height: number;
}

/** 打印边距（mm） */
export interface PrintMargin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** 常用的纸张规格 */
export const PAPER_SIZES: Record<string, PaperSize> = {
  A4: { width: 210, height: 297 },
  A3: { width: 297, height: 420 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** 默认边距（mm）—— 常见打印机的最小边距约 5~10mm */
export const DEFAULT_PRINT_MARGIN: PrintMargin = {
  top: 12,
  right: 12,
  bottom: 12,
  left: 12,
};

/** 毫米 → 像素（96dpi，CSS 的标准像素密度） */
export const MM_TO_PX = 96 / 25.4;

/**
 * 算出打印时应该用的缩放比。
 *
 * @param pageSizePt 页面的**点**尺寸（72dpi，如 A4 = 595 × 842）
 * @param paper 纸张规格（mm）
 * @param margin 打印边距（mm）
 * @returns 缩放比（1 = 原始大小）
 *
 * @example
 * ```ts
 * // A4 纸 + 12mm 边距 → 可打印区 186 × 273 mm
 * const scale = computePrintScale({ width: 595, height: 842 }, PAPER_SIZES.A4);
 * ```
 */
export function computePrintScale(
  pageSizePt: { width: number; height: number },
  paper: PaperSize = PAPER_SIZES.A4 as PaperSize,
  margin: PrintMargin = DEFAULT_PRINT_MARGIN,
): number {
  if (pageSizePt.width <= 0 || pageSizePt.height <= 0) {
    return 1;
  }

  // 可打印区域（mm）
  const printableWidth = paper.width - margin.left - margin.right;
  const printableHeight = paper.height - margin.top - margin.bottom;
  if (printableWidth <= 0 || printableHeight <= 0) {
    return 1;
  }

  // 页面尺寸（mm）：1 点 = 1/72 英寸 = 25.4/72 mm
  const pageWidthMm = (pageSizePt.width * 25.4) / 72;
  const pageHeightMm = (pageSizePt.height * 25.4) / 72;

  // 取"宽高都能放下"的较小比例
  const scale = Math.min(printableWidth / pageWidthMm, printableHeight / pageHeightMm);

  // ⚠️ **不要放大超过 1 倍**：打印时放大只会让字变大 + 变模糊
  return Math.min(1, Number.isFinite(scale) ? scale : 1);
}

/**
 * 算出打印时页面的**像素尺寸**（写进 CSS 变量用）。
 *
 * @param pageSizePt 页面的点尺寸
 * @param paper 纸张规格
 * @param margin 打印边距
 * @returns 宽高（px）
 */
export function computePrintPageSize(
  _pageSizePt: { width: number; height: number },
  paper: PaperSize = PAPER_SIZES.A4 as PaperSize,
  margin: PrintMargin = DEFAULT_PRINT_MARGIN,
): { width: number; height: number } {
  const printableWidthMm = paper.width - margin.left - margin.right;
  const printableHeightMm = paper.height - margin.top - margin.bottom;

  return {
    width: printableWidthMm * MM_TO_PX,
    height: printableHeightMm * MM_TO_PX,
  };
}
