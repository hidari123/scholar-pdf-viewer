/**
 * useCurrentPage —— 滚动时跟踪当前页 + 跳页。
 *
 * 性能要点（方案 §7.3，修主项目 B4）：
 * - 滚动监听 **rAF 节流**（滚动事件触发频率远高于帧率）
 * - 当前页用**二分查找**（页顶边数组单调）而不是全量遍历
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
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
  scrollToPage: (page: number, options?: { smooth?: boolean; offsetY?: number }) => void;
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

  /** 当前页（供 jump 判定"远距离"用；用 ref 避免闭包过期） */
  const currentPageRef = useRef(1);

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
        currentPageRef.current = page;
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
    (page: number, options: { smooth?: boolean; offsetY?: number } = {}) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const top = pageTops[page - 1];
      if (top === undefined) {
        return;
      }

      /**
       * 平滑 vs 立即：
       * - 相邻几页 → 平滑（能看清滚动过程）
       * - 远距离（> 3 页 或 > 2 屏）→ 立即跳转
       *
       * 为什么远距离不用平滑：
       * 1) 平滑滚动 30000px 要好几秒，中途用户/断言看到的都是中间页
       * 2) 浏览器对超长距离的平滑滚动是**匀速**的（不是按距离自适应）→ 很慢
       * 3) 大文档里跳到第 500 页，用户要的是"立刻到"，不是"看它滚过去"
       */
      const distance = Math.abs(top - container.scrollTop);
      const viewportHeight = container.clientHeight || 1;
      const isFar = Math.abs(page - currentPageRef.current) > 3;
      const isLongDistance = distance > viewportHeight * 2;

      const behavior = options.smooth === false || isFar || isLongDistance ? 'auto' : 'smooth';

      /*
       * ⚠️ **页内偏移**（内部链接跳到"那一行"用）。
       *
       * -> 目标页 == 当前页时 -> dest 里有 **y 坐标**
       *   -> 只跳页顶的话 -> **看不到目标** ❌
       *   -> 用户要求："目标页=当前页 如果定位行数不一样也是要跳转的"
       *
       * -> \`offsetY\` 是**容器内的 px**（正数 = 往下）
       */
      const target = options.offsetY ? top + options.offsetY : top;

      container.scrollTo({ top: target, behavior });
    },
    [containerRef, pageTops],
  );

  /*
   * ⚠️ **返回值必须稳定**（用 `useMemo` 包）。
   *
   * 否则每次渲染都返回**新对象** → 依赖它的 `useCallback` / `useEffect` 每次都变
   * → **effect 每次渲染都重跑** → 观察器被反复重建 → 状态丢失。
   */
  return useMemo(() => ({ scrollToPage }), [scrollToPage]);
}
