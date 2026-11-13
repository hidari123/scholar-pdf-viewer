/**
 * useVisiblePages —— 虚拟化：决定"哪些页要渲染"。
 *
 * 策略（方案 §7.2）：
 * - `IntersectionObserver`（root = 滚动容器，rootMargin = 3 页高）观察页占位元素
 * - 可见页 + 缓冲页 = 要渲染的页
 * - 缓冲页的作用：提前渲染好，翻页不等待
 *
 * 为什么用 IntersectionObserver 而不是 scroll 事件里算：
 * - IO 在**主线程之外**计算可见性，滚动时不掉帧
 * - 不需要自己维护"哪些元素在视口内"的状态
 */

import { useEffect, useRef, useState } from 'react';

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
}

/** useVisiblePages 返回值 */
export interface UseVisiblePagesResult {
  /** 要渲染的页（1-based，升序） */
  visiblePages: number[];
  /** 当前视口内的页（不含缓冲） */
  viewportPages: number[];
}

/**
 * 计算可见页。
 *
 * @param options 参数
 */
export function useVisiblePages(options: UseVisiblePagesOptions): UseVisiblePagesResult {
  const { containerRef, pageElements, totalPages, bufferPages = 3 } = options;

  const [visiblePages, setVisiblePages] = useState<number[]>([]);
  const [viewportPages, setViewportPages] = useState<number[]>([]);

  /** 上一次的可见页（避免重复 setState） */
  const lastRef = useRef<number[]>([]);

  useEffect(() => {
    if (totalPages <= 0) {
      setVisiblePages([]);
      setViewportPages([]);
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    // 环境不支持 IO（老浏览器 / SSR）→ 退化为"渲染前 N 页"
    if (typeof IntersectionObserver === 'undefined') {
      const fallback = Array.from(
        { length: Math.min(totalPages, bufferPages * 2 + 1) },
        (_, i) => i + 1,
      );
      setViewportPages(fallback);
      setVisiblePages(fallback);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const inViewport = new Set<number>();

        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          const pageNumber = Number(element.dataset.pageNumber);
          if (!Number.isFinite(pageNumber)) {
            continue;
          }
          if (entry.isIntersecting) {
            inViewport.add(pageNumber);
          }
        }

        const viewport = [...inViewport].sort((a, b) => a - b);

        // 缓冲：在可见页前后各扩 bufferPages 页
        const withBuffer = new Set<number>();
        for (const pageNumber of viewport) {
          for (let offset = -bufferPages; offset <= bufferPages; offset += 1) {
            const target = pageNumber + offset;
            if (target >= 1 && target <= totalPages) {
              withBuffer.add(target);
            }
          }
        }

        const next = [...withBuffer].sort((a, b) => a - b);

        // 只在真的变了时才 setState（避免无谓重渲染）
        const changed =
          next.length !== lastRef.current.length ||
          next.some((page, index) => page !== lastRef.current[index]);

        if (changed) {
          lastRef.current = next;
          setVisiblePages(next);
          setViewportPages(viewport);
        }
      },
      {
        root: container,
        // 上下各扩 3 页高 → 提前渲染，滚动到底时下一页已就绪
        rootMargin: `${bufferPages * 100}% 0px`,
        threshold: 0,
      },
    );

    // 观察所有已挂载的页占位元素
    for (const element of pageElements.current.values()) {
      observer.observe(element);
    }

    return () => {
      observer.disconnect();
    };
  }, [containerRef, pageElements, totalPages, bufferPages]);

  return { visiblePages, viewportPages };
}
