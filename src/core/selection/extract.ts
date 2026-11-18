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
 * 判断一个矩形属于哪一页：**中心点落在该页框内**。
 *
 * 为什么用中心点而不是"完全包含"：跨页的选区矩形会被浏览器切在页边界上，
 * 用"完全包含"会两边都不属于（矩形被丢弃）→ 选区缺页。
 * 中心点判定稳定且 O(1)。
 *
 * ⚠️⚠️ **水平方向必须留容差**（实测踩过的坑）。
 *
 * 页框的 `left` 是**量出来的**（页是 `margin-inline: auto` 居中的），
 * 面板开合、缩放、容器尺寸变化都会让它变 —— 而测量有 1~2px 的误差。
 *
 * 实测（面板打开）：
 * ```
 * 归页判定: centerX = 681.5 > 0 + 612 → **不属于任何页** ❌
 *           → 选区被丢弃 → 自绘选区层为空
 * ```
 *
 * → 水平允许 **±4px** 容差 → 测量误差不会导致选区丢失。
 * 垂直**不放容差**（页的上下边界是硬的，容差会让跨页的矩形判错页）。
 */
export function pageOfRect(rect: RectInput, pages: PageFrame[]): number | null {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  /** 水平容差（px） */
  const TOLERANCE = 4;

  for (const page of pages) {
    // 垂直：硬边界
    if (centerY < page.top || centerY > page.top + page.height) {
      continue;
    }
    // 水平：带容差
    if (centerX < page.left - TOLERANCE || centerX > page.left + page.width + TOLERANCE) {
      continue;
    }
    return page.pageNumber;
  }

  return null;
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
  for (const rect of rects) {
    const pageNumber = pageOfRect(rect, pages);
    if (pageNumber === null) {
      continue;
    }

    const page = pages.find((p) => p.pageNumber === pageNumber);
    if (!page) {
      continue;
    }

    /*
     * ⚠️ **裁剪成贴合字形**。
     *
     * 浏览器的选区矩形 = **字体的自然行盒**（比文字高 11px、偏上 6px）
     * → 高亮块跟文字对不齐（用户说的"定位不准 / 偏了"）。
     *
     * 裁剪用**该行的基线** + 字形的 ascent/descent。
     */
    let pageRect: ViewRect = {
      left: rect.left - page.left,
      top: rect.top - page.top,
      width: rect.width,
      height: rect.height,
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
