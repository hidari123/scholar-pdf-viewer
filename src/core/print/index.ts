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

/**
 * **打印方向**（用户确认："允许"）。
 *
 * - `portrait` 纵向
 * - `landscape` 横向（**竖版 PDF 旋转 90° 打印**，像 WPS / Word）
 * - `auto` 跟着**用户打印对话框**里的纸张方向走
 */
export type PrintOrientation = 'portrait' | 'landscape' | 'auto';

/**
 * **把纸张按方向摆好**（横向 = 宽高互换）。
 *
 * @param paper 纸张规格
 * @param orientation 方向（`auto` 当成纵向）
 * @returns 摆好的纸张尺寸
 */
export function orientPaper(paper: PaperSize, orientation: PrintOrientation = 'auto'): PaperSize {
  if (orientation === 'landscape') {
    return { width: paper.height, height: paper.width };
  }
  return paper;
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
 * ## ⚠️⚠️ **这里算的是"物理比例"，不是"相对屏幕的缩放"**（实测踩过的坑）。
 *
 * 屏幕上的页是**按窗口缩放**的（"适合宽度"）→ 1408 × 1821.6 px
 * → 而 PDF 的物理尺寸是 216 × 279 mm
 * → 1408px = 373mm —— **比 A4 纸还大**！
 *
 * → 所以打印时必须**按纸张重新算**：
 * ```
 * 可打印区(px) = (纸张mm - 边距mm) × 96/25.4
 * 缩放 = min(可打印区宽px / 屏幕页宽px, 可打印区高px / 屏幕页高px)
 * ```
 *
 * ### ⚠️ 但这个函数拿到的是**点**尺寸，不是**屏幕像素**
 *
 * `pageSizePt` = 612 × 792 pt → 物理上是 216 × 279 mm ✓
 * → 用它算出来的比例（0.861）是**物理比例**
 * → 但把它直接乘到**屏幕像素**（1408）上 → 1213px = 322mm → **还是超出 A4** ❌
 *
 * → **必须同时知道屏幕上的实际像素尺寸** → 见 `computePrintScaleForRender`。
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
 * 算出**渲染后的页面**在纸上应该用的缩放比。
 *
 * ## 为什么需要这个函数（实测踩过的坑，用户反馈"打印预览效果还是不对"）
 *
 * ```
 * 屏幕上的页: 1408 × 1821.6 px  ← "适合宽度"的缩放（2.3×）
 * PDF 物理尺寸: 216 × 279 mm
 * A4 可打印区: 186 × 273 mm = 703 × 1032 px
 * ```
 *
 * → 用 `computePrintScale`（物理比例 0.861）去缩**屏幕像素**
 *   → 1213 × 1569 px = 322 × 415 mm → **远超 A4** ❌
 *   → 实测：**18 页的 PDF 打印成了 36 页**（每页溢出到第二张纸）❌
 *
 * → 正确做法：**直接把屏幕像素缩到可打印区的像素**
 * ```
 * scale = min(703 / 1408, 1032 / 1821.6) = 0.499
 * ```
 * → 缩完 703 × 909 px = 186 × 240 mm → **正好落在 A4 可打印区里**
 *
 * @param renderedSize 屏幕上页的**实际像素**尺寸
 * @param paper 纸张规格（mm）
 * @param margin 打印边距（mm）
 * @returns 缩放比（≤ 1）
 */
export function computePrintScaleForRender(
  renderedSize: { width: number; height: number },
  paper: PaperSize = PAPER_SIZES.A4 as PaperSize,
  margin: PrintMargin = DEFAULT_PRINT_MARGIN,
  orientation: PrintOrientation = 'auto',
): number {
  if (renderedSize.width <= 0 || renderedSize.height <= 0) {
    return 1;
  }

  /*
   * ⚠️ **横向时纸张要宽高互换**（实测踩到的坑，用户反馈：
   * "而且横向打印有很多空白页"）。
   *
   * -> 横向 A4 的可印区是 **297 × 210mm**（不是 210 × 297）
   * -> 不换 -> 按**纵向**的高度算缩放 ❌
   *    -> 缩放太大 ❌ -> 每页占 **2 张纸** ❌
   *    -> 实测：18 页印成 **36 张** ❌
   */
  const oriented = orientPaper(paper, orientation);
  const printableWidthMm = oriented.width - margin.left - margin.right;
  const printableHeightMm = oriented.height - margin.top - margin.bottom;
  if (printableWidthMm <= 0 || printableHeightMm <= 0) {
    return 1;
  }

  // 可打印区（px）
  const printableWidthPx = printableWidthMm * MM_TO_PX;
  const printableHeightPx = printableHeightMm * MM_TO_PX;

  const scale = Math.min(
    printableWidthPx / renderedSize.width,
    printableHeightPx / renderedSize.height,
  );

  // ⚠️ **不要放大超过 1 倍**（打印放大只会让字变大 + 变模糊）
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
