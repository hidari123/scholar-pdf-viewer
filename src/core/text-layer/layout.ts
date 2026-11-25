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
 *
 * **算法对齐 pdf.js 官方 `TextLayer`**（见 `font-metrics.ts` 的说明）：
 * - 一个 text item 一个 span
 * - 字号 = 复合矩阵的垂直分量模长
 * - top = 基线 − 实测 ascent
 * - scaleX = PDF 宽度 / 浏览器实测宽度（**选区精准的关键**）
 */

import type { IndexOffset } from '../search/align';
import { alignRenderedToIndex } from '../search/align';
import { guessFontFamily, measureAscentRatio, measureTextWidth } from './font-metrics';

export * from './font-metrics';

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
 * 关键：每个片段都带着**自己的** left / top / fontSize / scaleX
 * —— 这些值全部来自 PDF 的原始几何 + 浏览器实测的字体度量。
 */
export interface PositionedTextItem {
  /** 文本内容 */
  text: string;
  /** 左边界（px，相对页面） */
  left: number;
  /** 上边界（px，相对页面） */
  top: number;
  /** 字号（px） */
  fontSize: number;
  /** 字体族（CSS font-family） */
  fontFamily: string;
  /**
   * 横向缩放比（浏览器排版宽度 → PDF 真实宽度）。
   *
   * 1 = 无需缩放；≠1 时用 `transform: scaleX()` 把字形拉伸到 PDF 的宽度。
   * **这是选区精准的关键**：PDF 内嵌字体与浏览器系统字体度量不同，
   * 不补偿的话文字会逐渐偏移，选区框就与看到的字对不上。
   */
  scaleX: number;
  /** PDF 里的真实宽度（px） */
  width: number;
  /**
   * **浏览器排版的实际宽度**（px，未乘 scaleX）。
   *
   * ⚠️⚠️ **搜索高亮定位的关键**（实测踩过的坑）。
   *
   * ### 为什么需要
   *
   * 命中落在项内的某个位置时，要算出"这几个字符有多宽"。
   * → 之前用**字符数比例**：`width × (chars / text.length)`
   * → 但**比例字体**里每个字符宽度**不一样**！
   *
   * 实测（真实 PDF，搜 "agent"）：
   * ```
   * 文本: "An End-to-End Agent Auditing Engine"（32 字）
   * 命中: "Agent"（第 14~18 字）
   *
   * 真实位置:  left=680, width=90
   * 按比例算:  left=677, width=81     ← 窄了 9px ❌
   * ```
   *
   * → 必须**实测**前缀的宽度，不能按字符数猜 ✅
   *
   * → `width / scaleX` = 浏览器排版的实际宽度
   *
   * ⚠️ **可选** → 老的调用方（宿主自造 item）不用改 ✅
   */
  browserWidth?: number;
  /** 旋转角度（rad，0 = 水平） */
  angle: number;
  /** 是否为段末 */
  hasEOL: boolean;
}

/** 字体信息（宿主可选注入；不注入则按 fontName 猜） */
export interface FontInfo {
  /** CSS font-family */
  family: string;
  /** 是否垂直书写 */
  vertical?: boolean;
}

/** 排版选项 */
export interface LayoutOptions {
  /** 字体表（fontName → 字体信息）；宿主注入 */
  fontMap?: Record<string, FontInfo>;
  /** 默认字体族（没有 fontMap 时用它） */
  defaultFontFamily?: string;
  /**
   * **跳过旋转的文字**（默认 true）。
   *
   * ## 为什么（实测踩过的坑）
   *
   * 真实 PDF（arXiv 论文）的页边戳是 `transform: rotate(-90deg)` 的**竖排文字**：
   * ```
   * 拖选正文（x=175~445）→ 浏览器的选区却宽达 1060px！
   * clientRects 里多出：
   *   { l: 1225.9, t: 210.9, w: 9.9, h: 16.9 }   ← 页边戳
   * ```
   * → 旋转文字在 DOM 里**夹在正文中间** → 浏览器的 Range 把它也包进来了
   * → 选区**横跨整页** → 自绘层画出 5 个矩形，其中一个在页的右边缘
   * → 用户看到"选区乱飞"。
   *
   * → **旋转文字不进文本层** → 浏览器根本选不到它 → 选区干净。
   *
   * ⚠️ **代价**：旋转的文字**不能被选中**（正文没问题）。
   *    这是可接受的取舍（旋转文字本来也很难精确选中）。
   */
  skipRotated?: boolean;
  /**
   * **保持 PDF 的原始顺序**（不按屏幕坐标排序）。
   *
   * ⚠️ **搜索高亮必须用这个**（实测踩过的坑：高亮定位不准）。
   *
   * → 搜索索引的文本 = `items.map(i => i.str).join('')`（**PDF 原始顺序**）
   * → 用排序后的项去映射偏移 → **偏移和项对不上** → 高亮跑到别的字上 ❌
   * → 保持原始顺序 → **下标一一对应** ✅
   *
   * ⚠️ 文本层**渲染**不用这个（视觉顺序更重要 → 保持默认的排序）。
   */
  preserveOrder?: boolean;
  /**
   * **按屏幕坐标（y）排序**（默认 false ✅）。
   *
   * ⚠️⚠️ **默认【不排序】** —— 保持 **PDF 原始顺序** ✅（抄 pdf.js ✅）
   *
   * -> 浏览器的选区是**文档顺序**的连续区间 ✅
   * -> -> **DOM 顺序 = 选区顺序** ✅
   * -> -> 如果 DOM 按 y 排序 ✅ -> **左右栏会交替** ✅
   *    -> 实测：排完序后 ✅ **左右栏交替了 87 次** ✅ ❌
   *    -> -> 跨栏拖 ✅ -> 浏览器选的是**"视觉上连续"**的区间 ✅
   *    -> -> 但那**不是文本流顺序** ✅ -> 右栏选了一堆 ❌
   *
   * -> **pdf.js 就是保持 PDF 原始顺序的** ✅
   *    -> PDF 的 item 顺序 ✅ = **文本流顺序** ✅（左栏到底 -> 右栏 ✅）
   *    -> -> 浏览器的 Range 天然就是文本流顺序 ✅
   *    -> -> **跨栏行为天然正确** ✅ ✅
   *
   * ### 实测（真实双栏论文 ✅）
   *
   * - 页 3:  393 项 | 左右切换 27 次 ✅（图表穿插 ✅）
   * - 页 10: 347 项 | 左右切换 3 次  ✅（正文干净的两栏 ✅）
   * - 页 12: 371 项 | 左右切换 3 次  ✅
   */
  sortByPosition?: boolean;
  /**
   * **索引用的项文本**（顺序 = 索引顺序）。
   *
   * ⚠️ **给了它才能算出正确的索引偏移**（实测踩过的坑：高亮定位不准）。
   *
   * → 索引那次 `getTextContent()` 和渲染这次 **item 的边界可能不同**
   *   （pdf.js 按 `fontName`/`height` 合并 item）
   * → 直接累加字符数会错位 → 要靠**内容对齐**（见 `alignRenderedToIndex`）
   */
  indexItemTexts?: readonly string[];
}

/**
 * 判定一个 item 是否是**旋转文字**。
 *
 * ⚠️ 阈值：角度偏离水平超过 **1°** 就算旋转。
 * （真实 PDF 里可能有极小的角度误差。）
 *
 * @param angle 角度（弧度，来自复合矩阵）
 * @returns 是旋转文字则返回 true
 */
export function isRotatedAngle(angle: number): boolean {
  // 归一化到 (-π, π]
  let normalized = angle % (Math.PI * 2);
  if (normalized > Math.PI) {
    normalized -= Math.PI * 2;
  }
  if (normalized <= -Math.PI) {
    normalized += Math.PI * 2;
  }
  return Math.abs(normalized) > Math.PI / 180;
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
 * 把文本矩阵换算成 CSS 的 left/top/fontSize/scaleX。
 *
 * **算法完全对齐 pdf.js 的 `TextLayer.#appendText()` + `#layout()`**
 * （`pdfjs-dist` v6 `build/pdf.mjs:15193-15230` 与 `:15836-15852`）。
 *
 * 推导：
 *   1. **复合矩阵** tx = viewport.transform ∘ item.transform
 *      （pdf.js: `Util.transform(this.#transform, geom.transform)`）
 *   2. **字号** fontHeight = hypot(tx[2], tx[3])（复合矩阵的垂直分量模长）
 *   3. **ascent** fontAscent = fontHeight × 实测的 ascent 比例
 *   4. **位置** left = tx[4]；top = tx[5] − fontAscent
 *      （用 ascent 不用 fontHeight：浏览器的行盒是从基线到 ascent 决定的）
 *   5. **scaleX** = (PDF 真实宽度 × 视口缩放) / 浏览器实测宽度
 *      → 用 `transform: scaleX()` 把字形拉伸到 PDF 的宽度
 *      → **这是选区精准的关键**（PDF 内嵌字体 ≠ 浏览器系统字体）
 *
 * @param item 文本项
 * @param viewport 视口
 * @param options 排版选项（字体表）
 * @returns 排版后的片段（无法定位时返回 null）
 */
export function positionTextItem(
  item: TextLayerItemLike,
  viewport: TextViewportLike,
  options: LayoutOptions = {},
): PositionedTextItem | null {
  const transform = item.transform;
  if (!transform || transform.length < 6) {
    return null;
  }

  const itemTransform = transform as [number, number, number, number, number, number];
  const viewportTransform = viewport.transform as [number, number, number, number, number, number];

  /**
   * 复合矩阵：tx = viewport ∘ item
   *
   * PDF.js 的 `Util.transform(m1, m2)` 约定：
   *   tx[0] = m1[0]*m2[0] + m1[2]*m2[1]
   *   tx[1] = m1[1]*m2[0] + m1[3]*m2[1]
   *   tx[2] = m1[0]*m2[2] + m1[2]*m2[3]
   *   tx[3] = m1[1]*m2[2] + m1[3]*m2[3]
   *   tx[4] = m1[0]*m2[4] + m1[2]*m2[5] + m1[4]
   *   tx[5] = m1[1]*m2[4] + m1[3]*m2[5] + m1[5]
   */
  const [ia, ib, ic, id_, ie, if_] = itemTransform;
  const [va, vb, vc, vd, ve, vf] = viewportTransform;

  const tx: [number, number, number, number, number, number] = [
    va * ia + vc * ib,
    vb * ia + vd * ib,
    va * ic + vc * id_,
    vb * ic + vd * id_,
    va * ie + vc * if_ + ve,
    vb * ie + vd * if_ + vf,
  ];

  /** 旋转角（rad） */
  const angle = Math.atan2(tx[1], tx[0]);

  /** 字体族 */
  const fontInfo = item.fontName ? options.fontMap?.[item.fontName] : undefined;
  const fontFamily =
    fontInfo?.family ?? options.defaultFontFamily ?? guessFontFamily(item.fontName);

  /** 字号：复合矩阵的垂直分量模长（pdf.js: hypot(tx[2], tx[3])） */
  const fontHeight = Math.hypot(tx[2], tx[3]);

  if (!Number.isFinite(fontHeight) || fontHeight <= 0) {
    return null;
  }

  /** ascent（浏览器实测的比例） */
  const fontAscent = fontHeight * measureAscentRatio(fontFamily);

  /** 位置 */
  const left = tx[4];
  const top = tx[5] - fontAscent;

  /** 视口缩放（2D 模长） */
  const viewportScale = Math.hypot(va, vb) || Math.hypot(vc, vd) || 1;

  /** PDF 里的真实宽度（px） */
  const pdfWidth = item.width * viewportScale;

  /**
   * scaleX：把浏览器排出来的宽度拉伸到 PDF 的宽度。
   *
   * 与 pdf.js 一致：
   * - pdf.js: `transform = scaleX(canvasWidth * scale / width)`
   * - 这里 canvasWidth 用 item.width（PDF 里的字宽），scale 是视口缩放
   *
   * **单字符且无变形时不缩放**（pdf.js 的 `shouldScaleText` 判断）：
   * scaleX=1 时没必要；单字符做 scaleX 反而会引入舍入误差。
   */
  let scaleX = 1;
  const shouldScale = item.str.length > 1 || needsScaleForSingleChar(item);

  if (shouldScale && pdfWidth > 0) {
    const browserWidth = measureTextWidth(item.str, fontFamily, fontHeight);
    if (browserWidth > 0) {
      scaleX = pdfWidth / browserWidth;
    }
  }

  return {
    text: item.str,
    left,
    top,
    fontSize: fontHeight,
    fontFamily,
    scaleX,
    width: pdfWidth,
    // 浏览器排版的实际宽度（= pdfWidth / scaleX）
    browserWidth: scaleX > 0 ? pdfWidth / scaleX : pdfWidth,
    angle,
    hasEOL: item.hasEOL === true,
  };
}

/**
 * 单字符是否需要 scaleX（对齐 pdf.js 的 `shouldScaleText` 判断）。
 *
 * pdf.js 的规则：
 * - 多字符 → 要缩放
 * - 单字符 + 非空格 + X/Y 缩放不等且差异 > 1.5 倍 → 要缩放
 *
 * @param item 文本项
 * @returns 是否需要缩放
 */
function needsScaleForSingleChar(item: TextLayerItemLike): boolean {
  if (item.str.length > 1 || item.str === ' ') {
    return false;
  }

  const transform = item.transform;
  if (!transform || transform.length < 4) {
    return false;
  }

  const absScaleX = Math.abs(transform[0] ?? 0);
  const absScaleY = Math.abs(transform[3] ?? 0);
  if (absScaleX === absScaleY) {
    return false;
  }

  const max = Math.max(absScaleX, absScaleY);
  const min = Math.min(absScaleX, absScaleY);
  return min > 0 && max / min > 1.5;
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
 * @param options 排版选项
 * @returns 排版后的片段列表（一个 item 一个）
 */
export function layoutTextItems(
  content: TextContentLike,
  viewport: TextViewportLike,
  options: LayoutOptions = {},
): PositionedTextItem[] {
  const positioned: PositionedTextItem[] = [];
  /** 是否跳过旋转文字（默认 true） */
  const skipRotated = options.skipRotated !== false;

  for (const item of content.items) {
    if (item.str.length === 0) {
      continue;
    }

    const result = positionTextItem(item, viewport, options);
    if (!result) {
      continue;
    }

    /*
     * ⚠️ **跳过旋转文字**（见 `LayoutOptions.skipRotated` 的说明）。
     *
     * → 旋转文字不进文本层 → 浏览器选不到它 → 选区不会横跨整页。
     */
    if (skipRotated && isRotatedAngle(result.angle)) {
      continue;
    }

    positioned.push(result);
  }

  /*
   * ⚠️⚠️⚠️ **默认【保持 PDF 原始顺序】**（抄 pdf.js ✅ 用户反馈的双栏 bug ✅）
   *
   * ## 为什么不能按 y 排序 ✅
   *
   * -> 浏览器的选区是**文档顺序**的连续区间 ✅
   * -> -> **DOM 顺序 = 选区的顺序** ✅
   * -> -> 如果 DOM 按 y 排序 ✅ -> **左右栏会交替** ✅
   *    -> 实测：排完序后 ✅ **左右栏交替了 87 次** ✅ ❌
   *    -> -> 跨栏拖 ✅ -> 浏览器选的是**"视觉上连续"**的区间 ✅
   *    -> -> 但那**不是文本流顺序** ✅ -> 右栏选了一堆 ❌
   *
   * -> **pdf.js 就是保持 PDF 原始顺序的** ✅
   *    -> PDF 的 item 顺序 ✅ = **文本流顺序** ✅（左栏到底 -> 右栏 ✅）
   *    -> -> 浏览器的 Range 天然就是文本流顺序 ✅
   *    -> -> **跨栏行为天然正确** ✅ ✅
   *
   * ## 保留排序能力 ✅
   *
   * -> `options.sortByPosition` ✅ -> 显式开启 ✅
   * -> -> 搜索索引本来就用 `preserveOrder` ✅ ✅
   */
  if (options.preserveOrder || !options.sortByPosition) {
    return positioned;
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
 * 排版文本项 **+ 算出每个项在"搜索索引"里的偏移**。
 *
 * ## 为什么需要（实测踩过的坑：搜索高亮定位不准）
 *
 * ```
 * 渲染的项: 112 个      （跳过空项 / 定位失败 / 旋转文字）
 * 索引的项: 161 个      （只跳过空项）
 * 第一个不同的位置: #74
 *   渲染: "(a) Unified adapter "
 *   索引: "REASONING"            ← 图里的旋转标签
 * ```
 *
 * → 渲染和索引的项**不是同一批** → 从第 74 项开始**下标全错位**
 * → 高亮跑到别的字上 ❌
 *
 * ## 修法
 *
 * **渲染的时候顺便算出"我这一项在索引里的偏移"** ——
 * 因为它遍历的就是**同一份** `content.items`，
 * 累加字符数就能知道索引里的位置。
 *
 * → 搜索侧用这个偏移精确对齐 ✅
 *
 * @param content 文本内容（和索引用的是同一份）
 * @param viewport 视口
 * @param options 选项
 * @returns 排版后的项 + 每个项的索引偏移
 */
export function layoutTextItemsWithIndexOffsets(
  content: TextContentLike,
  viewport: TextViewportLike,
  options: LayoutOptions = {},
): { items: PositionedTextItem[]; indexOffsets: IndexOffset[] } {
  const items: PositionedTextItem[] = [];

  /** 是否跳过旋转文字（默认 true） */
  const skipRotated = options.skipRotated !== false;

  for (const item of content.items) {
    const str = item.str ?? '';

    // 空项 → 不进文本层
    if (str.length === 0) {
      continue;
    }

    const result = positionTextItem(item, viewport, options);
    if (!result) {
      // ⚠️ **定位失败** → 不进文本层
      continue;
    }

    if (skipRotated && isRotatedAngle(result.angle)) {
      // ⚠️ **旋转文字** → 不进文本层
      continue;
    }

    items.push(result);
  }

  /*
   * ⚠️⚠️ **索引偏移要靠"内容对齐"算**（实测踩过的坑：搜索高亮定位不准）。
   *
   * → 不能直接累加字符数：索引那次 `getTextContent()` 和渲染这次
   *   **item 的边界可能不同**（pdf.js 会按 `fontName`/`height` 合并 item）
   * → 实测：索引 161 项（更细）/ 渲染 112 项（更粗）→ 直接累加会错 49 项 ❌
   *
   * → 所以：拿到**索引的项文本**后，用 `alignRenderedToIndex` **按内容对齐**
   * → 再把对齐结果换算成字符偏移
   */
  const indexItemTexts = options.indexItemTexts;
  const indexOffsets: IndexOffset[] = [];

  if (!indexItemTexts || indexItemTexts.length === 0) {
    // 没有索引信息 → 偏移全空（搜索会退回"按顺序"的老行为）
    return { items, indexOffsets: items.map(() => ({ start: -1, length: 0 })) };
  }

  const renderedTexts = items.map((i) => i.text);
  const aligned = alignRenderedToIndex(indexItemTexts, renderedTexts);

  // 索引项的起始偏移
  const indexStarts: number[] = [];
  let cursor = 0;
  for (const text of indexItemTexts) {
    indexStarts.push(cursor);
    cursor += text.length;
  }

  for (let r = 0; r < items.length; r += 1) {
    const index = aligned[r];
    if (index === undefined || index < 0) {
      indexOffsets.push({ start: -1, length: 0 });
      continue;
    }
    const start = indexStarts[index] ?? -1;
    const length = indexItemTexts[index]?.length ?? 0;
    indexOffsets.push({ start, length });
  }

  return { items, indexOffsets };
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
  options: LayoutOptions = {},
): PositionedText[] {
  return groupByLine(content, viewport, options);
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
 * @param options 排版选项
 * @returns 行片段列表
 */
function groupByLine(
  content: TextContentLike,
  viewport: TextViewportLike,
  options: LayoutOptions = {},
): PositionedText[] {
  const lines: PositionedText[] = [];
  let current: PositionedText | null = null;

  for (const item of content.items) {
    if (item.str.length === 0) {
      continue;
    }

    const positioned = positionTextItem(item, viewport, options);
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
