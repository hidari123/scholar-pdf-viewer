/**
 * useTextSelection —— 文本选择 → 几何输出。
 *
 * 流程（方案 §7.4）：
 *   mouseup → window.getSelection()
 *     → 空 / 不在文本层 → 清除
 *     → Range → 收集涉及的页（靠文本层 span 的 data-page-number）
 *     → 每页取 client rects → 中心点归页 → 页内坐标化 → 同行合并
 *     → 输出 SelectionData（视口 px + 归一化）
 *
 * 关键：包**只输出几何**。弹什么窗、存不存、调不调模型，全是宿主的事。
 */

import { useCallback, useEffect, useRef } from 'react';
import type { PageFrame } from '../core/selection/extract';
import { extractSelection } from '../core/selection/extract';
import type { SelectionData } from '../core/types';

/** 文本层 span 上的页码标记（与 PageCanvas 约定） */
export const PAGE_NUMBER_ATTR = 'data-page-number';

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

    /** 从 Range 收集涉及的页码 */
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
      if (!anchorElement?.closest(`[${PAGE_NUMBER_ATTR}]`)) {
        clearSelection();
        return;
      }

      const pages = collectPages(range);
      if (pages.length === 0) {
        clearSelection();
        return;
      }

      // 取每页的 client rects
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

      // 容器坐标 → 页框坐标（页框是容器坐标系）
      const containerRect = container.getBoundingClientRect();
      const frames: PageFrame[] = pageFrames.map((frame) => ({
        pageNumber: frame.pageNumber,
        top: frame.top - containerRect.top,
        left: frame.left - containerRect.left,
        width: frame.width,
        height: frame.height,
      }));

      const result = extractSelection({
        text,
        rects: rects.map((rect) => ({
          top: rect.top - containerRect.top,
          left: rect.left - containerRect.left,
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

    container.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('mouseup', onMouseUp);
    };
  }, [containerRef, pageFrames, scale, reference, onSelectionChange, clearSelection]);

  return { clearSelection };
}
