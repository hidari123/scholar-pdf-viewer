/**
 * useCurrentPage —— 滚动时跟踪当前页 + 跳页。
 *
 * 性能要点（方案 §7.3，修主项目 B4）：
 * - 滚动监听 **rAF 节流**（滚动事件触发频率远高于帧率）
 * - 当前页用**二分查找**（页顶边数组单调）而不是全量遍历
 */

import { useCallback, useEffect, useRef } from 'react';
import { findCurrentPage } from '../core/store/instance';

/** useCurrentPage 参数 */
export interface UseCurrentPageOptions {
  /** 滚动容器 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 各页顶边（升序，末项为文档总高哨兵） */
  pageTops: number[];
  /** 当前页变化回调 */
  onPageChange?: (page: number) => void;
}

/** useCurrentPage 返回值 */
export interface UseCurrentPageResult {
  /** 跳到指定页 */
  scrollToPage: (page: number, options?: { smooth?: boolean }) => void;
}

/**
 * 当前页跟踪。
 *
 * @param options 参数
 */
export function useCurrentPage(options: UseCurrentPageOptions): UseCurrentPageResult {
  const { containerRef, pageTops, onPageChange } = options;

  /** rAF 节流的滚动句柄 */
  const rafRef = useRef<number | null>(null);

  /** 上一次上报的页（避免重复回调） */
  const lastPageRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    /** 检查当前页 */
    const check = () => {
      rafRef.current = null;
      const page = findCurrentPage(pageTops, container.scrollTop);
      if (page !== lastPageRef.current) {
        lastPageRef.current = page;
        onPageChange?.(page);
      }
    };

    /** 滚动回调（rAF 节流） */
    const onScroll = () => {
      if (rafRef.current !== null) {
        return;
      }
      rafRef.current = requestAnimationFrame(check);
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    check();

    return () => {
      container.removeEventListener('scroll', onScroll);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [containerRef, pageTops, onPageChange]);

  /** 跳页 */
  const scrollToPage = useCallback(
    (page: number, options: { smooth?: boolean } = {}) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const top = pageTops[page - 1];
      if (top === undefined) {
        return;
      }

      container.scrollTo({
        top,
        behavior: options.smooth === false ? 'auto' : 'smooth',
      });
    },
    [containerRef, pageTops],
  );

  return { scrollToPage };
}
