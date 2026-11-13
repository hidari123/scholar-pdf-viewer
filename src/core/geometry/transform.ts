import type { BboxCoord, NormRect, PdfViewportLike, ViewRect } from '../types';

/**
 * 参考尺寸（wire 格式里 NormRect.width/height 的含义）
 * 比例 = 坐标 / 参考尺寸 ∈ [0,1]
 *
 * 采集时 = 采集瞬间的视口尺寸；渲染时 = 当前视口尺寸
 * → 两者同步缩放 → 同一份 wire 数据在任何缩放下落点相同（wire 兼容的核心）
 */
export interface RefSize {
  width: number;
  height: number;
}

/** 页面信息（PDF 点坐标系，72dpi，原点左下 y 向上） */
export interface PdfPageInfo {
  width: number;
  height: number;
  rotation: number;
}

/**
 * 边界收窄：viewport API 的签名是 number[]（pdf.js 原生类型，保持结构兼容免 cast），
 * 这里统一取出定长数字并校验——非预期长度直接抛错。
 * 为什么不把接口改成 tuple：pdf.js 的 PageViewport 声明的是 Array<number>，
 * 收紧后真实 PageViewport 无法直接赋值（要么 cast、要么加适配层）——边界处收窄一次更划算。
 * 为什么必须校验：NaN 坐标一路流到渲染层的表现是"全画在 0,0"，几乎无法排查。
 */
function toQuad(values: number[]): [number, number, number, number] {
  const [a, b, c, d] = values;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    throw new Error(`坐标换算：期望 4 个数字，实际 ${values.length} 个`);
  }
  return [a, b, c, d];
}

/** 同 toQuad：取 2 个数字并校验 */
function toPair(values: number[]): [number, number] {
  const [a, b] = values;
  if (a === undefined || b === undefined) {
    throw new Error(`坐标换算：期望 2 个数字，实际 ${values.length} 个`);
  }
  return [a, b];
}

/**
 * 视口 px → wire 归一化
 * 语义严格对齐主项目 viewportToScaled：x1=left, y1=top, x2=left+width, y2=top+height
 */
export function viewToNorm(rect: ViewRect, ref: RefSize): NormRect {
  return {
    x1: rect.left,
    y1: rect.top,
    x2: rect.left + rect.width,
    y2: rect.top + rect.height,
    width: ref.width,
    height: ref.height,
    pageNumber: rect.pageNumber,
  };
}

/**
 * wire 归一化 → 视口 px
 * 语义严格对齐主项目 scaledToViewport：按 当前视口尺寸 / 采集时视口尺寸 线性映射
 */
export function normToView(norm: NormRect, viewport: RefSize): ViewRect {
  const x1 = (viewport.width * norm.x1) / norm.width;
  const y1 = (viewport.height * norm.y1) / norm.height;
  const x2 = (viewport.width * norm.x2) / norm.width;
  const y2 = (viewport.height * norm.y2) / norm.height;

  return {
    left: x1,
    top: y1,
    width: x2 - x1,
    height: y2 - y1,
    pageNumber: norm.pageNumber,
  };
}

/**
 * PDF 点 → 视口 px
 * 优先用 pdf.js PageViewport 的 API（rotation/cropbox/userUnit 由 pdf.js 保证正确）；
 * 没有该方法时仅支持 rotation=0 的纯数学回退——旋转页宁可抛错也不给不可信结果
 */
export function pdfToView(
  bbox: BboxCoord,
  viewport: PdfViewportLike,
  page: PdfPageInfo,
  pageNumber: number,
): ViewRect {
  const [bx1, by1, bx2, by2] = bbox;

  if (viewport.convertToViewportRectangle) {
    const [x1, y1, x2, y2] = toQuad(viewport.convertToViewportRectangle([bx1, by1, bx2, by2]));
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y1 - y2),
      pageNumber,
    };
  }

  if (page.rotation !== 0) {
    throw new Error('pdfToView: rotation≠0 需要 viewport.convertToViewportRectangle');
  }

  const { scale } = viewport;
  const xMin = Math.min(bx1, bx2) * scale;
  const yMax = Math.max(by1, by2);

  return {
    left: xMin,
    top: (page.height - yMax) * scale,
    width: Math.abs(bx2 - bx1) * scale,
    height: Math.abs(by2 - by1) * scale,
    pageNumber,
  };
}

/**
 * 视口 px → PDF 点
 * 输出统一规范化为 [minX, minY, maxX, maxY]（PDF 空间 y 向上）
 */
export function viewToPdf(rect: ViewRect, viewport: PdfViewportLike, page: PdfPageInfo): BboxCoord {
  if (viewport.convertToPdfPoint) {
    const [x1, y1] = toPair(viewport.convertToPdfPoint(rect.left, rect.top));
    const [x2, y2] = toPair(
      viewport.convertToPdfPoint(rect.left + rect.width, rect.top + rect.height),
    );
    return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
  }

  if (page.rotation !== 0) {
    throw new Error('viewToPdf: rotation≠0 需要 viewport.convertToPdfPoint');
  }

  const { scale } = viewport;
  const x1 = rect.left / scale;
  const x2 = (rect.left + rect.width) / scale;
  const y1 = page.height - rect.top / scale;
  const y2 = page.height - (rect.top + rect.height) / scale;

  return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
}

/** PDF 点 → wire归一化（组合：PDF 点 → 视口 px → wire） */
export function pdfToNorm(
  bbox: BboxCoord,
  viewport: PdfViewportLike,
  page: PdfPageInfo,
  pageNumber: number,
): NormRect {
  const view = pdfToView(bbox, viewport, page, pageNumber);
  return viewToNorm(view, { width: viewport.width, height: viewport.height });
}

/** wire 归一化 → PDF 点（组合：wire → 视口 px → PDF 点） */
export function normToPdf(norm: NormRect, viewport: PdfViewportLike, page: PdfPageInfo): BboxCoord {
  const view = normToView(norm, { width: viewport.width, height: viewport.height });
  return viewToPdf(view, viewport, page);
}
