/**
 * useTextSelection —— 文本选择 → 几何输出。
 *
 * 流程（对齐 pdf.js 的 `TextLayerBuilder` + v6 `DrawLayer.#selectionChange()`）：
 *   mouseup → window.getSelection()
 *     → 空 / 不在文本层 → 清除
 *     → Range → 收集涉及的页（靠文本层 span 的 data-page-number）
 *     → 每页取 client rects → 中心点归页 → 页内坐标化 → 同行合并
 *     → 输出 SelectionData（视口 px + 归一化）
 *
 * **关键：选区几何必须来自 DOM，不能自己算。**
 * 浏览器知道 fallback 字体的实际排版结果，
 * 我们用 PDF 的原始几何去"猜"浏览器怎么排 —— 一定会有误差。
 * pdf.js 的做法（v6 `DrawLayer`）也是 `range.getClientRects()`，
 * 只是把它归一化到页面的 0~1 坐标。
 *
 * **归页方式**：pdf.js 按**文本层归属**判断（`closest('.textLayer')`），
 * 我们用 span 上的 `data-page-number` —— 一步到位，
 * 不用像老 scholar-club 那样"每个 rect × 每页"双重循环 + 猜。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { PageFrame } from '../core/selection/extract';
import { extractSelection } from '../core/selection/extract';
import type { SelectionData } from '../core/types';

/** 文本层 span 上的页码标记（与 PageCanvas 约定） */
export const PAGE_NUMBER_ATTR = 'data-page-number';

/** 文本层的 class（用于 closest 查找） */
const TEXT_LAYER_CLASS = '.scpdf-text-layer';

/** endOfContent 哨兵的 class */
const END_OF_CONTENT_CLASS = '.scpdf-text-layer__end';

/** useTextSelection 参数 */
export interface UseTextSelectionOptions {
  /** 滚动容器 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 页框列表（用于归页判定） */
  pageFrames: PageFrame[];
  /** 当前缩放（影响合并容差） */
  scale?: number;
  /** 参考尺寸（写入归一化结构） */
  reference: { width: number; height: number };
  /** 选区变化 */
  onSelectionChange?: (selection: SelectionData | null) => void;
}

/** useTextSelection 返回值 */
export interface UseTextSelectionResult {
  /** 清除选区 */
  clearSelection: () => void;
}

/**
 * 文本选择。
 *
 * @param options 参数
 */
export function useTextSelection(options: UseTextSelectionOptions): UseTextSelectionResult {
  const { containerRef, pageFrames, scale = 1, reference, onSelectionChange } = options;

  /** 当前选区 */
  const selectionRef = useRef<SelectionData | null>(null);

  /** 清除选区 */
  const clearSelection = useCallback(() => {
    selectionRef.current = null;
    onSelectionChange?.(null);
  }, [onSelectionChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    /**
     * 从 Range 收集涉及的页码。
     *
     * 用 `intersectsNode` 判断 span 是否被选中 ——
     * 这是"按文本层归属"的思路，不用猜 rect 属于哪一页。
     */
    const collectPages = (range: Range): number[] => {
      const pages = new Set<number>();

      // 遍历 range 内的文本层 span
      const spans = container.querySelectorAll(`[${PAGE_NUMBER_ATTR}]`);
      for (const span of spans) {
        if (range.intersectsNode(span)) {
          const pageNumber = Number(span.getAttribute(PAGE_NUMBER_ATTR));
          if (Number.isFinite(pageNumber)) {
            pages.add(pageNumber);
          }
        }
      }

      return [...pages].sort((a, b) => a - b);
    };

    /** mouseup 处理 */
    const onMouseUp = () => {
      const selection = window.getSelection();

      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        clearSelection();
        return;
      }

      const range = selection.getRangeAt(0);
      const text = selection.toString();

      if (text.trim().length === 0) {
        clearSelection();
        return;
      }

      // 选区必须在文本层内（不是选到了别的 DOM）
      const anchorNode = range.commonAncestorContainer;
      const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
      if (!anchorElement?.closest(TEXT_LAYER_CLASS)) {
        clearSelection();
        return;
      }

      const pages = collectPages(range);
      if (pages.length === 0) {
        clearSelection();
        return;
      }

      /**
       * 取选区的 client rects。
       *
       * ⚠️ **必须用 `range.getClientRects()`，不能自己按 PDF 几何算**：
       * 浏览器知道 fallback 字体的实际排版（字距、kerning、连字），
       * 我们不知道。pdf.js 的 v6 `DrawLayer.#selectionChange()` 也是这么做的。
       *
       * 注意：`getClientRects()` 会返回**每个行盒**一个 rect，
       * 也可能包含**整页**的 rect（宽高都等于页面）——
       * 这种情况要保留（老 scholar-club 用 `width < pageRect.width` 过滤掉了，
       * 导致"选整页时选区丢失"）。
       */
      const rects: { top: number; left: number; width: number; height: number }[] = [];
      for (const clientRect of range.getClientRects()) {
        if (clientRect.width > 0 && clientRect.height > 0) {
          rects.push({
            top: clientRect.top,
            left: clientRect.left,
            width: clientRect.width,
            height: clientRect.height,
          });
        }
      }

      if (rects.length === 0) {
        clearSelection();
        return;
      }

      /**
       * 坐标系统一（⚠️ 这里曾经有个双重扣减的 bug）：
       *
       * - `getClientRects()` 返回的是**视口坐标**（相对浏览器窗口）
       * - `pageFrames` 的 `top` 是**滚动内容坐标**（相对容器内容的原点）
       *
       * 两者要相减，必须先换算到**同一个坐标系**。
       * 这里统一换算到「**容器内容坐标**」（滚动内容坐标系）：
       *
       * ```
       * 容器内容坐标 = 视口坐标 - 容器视口原点 + scrollTop
       * ```
       *
       * ❌ 之前的写法：rect 减了 containerRect.top，frames 也减了 containerRect.top
       *    → containerRect.top 被减了两次 → 页内坐标偏了 containerRect.top
       *    → 实测高亮偏 97px（正好是容器的视口 top）
       */
      const containerRect = container.getBoundingClientRect();

      const toContentCoords = (value: number): number =>
        value - containerRect.top + container.scrollTop;

      const frames: PageFrame[] = pageFrames.map((frame) => ({
        pageNumber: frame.pageNumber,
        // pageFrames 已经是滚动内容坐标，**不用再减 containerRect.top**
        top: frame.top,
        left: frame.left,
        width: frame.width,
        height: frame.height,
      }));

      const result = extractSelection({
        text,
        rects: rects.map((rect) => ({
          top: toContentCoords(rect.top),
          left: rect.left - containerRect.left + container.scrollLeft,
          width: rect.width,
          height: rect.height,
        })),
        pages: frames,
        scale,
        reference,
      });

      if (!result) {
        clearSelection();
        return;
      }

      selectionRef.current = result;
      onSelectionChange?.(result);
    };

    /**
     * selectionchange：把 endOfContent 哨兵挪到选区边界旁边。
     *
     * **为什么需要**（pdf.js 的 `text_layer_builder.js` 也有）：
     * 在 Chrome/Safari 里，用户在**页面空白处**点击或拖动时，
     * 选区会一路扩到文本层的末尾（选出一大片空白）。
     * 把哨兵挪到选区边界旁 → 选区不会越过它。
     */
    const onSelectionChangeEvent = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      const range = selection.getRangeAt(0);
      const anchor = range.startContainer;
      const anchorElement = anchor instanceof Element ? anchor : anchor.parentElement;
      const textLayer = anchorElement?.closest(TEXT_LAYER_CLASS);
      if (!textLayer) {
        return;
      }

      // 找到该文本层的哨兵
      const end = textLayer.querySelector(END_OF_CONTENT_CLASS);
      if (!(end instanceof HTMLElement)) {
        return;
      }

      // 哨兵跟着选区的结束边界走
      const endContainer =
        range.endContainer instanceof Element
          ? range.endContainer
          : range.endContainer.parentElement;
      if (!endContainer) {
        return;
      }

      endContainer.parentElement?.insertBefore(end, endContainer.nextSibling);
    };

    container.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', onSelectionChangeEvent);

    return () => {
      container.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('selectionchange', onSelectionChangeEvent);
    };
  }, [containerRef, pageFrames, scale, reference, onSelectionChange, clearSelection]);

  return { clearSelection };
}
