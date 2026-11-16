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
 * 索引里的整页文本是 `items.map(i => i.str).join('')`（见 `search.ts`），
 * 所以：
 * - 字符偏移 → 文本项：逐项累加字符数，找到覆盖该区间的项
 * - 文本项 → 矩形：用该项自己的 left/top/width/fontSize
 *
 * ⚠️ **前提：索引与渲染必须用同一份 items**。
 * 宿主若在搜索与渲染时分别调 `getTextContent()`，两次结果的 items 顺序
 * 可能不同 → 偏移错位 → 高亮跑到别的字上。
 * 所以宿主应**缓存每页的 textContent**，两边共用。
 */

import type { PositionedTextItem } from '../text-layer/layout';
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
 * 把字符区间映射到文本项列表。
 *
 * 与 pdf.js 的 `_convertMatches` 同思路：
 * 逐项累加字符数，找到与 `[start, start+length)` 相交的项。
 *
 * @param items 该页的文本项（**顺序必须与索引时一致**）
 * @param start 起始字符偏移
 * @param length 字符数
 * @returns 命中的项及其在区间内的相对位置
 */
export function mapRangeToItems(
  items: PositionedTextItem[],
  start: number,
  length: number,
): { item: PositionedTextItem; offsetInItem: number; charsInItem: number }[] {
  const result: { item: PositionedTextItem; offsetInItem: number; charsInItem: number }[] = [];

  const rangeStart = start;
  const rangeEnd = start + length;

  let cursor = 0;

  for (const item of items) {
    const itemStart = cursor;
    const itemEnd = cursor + item.text.length;
    cursor = itemEnd;

    // 不相交
    if (itemEnd <= rangeStart || itemStart >= rangeEnd) {
      continue;
    }

    // 相交部分
    const from = Math.max(rangeStart, itemStart);
    const to = Math.min(rangeEnd, itemEnd);

    result.push({
      item,
      offsetInItem: from - itemStart,
      charsInItem: to - from,
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
 * @returns 归一化矩形（0~1）；无法定位时返回空数组
 */
export function hitToRects(
  hit: SearchHit,
  items: PositionedTextItem[],
  viewportWidth: number,
  viewportHeight: number,
): SearchHitRect[] {
  if (viewportWidth <= 0 || viewportHeight <= 0 || items.length === 0) {
    return [];
  }

  const mapped = mapRangeToItems(items, hit.start, hit.length);
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
 * @returns 页码 → 矩形列表
 */
export function hitsToRects(
  hits: SearchHit[],
  itemsByPage: Map<number, PositionedTextItem[]>,
  viewportSizeByPage: Map<number, { width: number; height: number }>,
): Map<number, SearchHitRect[]> {
  const result = new Map<number, SearchHitRect[]>();

  for (const hit of hits) {
    const items = itemsByPage.get(hit.pageNumber);
    const size = viewportSizeByPage.get(hit.pageNumber);
    if (!items || !size) {
      continue;
    }

    const rects = hitToRects(hit, items, size.width, size.height);
    if (rects.length === 0) {
      continue;
    }

    const existing = result.get(hit.pageNumber);
    if (existing) {
      existing.push(...rects);
    } else {
      result.set(hit.pageNumber, rects);
    }
  }

  return result;
}
