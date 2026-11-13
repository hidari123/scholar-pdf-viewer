/**
 * useZoom —— 缩放控制 + **锚点保持**。
 *
 * 锚点保持是"缩放不跳动"的关键：缩放前后，视口中心那个**内容点**保持在原地。
 * 公式在 core（纯函数、可单测），这里只负责读滚动位置 + 写回。
 */

import { useCallback, useEffect, useRef } from 'react';
import { anchoredScrollTop } from '../core/store/instance';

/** 缩放范围 */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.5;

/** 缩放步进 */
export const SCALE_STEP = 0.1;

/** useZoom 参数 */
export interface UseZoomOptions {
  /** 滚动容器 */
  containerRef: React.RefObject<HTMLElement | null>;
  /** 当前缩放 */
  scale: number;
  /** 缩放变化（写回 store / 触发渲染） */
  onScaleChange: (scale: number) => void;
  /** 缩放模式 */
  scaleMode?: 'width' | 'fixed';
}

/** useZoom 返回值 */
export interface UseZoomResult {
  /** 放大 */
  zoomIn: () => void;
  /** 缩小 */
  zoomOut: () => void;
  /** 适配宽度（传入容器宽度与页面宽度 pt） */
  fitWidth: (containerWidth: number, pageWidth: number) => void;
  /** 适配页面（传入容器宽高与页面尺寸 pt） */
  fitPage: (
    containerWidth: number,
    containerHeight: number,
    pageWidth: number,
    pageHeight: number,
  ) => void;
  /** 直接设置缩放（保持锚点） */
  setScale: (next: number) => void;
}

/** 夹到缩放范围 */
function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 缩放控制。
 *
 * @param options 参数
 */
export function useZoom(options: UseZoomOptions): UseZoomResult {
  const { containerRef, scale, onScaleChange } = options;

  /** 上一次的缩放（算锚点用） */
  const prevScaleRef = useRef(scale);

  useEffect(() => {
    prevScaleRef.current = scale;
  }, [scale]);

  /** 设置缩放并保持锚点 */
  const setScale = useCallback(
    (next: number) => {
      const clamped = clampScale(next);
      const container = containerRef.current;

      if (!container) {
        onScaleChange(clamped);
        return;
      }

      const scrollTop = container.scrollTop;
      const anchorY = container.clientHeight / 2;
      const prevScale = prevScaleRef.current;

      if (prevScale > 0 && prevScale !== clamped) {
        const nextScrollTop = anchoredScrollTop(scrollTop, anchorY, prevScale, clamped);
        // 先改缩放（触发重排），再写回滚动位置
        onScaleChange(clamped);
        // 等重排后再设置滚动位置
        requestAnimationFrame(() => {
          container.scrollTop = nextScrollTop;
        });
      } else {
        onScaleChange(clamped);
      }
    },
    [containerRef, onScaleChange],
  );

  const zoomIn = useCallback(() => {
    setScale(scale + SCALE_STEP);
  }, [scale, setScale]);

  const zoomOut = useCallback(() => {
    setScale(scale - SCALE_STEP);
  }, [scale, setScale]);

  /**
   * 适配宽度：容器宽度 / 页面宽度（pt）。
   *
   * @param containerWidth 容器可用宽度（px）
   * @param pageWidth 页面宽度（pt，scale=1 时的尺寸）
   */
  const fitWidth = useCallback(
    (containerWidth: number, pageWidth: number) => {
      if (containerWidth <= 0 || pageWidth <= 0) {
        return;
      }
      // 减掉容器内边距（左右各 16px）
      const available = containerWidth - 32;
      setScale(available / pageWidth);
    },
    [setScale],
  );

  /**
   * 适配页面：整页完整可见（宽高都容纳）。
   *
   * @param containerWidth 容器可用宽度（px）
   * @param containerHeight 容器可用高度（px）
   * @param pageWidth 页面宽度（pt）
   * @param pageHeight 页面高度（pt）
   */
  const fitPage = useCallback(
    (containerWidth: number, containerHeight: number, pageWidth: number, pageHeight: number) => {
      if (containerWidth <= 0 || containerHeight <= 0 || pageWidth <= 0 || pageHeight <= 0) {
        return;
      }
      const byWidth = (containerWidth - 32) / pageWidth;
      const byHeight = (containerHeight - 32) / pageHeight;
      setScale(Math.min(byWidth, byHeight));
    },
    [setScale],
  );

  return { zoomIn, zoomOut, fitWidth, fitPage, setScale };
}
