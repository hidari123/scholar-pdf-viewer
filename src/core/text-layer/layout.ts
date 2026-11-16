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

/**
 * 排好版的**单个文本项**（一个 span）。
 *
 * 关键：每个片段都带着**自己的** left / top / width / fontSize
 * —— 这些值全部来自 PDF 的原始几何，不是浏览器估算的。
 */
export interface PositionedTextItem {
  /** 文本内容 */
  text: string;
  /** 左边界（px，相对页面） */
  left: number;
  /** 上边界（px，相对页面） */
  top: number;
  /** 宽度（px，来自 PDF 的 item.width） */
  width: number;
  /** 字号（px，来自 PDF 的 item.height） */
  fontSize: number;
  /** 是否为段末 */
  hasEOL: boolean;
}

/** 排好版的文本片段（按行合并的旧形态，仅用于不需要精确位置的场景） */
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
 * 把文本矩阵换算成 CSS 的 left/top/fontSize/width。
 *
 * 推导（PDF 用户空间 y 向上 → CSS y 向下）：
 *   文本矩阵 [a, b, c, d, e, f]：
 *     - (e, f) = 文本基线起点（PDF 空间）
 *
 *   视口矩阵把 PDF 点映射到屏幕 px：
 *     x' = a*x + c*y + e；y' = b*x + d*y + f（PDF.js 的矩阵乘法约定）
 *     视口矩阵的 vb 为**负**（y 轴翻转）
 *
 *   **字号用 item.height（pdf.js 提供的字体高度），不用 transform[3]**：
 *   transform[3] 是字体**渲染矩阵**的垂直分量，包含了字体的 ascent/descent 缩放，
 *   **不等于字号**。实测同一段正文里，transform[3] 会是 4.56，而真实字号是 9.66。
 *
 *   **宽度用 item.width（PDF 里的真实字宽），不让浏览器估算**：
 *   浏览器按系统字体算宽度，与 PDF 内嵌字体不同 → 选区框就会与看到的字错位。
 *
 * @param item 文本项
 * @param viewport 视口
 * @returns 排版后的片段（无法定位时返回 null）
 */
export function positionTextItem(
  item: TextLayerItemLike,
  viewport: TextViewportLike,
): PositionedTextItem | null {
  const transform = item.transform;
  if (!transform || transform.length < 6) {
    return null;
  }

  // 只取需要的分量：(e, f) = 基线起点
  const [, , , , e, f] = transform as [number, number, number, number, number, number];

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
   * 视口缩放（2D 模长）。
   *
   * 注意：视口矩阵的 vb 是**负的**（y 轴翻转），所以必须用 hypot 取模长，
   * 直接乘 vb 会得到负值。
   */
  const viewportScale = Math.hypot(va, vb) || Math.hypot(vc, vd) || 1;

  /** 字号：PDF 的字体高度 × 视口缩放 */
  const fontSize = item.height * viewportScale;

  /** 宽度：PDF 的真实字宽 × 视口缩放 */
  const width = item.width * viewportScale;

  if (!Number.isFinite(fontSize) || fontSize <= 0) {
    return null;
  }

  return {
    text: item.str,
    left: originX,
    // 文本基线在 top + fontSize 处 → top = originY - fontSize
    top: originY - fontSize,
    width: Number.isFinite(width) && width > 0 ? width : 0,
    fontSize,
    hasEOL: item.hasEOL === true,
  };
}

/**
 * 逐 item 排版（**精准定位的核心**）。
 *
 * 为什么不能"按行合并成一个 span"：
 * - PDF 里一行由**多个 item** 组成，每个 item 有**自己的 x 位置和字号**
 *   （实测同一行有 x=72.78 / 96.62 / 112.38，字号 6.78 / 6.78 / 4.56）
 * - 合并成一个 span 后，span 的 left 是第一个 item 的位置，
 *   而浏览器会把它当一串连续的等宽文字渲染 → **选中的框和看到的字对不上**
 * - 所以：**一个 item 一个 span**，每个 span 用自己的几何数据
 *
 * 排序：按屏幕坐标 (top, left) —— 同一行内按 x 递增，行间从上到下。
 * PDF 的 item 顺序不保证按视觉顺序（如页眉、图表标签会乱序）。
 *
 * @param content 文本内容
 * @param viewport 视口
 * @returns 排版后的片段列表（一个 item 一个）
 */
export function layoutTextItems(
  content: TextContentLike,
  viewport: TextViewportLike,
): PositionedTextItem[] {
  const positioned: PositionedTextItem[] = [];

  for (const item of content.items) {
    if (item.str.length === 0) {
      continue;
    }

    const result = positionTextItem(item, viewport);
    if (!result) {
      continue;
    }

    positioned.push(result);
  }

  // 按屏幕坐标排序（同一行的 item 靠 top 分组，组内按 left）
  positioned.sort((a, b) => {
    // 同一行判定：top 差值小于半个字号
    if (Math.abs(a.top - b.top) < Math.max(a.fontSize, b.fontSize) * 0.5) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });

  return positioned;
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
 * 注意：这个形态**不适合做精准定位**（一行内各 item 的 x/字号不同），
 * 保留它只是为了"文本概览"这类不需要精确位置的场景。
 * 文本层渲染请用 `layoutTextItems`。
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
      current = {
        text: positioned.text,
        left: positioned.left,
        top: positioned.top,
        fontSize: positioned.fontSize,
        hasEOL: positioned.hasEOL,
      };
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
