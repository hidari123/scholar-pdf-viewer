/**
 * search-highlight —— 搜索命中 → 矩形几何。
 *
 * ## 为什么需要这一步
 *
 * `SearchHit` 只有 `{ pageNumber, text, start, length }`（字符偏移），
 * 而高亮层要画的是**矩形**。中间的转换必须自己做。
 *
 * ## 字符偏移 ↔ 文本项 的映射
 *
 * ⚠️⚠️ **不能假设"索引的项"和"渲染的项"是同一批**（实测踩过的坑：高亮定位不准）。
 *
 * ```
 * 索引的项（161 个）: ["—", "--", " ", "上海人工智能实验室", …]
 * 渲染的项（112 个）: ["--", "—", " ", "上海人工智能实验室", …]
 * ```
 *
 * → **边界不同**（pdf.js 的 `getTextContent()` 会按 `fontName`/`height` 合并 item）
 * → 但**拼起来的文本完全一样**
 * → 所以：**按字符位置**在渲染侧找 → 不依赖项的边界 ✅
 *
 * @see `align.ts` 的 `mapOffsetToRenderedByText`
 */

import type { PositionedTextItem } from '../text-layer/layout';
import type { IndexOffset } from './align';
import { convertIndexOffsetToRendered, mapOffsetToRenderedByText } from './align';
import type { SearchHit } from './search';

/** 命中对应的矩形（归一化 0~1，相对页面） */
export interface SearchHitRect {
  /** 左边界（0~1） */
  x: number;
  /** 上边界（0~1） */
  y: number;
  /** 宽度（0~1） */
  width: number;
  /** 高度（0~1） */
  height: number;
}

/**
 * 把字符区间映射到文本项列表（**按顺序累加**）。
 *
 * @param items 该页的文本项
 * @param start 起始字符偏移
 * @param length 字符数
 * @returns 命中的项及其在区间内的相对位置
 */
export function mapRangeToItems(
  items: PositionedTextItem[],
  start: number,
  length: number,
): { item: PositionedTextItem; offsetInItem: number; charsInItem: number }[] {
  return mapRangeToItemsByText(items, start, length);
}

export function mapRangeToItemsByText(
  items: PositionedTextItem[],
  start: number,
  length: number,
  _indexOffsets?: readonly IndexOffset[],
): { item: PositionedTextItem; offsetInItem: number; charsInItem: number }[] {
  /*
   * ⚠️⚠️ **按"渲染项自己的文本"累加**（实测踩过的坑：搜索高亮定位不准）。
   *
   * → 索引的项和渲染的项**边界不同**（pdf.js 按 `fontName`/`height` 合并 item）
   *   实测：索引 161 项 / 渲染 112 项 → 差 49 项
   * → 但**拼起来的文本完全一样** → 所以只要按**字符位置**找就行
   * → 不依赖索引的项边界 → 两边切分不同也不影响 ✅
   */
  const mapped = mapOffsetToRenderedByText(
    items.map((i) => i.text),
    start,
    length,
  );
  const result: { item: PositionedTextItem; offsetInItem: number; charsInItem: number }[] = [];

  for (const { index, offsetInItem, charsInItem } of mapped) {
    const item = items[index];
    if (!item) {
      continue;
    }

    const itemTextLength = item.text.length;

    result.push({
      item,
      offsetInItem: Math.min(itemTextLength, offsetInItem),
      charsInItem: Math.min(itemTextLength - offsetInItem, charsInItem),
    });
  }

  return result;
}

/**
 * 把搜索命中转成归一化矩形。
 *
 * ⚠️ **单位必须一致**：
 * - `items` 里的 left/top/width/fontSize 是**视口 px**（当前缩放下）
 * - 所以分母也必须是**视口 px**，不能用 pt
 *   （用 pt 会让归一化结果差一个缩放倍数 → 高亮框高度离谱）
 *
 * @param hit 命中
 * @param items 该页的文本项（视口 px）
 * @param viewportWidth 视口宽（px，当前缩放）
 * @param viewportHeight 视口高（px，当前缩放）
 * @param indexOffsets **每个渲染项在索引里的字符偏移**
 *   → 不传则按顺序兜底（可能偏）
 * @returns 归一化矩形（0~1）；无法定位时返回空数组
 */
export function hitToRects(
  hit: SearchHit,
  items: PositionedTextItem[],
  viewportWidth: number,
  viewportHeight: number,
  indexOffsets?: readonly IndexOffset[],
  /**
   * **索引的项文本 + 对齐表**（渲染项下标 → 索引项下标）。
   *
   * ⚠️⚠️ **命中偏移是"索引坐标系"的** → 必须先换算成"渲染坐标系"。
   *
   * 实测（真实 PDF，搜 "A2E"）：
   * → 索引里 "A2E" 是**一个**项（3 字）
   * → 渲染侧 "A"、"2"、"E" 是**三个**项
   * → 不换算 → 只框住 "A" → **高亮只有 1 个字符宽** ❌（用户反馈"定位不准"）
   */
  indexContext?: { itemTexts: readonly string[]; alignment: readonly number[] },
): SearchHitRect[] {
  if (viewportWidth <= 0 || viewportHeight <= 0 || items.length === 0) {
    return [];
  }

  /*
   * ⚠️ **先把索引坐标换算成渲染坐标**（实测踩过的坑：高亮只框住一部分）。
   *
   * → 命中偏移是**索引文本**里的位置
   * → 渲染的项边界和索引不同 → 直接用会切错
   */
  let hitStart = hit.start;
  let hitLength = hit.length;

  if (indexContext) {
    const converted = convertIndexOffsetToRendered(
      indexContext.itemTexts,
      items.map((i) => i.text),
      indexContext.alignment,
      hit.start,
      hit.length,
    );
    if (converted) {
      hitStart = converted.start;
      hitLength = converted.length;
    }
  }

  const mapped = mapRangeToItemsByText(items, hitStart, hitLength, indexOffsets);
  const rects: SearchHitRect[] = [];

  for (const { item, offsetInItem, charsInItem } of mapped) {
    const textLength = item.text.length;
    if (textLength === 0) {
      continue;
    }

    /**
     * 部分命中时按比例裁剪宽度。
     *
     * 例：item 是 "Hello World"（11 字），命中 "World"（后 5 字）
     * → 起点 = left + width × (6/11)，宽度 = width × (5/11)
     */
    const startRatio = offsetInItem / textLength;
    const endRatio = (offsetInItem + charsInItem) / textLength;

    const x = (item.left + item.width * startRatio) / viewportWidth;
    const width = (item.width * (endRatio - startRatio)) / viewportWidth;
    const y = item.top / viewportHeight;
    const height = item.fontSize / viewportHeight;

    if (width <= 0 || height <= 0) {
      continue;
    }

    rects.push({ x, y, width, height });
  }

  return rects;
}

/**
 * 批量转换命中（同一页的多个命中）。
 *
 * @param hits 命中列表
 * @param itemsByPage 页码 → 文本项（视口 px）
 * @param viewportSizeByPage 页码 → 视口尺寸（px，当前缩放）
 * @param indexOffsetsByPage 页码 → **每个渲染项的索引偏移**（对齐用）
 * @returns 页码 → 矩形列表
 */
export function hitsToRects(
  hits: SearchHit[],
  itemsByPage: Map<number, PositionedTextItem[]>,
  viewportSizeByPage: Map<number, { width: number; height: number }>,
  indexOffsetsByPage?: Map<number, IndexOffset[]>,
  /** 页码 → 索引项文本 + 对齐表（换算命中偏移用） */
  indexContextByPage?: Map<number, { itemTexts: readonly string[]; alignment: readonly number[] }>,
): Map<number, SearchHitRect[]> {
  const result = new Map<number, SearchHitRect[]>();

  for (const hit of hits) {
    const items = itemsByPage.get(hit.pageNumber);
    const size = viewportSizeByPage.get(hit.pageNumber);
    if (!items || !size) {
      continue;
    }

    const rects = hitToRects(
      hit,
      items,
      size.width,
      size.height,
      indexOffsetsByPage?.get(hit.pageNumber),
      indexContextByPage?.get(hit.pageNumber),
    );

    const existing = result.get(hit.pageNumber);
    if (existing) {
      existing.push(...rects);
    } else {
      result.set(hit.pageNumber, rects);
    }
  }

  return result;
}
