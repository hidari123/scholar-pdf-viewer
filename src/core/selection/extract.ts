/**
 * 选区几何提取 —— 把浏览器的 DOM Range 变成**包内的中立几何**。
 *
 * 主项目原实现的两个问题（这里修掉）：
 * 1. **归页是 O(矩形数 × 页数) 的双层循环** → 长文档选区卡顿
 *    修法：按"矩形中心点落在哪一页的框内"判定归属，**每页只测自己那一批矩形**
 * 2. 选区结果里混着 DOM 相关的临时量 → 包内只输出几何（文本 + 矩形 + 页码）
 *
 * 依赖：调用方提供"页框"（每页在容器内的位置）。本模块不碰 DOM，只做几何判定。
 */

import { viewToNorm } from '../geometry/transform';
import type { NormPosition, SelectionData, ViewRect } from '../types';
import { boundingRectOf, optimizeClientRects } from './optimize-rects';
import type { BaselinesByPage } from './shape';
import { clipToBaseline } from './shape';

/** 一页在容器坐标系里的位置与尺寸 */
export interface PageFrame {
  pageNumber: number;
  /** 页框顶边（容器坐标） */
  top: number;
  /** 页框左边（容器坐标） */
  left: number;
  width: number;
  height: number;
}

/** 一批矩形（浏览器给的，通常是页内坐标） */
export interface RectInput {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 提取选区所需的输入 */
export interface ExtractSelectionInput {
  /**
   * **只保留这个页码范围内的矩形**（可选）。
   *
   * ⚠️ **跨页选择的关键**（实测踩到的坑）✅
   *
   * -> 浏览器在**自动滚动**后会把 Range **向前扩展到页首** ❌
   *    -> 选区长度 1726 字符（本来只有 ~84）❌
   *    -> 页 1 的**页眉**（"上海人工智能实验室"）也被选中了 ❌
   * -> -> 高亮全落在**第 1 页** ❌
   *    -> 用户反馈："第二页的内容也高亮到了第一页" ✅
   *
   * -> 精确的做法：只保留**起点页 ~ 终点页**的矩形 ✅
   * -> 起点页 = 起点所在的页；终点页 = 终点所在的页 ✅
   */
  pageRange?: { from: number; to: number };
  /** 选中的文本 */
  text: string;
  /** 原始矩形（浏览器 Range 给的） */
  rects: RectInput[];
  /** 所有页框（用于归页判定） */
  pages: PageFrame[];
  /** 当前缩放（用于误差容差） */
  scale?: number;
  /** 采集时的参考尺寸（写入归一化结构；通常是当前视口尺寸） */
  reference: { width: number; height: number };
  /**
   * 每页的**基线表**（用于把选区裁剪成贴合字形）。
   *
   * ⚠️ 不传 → 选区用浏览器给的行盒高度（比文字高 11px、偏上 6px）
   *    → 高亮块跟文字对不齐。
   */
  baselines?: BaselinesByPage;
}

/**
 * 判断一个矩形属于哪一页：**与该页框的"重叠面积"最大**。
 *
 * ## 为什么不用中心点（实测踩过的坑）
 *
 * 用户反馈："如果跨页选择 工具箱框出来的定位不准确 有时候是负的 就是不在页面上
 * …如果下一页选的没那么多，就会出现在最顶部"
 *
 * ### 中心点判定的两个问题
 *
 * ```
 * 第 1 页:  [0 ───────── 592]
 *                  ↑ 中心点在这里
 * 第 2 页:            [608 ───────── 2430]
 * ```
 *
 * ① **跨页的矩形被浏览器切在页边界上** → 中心点可能落在**页间隙**里
 *    → `pageOfRect` 返回 `null` → **矩形被丢弃** → 选区缺头/缺尾
 *
 * ② **矩形比页还高**（跨页时浏览器会给一个贯穿两页的矩形）
 *    → 中心点在第 1 页 → 归给第 1 页
 *    → 但矩形**下半截在第 2 页** → 渲染时**跑到页外面** ❌
 *    → 用户看到的现象："定位不准确 / 是负的 / 不在页面上"
 *
 * ### 修法
 *
 * - **归页**：按**重叠面积最大**（重叠 0 → 不属于任何页 → 丢弃）
 * - **裁剪**：归页后把矩形**裁到该页的范围内** → 不会有部分跑到页外 ✅
 *
 * @param rect 矩形
 * @param pages 页框
 * @returns 页码（不属于任何页则 `null`）
 */
export function pageOfRect(rect: RectInput, pages: PageFrame[]): number | null {
  /** 水平容差（px）—— 页是居中的，测量有 1~2px 误差 */
  const TOLERANCE = 4;

  let bestPage: PageFrame | null = null;
  let bestOverlap = 0;

  for (const page of pages) {
    // 垂直重叠
    const overlapTop = Math.max(rect.top, page.top);
    const overlapBottom = Math.min(rect.top + rect.height, page.top + page.height);
    const overlapHeight = overlapBottom - overlapTop;
    if (overlapHeight <= 0) {
      continue;
    }

    // 水平重叠（带容差）
    const overlapLeft = Math.max(rect.left, page.left - TOLERANCE);
    const overlapRight = Math.min(rect.left + rect.width, page.left + page.width + TOLERANCE);
    const overlapWidth = overlapRight - overlapLeft;
    if (overlapWidth <= 0) {
      continue;
    }

    const overlap = overlapHeight * overlapWidth;
    /*
     * ⚠️ **平局时归后一页**（>= 而不是 >）。
     *
     * → 跨页的矩形正好被页边界平分时，**内容在后面**（用户往后拖）
     * → 归后一页 → 选区的"尾巴"保住了 ✅
     */
    if (overlap >= bestOverlap) {
      bestOverlap = overlap;
      bestPage = page;
    }
  }

  return bestPage?.pageNumber ?? null;
}

/**
 * 把矩形**裁到页的范围内**（防止选区跑到页外）。
 *
 * ⚠️ 用户反馈："跨页选择…有时候是负的 就是不在页面上"
 * → 浏览器给的跨页矩形会**贯穿两页** → 不裁的话，下半截在页外 ❌
 * → 裁到该页范围内 → 几何永远在页内 ✅
 *
 * @param rect 矩形（页内坐标还没减之前）
 * @param page 页框
 * @returns 裁剪后的矩形（页内坐标）
 */
export function clipRectToPage(
  rect: RectInput,
  page: PageFrame,
): { left: number; top: number; width: number; height: number } {
  const top = Math.max(rect.top, page.top);
  const bottom = Math.min(rect.top + rect.height, page.top + page.height);
  const left = Math.max(rect.left, page.left);
  const right = Math.min(rect.left + rect.width, page.left + page.width);

  return {
    left: left - page.left,
    top: top - page.top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * 从浏览器矩形提取选区几何。
 *
 * 流程：原始矩形 → 归页 → 页内坐标化 → 同行合并 → 双空间输出（视口 px + 归一化）
 */
export function extractSelection(input: ExtractSelectionInput): SelectionData | null {
  const { text, rects, pages, scale = 1, reference, baselines } = input;

  if (rects.length === 0 || pages.length === 0) {
    return null;
  }

  // 1) 归页：每个矩形找它的页（中心点判定）
  const byPage = new Map<number, ViewRect[]>();
  const pageRange = input.pageRange;
  for (const rect of rects) {
    const pageNumber = pageOfRect(rect, pages);
    if (pageNumber === null) {
      continue;
    }

    /*
     * ⚠️⚠️ **丢掉【起点页之前】和【终点页之后】的矩形** ✅
     *
     * -> 跨页拖选时浏览器**自动滚动** ❌
     * -> 滚动后 Range 被**向前扩展到页首** ❌
     *    -> 页 1 开头的东西全被选中了 ❌
     * -> -> 只保留**起点页 ~ 终点页** ✅
     *    -> 页 1 的页眉被丢掉 ✅
     *    -> 页 2 的内容保留 ✅
     */
    if (pageRange) {
      if (pageNumber < pageRange.from || pageNumber > pageRange.to) {
        continue;
      }
    }

    const page = pages.find((p) => p.pageNumber === pageNumber);
    if (!page) {
      continue;
    }

    /*
     * ⚠️ **裁到页的范围内**（实测踩过的坑）。
     *
     * 用户反馈："如果跨页选择 工具箱框出来的定位不准确 有时候是负的
     * 就是不在页面上"
     *
     * → 浏览器给的**跨页矩形会贯穿两页**（比如从第 1 页最后一行到第 2 页第一行）
     * → 归给第 1 页的话，下半截在**第 2 页的位置上** → 渲染时跑到页外 ❌
     * → 裁到该页范围内 → 几何**永远在页内** ✅
     */
    const clipped = clipRectToPage(rect, page);

    /*
     * ⚠️ **裁剪成贴合字形**。
     *
     * 浏览器的选区矩形 = **字体的自然行盒**（比文字高 11px、偏上 6px）
     * → 高亮块跟文字对不齐（用户说的"定位不准 / 偏了"）。
     *
     * 裁剪用**该行的基线** + 字形的 ascent/descent。
     */
    let pageRect: ViewRect = {
      left: clipped.left,
      top: clipped.top,
      width: clipped.width,
      height: clipped.height,
      pageNumber,
    };

    const pageBaselines = baselines?.get(pageNumber);
    if (pageBaselines && pageBaselines.length > 0) {
      pageRect = { ...clipToBaseline(pageRect, pageBaselines), pageNumber };
    }

    const group = byPage.get(pageNumber) ?? [];
    group.push(pageRect);
    byPage.set(pageNumber, group);
  }

  if (byPage.size === 0) {
    return null;
  }

  // 2) 每页合并同行矩形（跨页各自合并，不混排）
  const merged: ViewRect[] = [];
  for (const group of byPage.values()) {
    merged.push(...optimizeClientRects(group, scale));
  }

  if (merged.length === 0) {
    return null;
  }

  // 3) 包围盒（跨页时取第一页的包围盒作为锚点）
  const bounding = boundingRectOf(merged);
  if (!bounding) {
    return null;
  }

  // 4) 双空间输出：视口 px（渲染）+ 归一化（持久化）
  const normRects: NormPosition['rects'] = merged.map((rect) => viewToNorm(rect, reference));
  const norm: NormPosition = {
    boundingRect: viewToNorm(bounding, reference),
    rects: normRects,
    pageNumber: bounding.pageNumber,
  };

  const pageNumbers = [...byPage.keys()].sort((a, b) => a - b);

  return {
    text,
    rects: merged,
    norm,
    pages: pageNumbers,
    anchor: { pageNumber: bounding.pageNumber, rect: bounding },
  };
}
