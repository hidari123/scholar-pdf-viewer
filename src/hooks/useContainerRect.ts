/**
 * **容器矩形**（浮层 clamp 用）。
 *
 * ## 为什么抽出来
 *
 * -> `PdfViewer.tsx` 原来有 **5911 行** ✅ -> 单个函数 5000 行 ✅
 * -> 这段逻辑**自成一体** ✅（量容器的可视区 ✅ -> 监听滚动和尺寸变化 ✅）
 * -> 抽出来 ✅ -> `PdfViewer` 少 62 行 ✅
 *
 * ## ⚠️ **逻辑一个字都没改** ✅
 *
 * -> 只是**搬家** ✅ -> 依赖数组**原样保留** ✅ -> 行为**完全不变** ✅
 */

import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

/** 视口矩形 */
export interface ContainerRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 量容器的可视区（视口坐标）。
 *
 * -> 容器位置会随**滚动 / 缩放 / 尺寸变化**变化 ✅
 * -> 浮层要跟着 clamp ✅ -> 需要重渲染 ✅ -> 用 state 而不是 ref ✅
 *
 * @param containerRef 容器的 ref
 * @param scale 当前缩放（缩放会改变可视区 ✅ -> 重新量 ✅）
 * @returns 容器矩形（还没量到时是 `null` ✅）
 */
export function useContainerRect(
  containerRef: RefObject<HTMLElement | null>,
  scale: number,
): ContainerRect | null {
  /**
   * 浮层的容器矩形（视口坐标）—— PDF 的可视区。
   *
   * 用 state 而不是 ref：容器位置会随滚动/缩放变化，
   * 浮层要跟着 clamp → 需要重渲染。
   */
  const [popoverContainerRect, setPopoverContainerRect] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);

  // 滚动 / 缩放 / 尺寸变化时更新容器矩形；并**隐藏浮层**（位置已失效）
  //
  // biome-ignore lint/correctness/useExhaustiveDependencies: `containerRef` 是稳定的 ref 对象，不能依赖 `containerRef.current`
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    // 依赖 scale：缩放会改变容器可视区 → 重新量
    void scale;

    const update = () => {
      const rect = container.getBoundingClientRect();
      setPopoverContainerRect({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
      });
    };

    update();

    /*
     * ⚠️ **滚动时浮层跟随**（用户明确要求：方案 A）。
     *
     * 旧实现：滚动时 `setPopoverOpen(false)` → 浮层**直接消失**。
     * 实测：滚动 120px 后浮层 `top=null`（是被卸载，不是隐藏）。
     *
     * 现在：浮层自己在 `useLayoutEffect` 里**实时**读 DOM 选区算位置
     *      → 滚动时它会自然地跟着选区走 → 这里**不需要做任何事**。
     *
     * ⚠️ `update` 只更新**容器矩形**（可视区）—— 用于 clamp。
     *    容器矩形在滚动时**不变**（滚动的是内容，不是容器），
     *    所以监听 scroll 是为了应对"容器自身位置变化"的情况。
     */
    container.addEventListener('scroll', update, { passive: true });

    if (typeof ResizeObserver === 'undefined') {
      return () => container.removeEventListener('scroll', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(container);

    return () => {
      container.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [scale]);

  return popoverContainerRect;
}
