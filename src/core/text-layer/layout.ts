/**
 * 文本层 —— 把 PDF 的文字变成**可选中、可复制、可命中**的 DOM。
 *
 * 为什么需要它（这是整个包最关键的一块）：
 * - canvas 渲染出来的是"像素" → 用户选不中、复制不了、搜不了
 * - 文本层在 canvas 上叠一层透明 DOM（文字位置与 canvas 完全对齐）
 *   → 浏览器原生就能选中/复制，我们只在 mouseup 时读选区几何
 *
 * 与 pdf.js 的分工：
 * - pdf.js 的 `getTextContent()` 给出**文本项**（每个 item 有 str + transform 矩阵）
 * - 我们把每个 item 算成 CSS transform（矩阵 → 平移+缩放），铺成绝对定位的 span
 * - **坐标系**：pdf.js 的文本矩阵是 PDF 用户空间（y 轴向上），CSS 是 y 轴向下
 *   → 必须用 viewport 翻转，否则文字会上下颠倒（这是最容易踩的坑）
 */

/** 文本项（pdf.js TextItem 的最小形状） */
export interface TextLayerItemLike {
  /** 文本内容 */
  str: string;
  /** 文本矩阵 [a, b, c, d, e, f]（PDF 用户空间） */
  transform: number[];
  /** 字宽 */
  width: number;
  /** 字高 */
  height: number;
  /** 字体名 */
  fontName?: string;
  /** 是否以空格结尾（pdf.js 用它判断断词） */
  hasEOL?: boolean;
}

/** 文本内容（pdf.js getTextContent 的最小形状） */
export interface TextContentLike {
  /** 文本项 */
  items: TextLayerItemLike[];
  /** 样式表 */
  styles?: Record<string, unknown>;
}

/** 视口（pdf.js PageViewport 的最小形状） */
export interface TextViewportLike {
  /** 视口宽（px） */
  width: number;
  /** 视口高（px） */
  height: number;
  /** 缩放比 */
  scale: number;
  /** 视口变换矩阵 [a,b,c,d,e,f] */
  transform: number[];
}

/** 排好版的文本片段 */
export interface PositionedText {
  /** 文本 */
  text: string;
  /** CSS left（px） */
  left: number;
  /** CSS top（px） */
  top: number;
  /** 字体大小（px） */
  fontSize: number;
  /** 字体族 */
  fontFamily?: string;
  /** 是否是段末（换行） */
  hasEOL: boolean;
}

/**
 * 把文本矩阵换算成 CSS 的 left/top/fontSize。
 *
 * 推导（PDF 用户空间 y 向上 → CSS y 向下）：
 *   文本矩阵 [a, b, c, d, e, f]：
 *     - 水平缩放 = a
 *     - 垂直缩放 = d（通常为 0）
 *     - 水平倾斜 = b
 *     - 垂直倾斜 = c
 *     - (e, f) = 文本基线起点（PDF 空间）
 *
 *   视口矩阵把 PDF 点映射到屏幕 px：
 *     x' = e_pdf + a_pdf * scale   （y 翻转：y' = height - f_pdf * scale）
 *
 *   字体大小 = |d| * scale（基线到顶部的距离）
 *
 * @param item 文本项
 * @param viewport 视口
 * @returns 排版后的片段（无法定位时返回 null）
 */
export function positionTextItem(
  item: TextLayerItemLike,
  viewport: TextViewportLike,
): PositionedText | null {
  const transform = item.transform;
  if (!transform || transform.length < 6) {
    return null;
  }

  // 只取需要的分量：d = 字号，(e, f) = 基线起点
  const [, , , d, e, f] = transform as [number, number, number, number, number, number];

  // 视口变换：把 PDF 点变成屏幕 px
  const [va, vb, vc, vd, ve, vf] = viewport.transform as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  /**
   * 用视口矩阵变换基线点 (e, f)。
   * x' = a*x + c*y + e；y' = b*x + d*y + f（PDF.js 的矩阵乘法约定）
   */
  const originX = va * e + vc * f + ve;
  const originY = vb * e + vd * f + vf;

  /**
   * 字体大小（屏幕 px）。
   *
   * 推导：
   * - 文本矩阵的垂直分量 d = 字体的字号（PDF 用户空间）
   * - 视口矩阵把它放大 `viewportScale` 倍（= hypot(va, vb)，视口矩阵的 2D 缩放）
   * → 屏幕字号 = |d| × viewportScale
   *
   * 注意：视口矩阵的 vb 是**负的**（y 轴翻转），所以必须用 hypot 取模长，
   * 直接乘 vb 会得到负字号。
   */
  const viewportScale = Math.hypot(va, vb) || Math.hypot(vc, vd) || 1;
  const fontSize = Math.abs(d) * viewportScale;

  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return null;
  }

  return {
    text: item.str,
    left: originX,
    // 文本基线在 top + fontSize 处 → top = originY - fontSize
    top: originY - fontSize,
    fontSize,
    hasEOL: item.hasEOL === true,
  };
}

/**
 * 把文本内容排版成片段列表（每行一个片段）。
 *
 * 为什么按 `hasEOL` 分段而不是每个 item 一个 span：
 * - item 太多（几百页文档每页上千个）→ DOM 节点爆炸
 * - 按行合并后，DOM 节点降到每页几十个，且**选中体验更自然**（整行可选）
 *
 * @param content 文本内容
 * @param viewport 视口
 * @returns 排版后的片段列表
 */
export function layoutTextContent(
  content: TextContentLike,
  viewport: TextViewportLike,
): PositionedText[] {
  return groupByLine(content, viewport);
}

/**
 * 按 `hasEOL` 分组：每行一个片段。
 *
 * @param content 文本内容
 * @param viewport 视口
 * @returns 行片段列表
 */
function groupByLine(content: TextContentLike, viewport: TextViewportLike): PositionedText[] {
  const lines: PositionedText[] = [];
  let current: PositionedText | null = null;

  for (const item of content.items) {
    if (item.str.length === 0) {
      continue;
    }

    const positioned = positionTextItem(item, viewport);
    if (!positioned) {
      continue;
    }

    if (!current) {
      current = positioned;
    } else {
      // 同一行：横向拼接
      current.text += positioned.text;
      if (positioned.fontSize > current.fontSize) {
        current.fontSize = positioned.fontSize;
      }
    }

    // 段末标记 → 收尾，开始新行
    if (item.hasEOL) {
      if (current) {
        lines.push(current);
      }
      current = null;
    }
  }

  // 最后一行（没有 EOL 结尾）
  if (current) {
    lines.push(current);
  }

  return lines;
}

/**
 * 估算文本层总高度（用于容器占位）。
 *
 * @param lines 行片段
 * @returns 高度（px）
 */
export function estimateTextLayerHeight(lines: PositionedText[]): number {
  let max = 0;
  for (const line of lines) {
    const bottom = line.top + line.fontSize;
    if (bottom > max) {
      max = bottom;
    }
  }
  return max;
}
