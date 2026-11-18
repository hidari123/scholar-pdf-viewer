/**
 * 把高亮转成 **PDF 批注（Annot）**的坐标描述。
 *
 * ## 为什么只算坐标，不写文件
 *
 * 写 PDF 需要 pdf.js / pdf-lib 这类库，而它们在**宿主侧**
 * （包的边界：包不依赖 pdf.js，换渲染引擎也不用改包）。
 *
 * → 包提供**纯计算**：高亮 → PDF 坐标的矩形
 * → 宿主拿到后用 pdf-lib / pdf.js 写进 PDF。
 *
 * ## 坐标系
 *
 * PDF 的坐标系：**72dpi，原点在左下、y 向上**。
 * 我们的归一化坐标是**视口 px、原点在左上、y 向下**。
 * → 需要翻转变换。
 */

/** PDF 点坐标 bbox：[x1, y1, x2, y2]（原点在左下、y 向上） */
export type PdfBbox = [number, number, number, number];

/** 一条 PDF 批注 */
export interface PdfAnnot {
  /** 页码（1 起） */
  pageNumber: number;
  /** PDF 点坐标的矩形 */
  rect: PdfBbox;
  /** 批注里的文字 */
  text: string;
  /** 语义色 key（宿主自己映射成 PDF 的 RGB） */
  color: string;
}

/** 归一化矩形的最小形状 */
interface NormRectLike {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 采集时的参考尺寸（宽） */
  width: number;
  /** 采集时的参考尺寸（高） */
  height: number;
  pageNumber: number;
}

/** 归一化位置的最小形状 */
interface NormPositionLike {
  boundingRect: NormRectLike;
  rects: NormRectLike[];
  pageNumber: number;
}

/** 高亮的最小形状 */
interface HighlightLike {
  id: string;
  color: string;
  selectedText: string;
  position: NormPositionLike;
}

/**
 * 把一条高亮转成 PDF 批注。
 *
 * @param highlight 高亮
 * @param pageSizesPt 每页的**点尺寸**（72dpi，如 A4 = 595 × 842）
 * @returns 批注列表（一条高亮可能有多行 → 多个矩形）
 *
 * @example
 * ```ts
 * // 宿主侧
 * const annots = highlightToPdfAnnots(highlight, [{ width: 595, height: 842 }]);
 * for (const a of annots) {
 *   pdfDoc.addAnnot(a.pageNumber, a.rect, a.text);
 * }
 * ```
 */
export function highlightToPdfAnnots(
  highlight: HighlightLike,
  pageSizesPt: readonly { width: number; height: number }[],
): PdfAnnot[] {
  const pageNumber = highlight.position.pageNumber;
  const pageSize = pageSizesPt[pageNumber - 1];
  if (!pageSize || pageSize.width <= 0 || pageSize.height <= 0) {
    return [];
  }

  const result: PdfAnnot[] = [];

  for (const norm of highlight.position.rects) {
    if (norm.width <= 0 || norm.height <= 0) {
      continue;
    }

    /*
     * 归一化坐标（视口 px）→ **PDF 点**。
     *
     * 归一化矩形记录的是"采集时的视口尺寸"（`norm.width` / `norm.height`）
     * → 换算比例 = 当前页面点尺寸 / 采集时的参考尺寸
     * → 和 `NormRect` 的读回逻辑一致（缩放无关）。
     */
    const ratioX = pageSize.width / norm.width;
    const ratioY = pageSize.height / norm.height;

    // 视口 px（原点左上，y 向下）→ PDF 点（原点左下，y 向上）
    const x1 = norm.x1 * ratioX;
    const x2 = norm.x2 * ratioX;
    const top = norm.y1 * ratioY;
    const bottom = norm.y2 * ratioY;

    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const pdfTop = pageSize.height - top;
    const pdfBottom = pageSize.height - bottom;

    /*
     * ⚠️ **PDF 矩形的 y 必须从小到大**（`y1` = 下边，`y2` = 上边）。
     *
     * 翻转后 top 会变成 bottom → 要重新排。
     */
    result.push({
      pageNumber,
      rect: [left, Math.min(pdfTop, pdfBottom), right, Math.max(pdfTop, pdfBottom)],
      text: highlight.selectedText,
      color: highlight.color,
    });
  }

  return result;
}

/**
 * 把一批高亮转成 PDF 批注。
 *
 * @param highlights 高亮列表
 * @param pageSizesPt 每页的点尺寸
 * @returns 所有批注
 */
export function highlightsToPdfAnnots(
  highlights: readonly HighlightLike[],
  pageSizesPt: readonly { width: number; height: number }[],
): PdfAnnot[] {
  const result: PdfAnnot[] = [];
  for (const highlight of highlights) {
    result.push(...highlightToPdfAnnots(highlight, pageSizesPt));
  }
  return result;
}
