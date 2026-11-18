/**
 * useZoom —— 缩放控制 + **锚点保持**。
 *
 * 锚点保持是"缩放不跳动"的关键：缩放前后，视口**左上角**那个**内容点**保持在原地。
 * 公式在 core（纯函数、可单测），这里只负责读滚动位置 + 写回。
 *
 * **为什么锚点在左上角而不是中心**：
 * - 用户明确要求"第一排文字高度不动"
 * - 左上角锚点 = 滚动位置与内容位置的关系最简单 → 公式最稳
 * - PDF 阅读器惯例（Chrome 内置 PDF 阅读器、macOS 预览）都是左上角锚点
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { anchoredScrollTop } from '../core/store/instance';

/** 缩放范围 */
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 2.5;

/** 缩放步进 */
export const SCALE_STEP = 0.1;

/**
 * 缩放量化步长（10%）。
 *
 * **为什么要量化**：用户看到的是"220%"，如果实际是 2.2205，
 * 工具栏显示与渲染几何会不一致（点一次放大变成 232%，很突兀）。
 * 量化后 **显示值 == 渲染几何 == 页尺寸计算**。
 */
export const SCALE_QUANTUM = 0.1;

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
  /**
   * **当前是不是"适配宽度"模式**（用来决定要不要在容器变宽时自动重适配）。
   *
   * ⚠️ 有了这个，宿主就能实现"WPS 式"的行为：
   * 打开缩略图/目录 → 容器变窄 → **自动重新适配宽度**（页还是完整可见）。
   *
   * - `'width'` → 容器宽度变了要重新适配
   * - `'page'`  → 适配整页（容器尺寸变了也要重算）
   * - `null`    → 用户手动定的比例 → **不动**
   */
  fitMode?: 'width' | 'page' | null;
  /** 缩放模式变了（宿主可据此重算） */
  onFitModeChange?: (mode: 'width' | 'page' | null) => void;
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
  /**
   * **当前是不是"适配宽度"模式**。
   *
   * → 宿主据此决定"容器变窄时要不要自动重适配"。
   */
  fitMode: 'width' | 'page' | null;
}

/** 夹到缩放范围 */
function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * 把缩放量化到 10% 的倍数。
 *
 * 例：2.2205 → 2.2（220%）；1.04 → 1.0（100%）；1.26 → 1.3（130%）
 *
 * @param scale 原始比例
 * @returns 量化后的比例
 */
export function quantizeScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) {
    return scale;
  }
  return Math.round(scale / SCALE_QUANTUM) * SCALE_QUANTUM;
}

/**
 * 缩放控制。
 *
 * @param options 参数
 */
export function useZoom(options: UseZoomOptions): UseZoomResult {
  const { containerRef, scale, onScaleChange, onFitModeChange } = options;

  /** 上一次的缩放（算锚点用） */
  const prevScaleRef = useRef(scale);

  /**
   * **当前的适配模式**。
   *
   * - `'width'` —— 适配宽度（容器变窄 → 自动重适配）
   * - `'page'`  —— 适配整页
   * - `null`    —— 用户手动定的比例（**容器变窄时不覆盖用户的偏好**）
   */
  const fitModeRef = useRef<'width' | 'page' | null>(options.fitMode ?? null);

  useEffect(() => {
    prevScaleRef.current = scale;
  }, [scale]);

  /** 设置适配模式（并通知宿主） */
  const setFitMode = useCallback(
    (mode: 'width' | 'page' | null) => {
      if (fitModeRef.current === mode) {
        return;
      }
      fitModeRef.current = mode;
      onFitModeChange?.(mode);
    },
    [onFitModeChange],
  );

  /**
   * **应用缩放**（保持锚点）—— 内部用，**不碰适配模式**。
   *
   * ⚠️ 为什么要分成两个：
   * - `applyScale` —— 适配宽度 / 适配页面用（模式由调用方设置）
   * - `setScale`   —— 用户手动缩放用（要**清掉**适配模式）
   */
  const applyScale = useCallback(
    (next: number) => {
      // 量化到 10% 的倍数（显示值与渲染几何一致）
      const clamped = clampScale(quantizeScale(next));
      const container = containerRef.current;

      if (!container) {
        onScaleChange(clamped);
        return;
      }

      const scrollTop = container.scrollTop;
      /**
       * 锚点 = 视口**左上角**（anchorY = 0）。
       *
       * 效果：缩放前后，视口左上角那个内容点不动
       *       → "第一排文字高度不动"。
       *
       * 之前用容器高度的一半（中心锚点）→ 顶部内容必然移动。
       */
      const anchorY = 0;
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

  /**
   * **用户手动缩放**（点 +/-、Ctrl+滚轮）→ **退出适配模式**。
   *
   * ⚠️ 用户手动调了比例 → 说明他有偏好
   * → 之后容器变窄（开缩略图）**不该覆盖**他的偏好。
   */
  const setScale = useCallback(
    (next: number) => {
      setFitMode(null);
      applyScale(next);
    },
    [applyScale, setFitMode],
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
   * ⚠️ **会设置适配模式 = `'width'`** →
   *    之后容器变窄（比如打开缩略图）→ **自动重新适配**（WPS 式行为）。
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
      setFitMode('width');
      applyScale(available / pageWidth);
    },
    [applyScale, setFitMode],
  );

  /**
   * 适配页面：整页完整可见（宽高都容纳）。
   *
   * ⚠️ **会设置适配模式 = `'page'`** → 容器尺寸变了也要重算。
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
      setFitMode('page');
      applyScale(Math.min(byWidth, byHeight));
    },
    [applyScale, setFitMode],
  );

  /*
   * ⚠️ **返回值必须稳定**（用 `useMemo` 包起来）。
   *
   * 否则每次渲染都返回**新对象** → 依赖它的 `useEffect` **每次渲染都重跑**
   * → cleanup 把 `ResizeObserver` 拆了重建
   * → `lastWidth` 被重置成**当前**宽度 → **宽度变化永远检测不到**！
   *
   * （实测：打开缩略图 → 容器 1384→1139 → 缩放没变 → 页溢出）
   */
  return useMemo(
    () => ({ zoomIn, zoomOut, fitWidth, fitPage, setScale, fitMode: fitModeRef.current }),
    [zoomIn, zoomOut, fitWidth, fitPage, setScale],
  );
}
