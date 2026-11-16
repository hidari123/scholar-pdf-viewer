/**
 * useVisiblePages —— 虚拟化：决定"哪些页要渲染"。
 *
 * **几何法**（不用 IntersectionObserver）：
 * - 原因见 `core/virtualization/visible.ts` 的说明（IO 在缩放后会失效 → 白屏）
 * - 触发时机：scroll（rAF 节流）/ **scale 变化** / resize
 *
 * 缩放后立即重算是修白屏的关键：
 * 缩放改变了所有页的高度与位置，靠 IO 的异步回调会滞后一帧以上，
 * 用户会看到"页面变白 → 又出现"���闪。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PageBox } from '../core/virtualization/visible';
import { computeVisiblePages } from '../core/virtualization/visible';

/** useVisiblePages 参数 */
export interface UseVisiblePagesOptions {
  /** 滚动容器 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 页元素引用表（pageNumber → element） */
  pageElements: React.MutableRefObject<Map<number, HTMLElement>>;
  /** 总页数 */
  totalPages: number;
  /** 缓冲区页数（默认 3） */
  bufferPages?: number;
  /** 当前缩放（缩放后要立刻重算） */
  scale?: number;
}

/** useVisiblePages 返回值 */
export interface UseVisiblePagesResult {
  /** 要渲染的页（1-based，升序） */
  visiblePages: number[];
  /** 当前视口内的页（不含缓冲） */
  viewportPages: number[];
  /** 手动触发重算（缩放 / 尺寸变化后调用） */
  refresh: () => void;
}

/**
 * 计算可见页。
 *
 * @param options 参数
 */
export function useVisiblePages(options: UseVisiblePagesOptions): UseVisiblePagesResult {
  const { containerRef, pageElements, totalPages, bufferPages = 3, scale = 1 } = options;

  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  const [viewportPages, setViewportPages] = useState<number[]>([]);

  /** 上一次的可见页（避免重复 setState） */
  const lastRef = useRef<number[]>([]);

  /** rAF 句柄（scroll 节流） */
  const rafRef = useRef<number | null>(null);

  /**
   * 收集页的占位信息。
   *
   * 用 `offsetTop`（相对定位的偏移）而不是 `getBoundingClientRect()`：
   * - offsetTop 不受滚动影响 → 结果与滚动位置无关（更稳定）
   * - 但它相对的是 offsetParent → 需要保证页容器是 offsetParent
   *
   * 这里用 `getBoundingClientRect` 减去容器矩形，换算成"内容坐标" ——
   * 与滚动位置直接可比，不依赖 offsetParent 的设定。
   */
  const collectPageBoxes = useCallback((): PageBox[] => {
    const container = containerRef.current;
    if (!container) {
      return [];
    }

    const containerRect = container.getBoundingClientRect();
    const boxes: PageBox[] = [];

    for (const [pageNumber, element] of pageElements.current) {
      const rect = element.getBoundingClientRect();
      boxes.push({
        pageNumber,
        // 元素的视口 top - 容器视口 top + scrollTop = 内容坐标
        top: rect.top - containerRect.top + container.scrollTop,
        height: rect.height,
      });
    }

    boxes.sort((a, b) => a.pageNumber - b.pageNumber);
    return boxes;
  }, [containerRef, pageElements]);

  /**
   * 重算可见页。
   */
  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (!container || totalPages <= 0) {
      setVisiblePages([]);
      setViewportPages([]);
      return;
    }

    const boxes = collectPageBoxes();
    if (boxes.length === 0) {
      return;
    }

    const next = computeVisiblePages({
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
      pages: boxes,
      bufferPages,
    });

    // 只在真的变了时才 setState（避免无谓重渲染）
    const changed =
      next.length !== lastRef.current.length ||
      next.some((page, index) => page !== lastRef.current[index]);

    if (changed) {
      lastRef.current = next;
      setVisiblePages(next);
    }

    // 视口页（不含缓冲）
    const viewport = computeVisiblePages({
      scrollTop: container.scrollTop,
      viewportHeight: container.clientHeight,
      pages: boxes,
      bufferPages: 0,
    });
    setViewportPages((prev) =>
      prev.length === viewport.length && prev.every((p, i) => p === viewport[i]) ? prev : viewport,
    );
  }, [containerRef, totalPages, bufferPages, collectPageBoxes]);

  /** 手动触发重算 */
  const refresh = useCallback(() => {
    recompute();
  }, [recompute]);

  // scroll → rAF 节流重算
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onScroll = () => {
      if (rafRef.current !== null) {
        return;
      }
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        recompute();
      });
    };

    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [containerRef, recompute]);

  /**
   * **缩放后立即重算**（修白屏的关键）。
   *
   * 缩放会改变所有页的高度与位置 → 可见页集合变了 → 必须重算。
   * 之前靠 IO 的异步回调，会滞后 → 用户看到白屏。
   */
  useEffect(() => {
    // 缩放后 DOM 还没重排 → 等一帧再算
    const raf = requestAnimationFrame(() => {
      recompute();
    });

    return () => cancelAnimationFrame(raf);
  }, [scale, recompute]);

  // 初次挂载 + 尺寸变化
  useEffect(() => {
    recompute();

    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      recompute();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [recompute]);

  return { visiblePages, viewportPages, refresh };
}
