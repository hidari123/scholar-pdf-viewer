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

/**
 * **适配宽度时，两边留的空白**（px）。
 *
 * ⚠️ 用户反馈："默认的fitWidth 两边也要留一点空隙的 具体像wps展示的一样"。
 *
 * → 之前只减了 `32`（左右各 16px）-> **几乎贴着边** ❌
 * -> WPS 的样子是**页两侧有明显的留白** ✅
 * -> 现在：左右各留 **`FIT_WIDTH_PADDING`（24px）** ✅
 */
export const FIT_WIDTH_PADDING = 24;

/**
 * **就近把缩放取整到 10% 的倍数**（放大 / 缩小一步）。
 *
 * ⚠️ 用户反馈："缩放那里用户可以自己选择缩放的大小 最大不能超过250%
 * 比如说 fit的时候是237%，那么点击加号或者减号 放大缩小
 * 减号到230加号到240 这里用整十数"。
 *
 * ### 例
 *
 * | 当前 | 放大 | 缩小 |
 * |---|---|---|
 * | 237% | **240%** | **230%** |
 * | 235% | **240%** | **230%** |
 * | 230% | **240%** | **220%** |
 * | 90%  | **100%** | **80%** |
 *
 * → **就近**取整（不是向上/向下）-> 连点两次**不会跳过 10%** ✅
 * → 已经在整十数上 -> 直接**加/减一步** ✅
 *
 * @param current 当前比例（2.37 = 237%）
 * @param direction 1 = 放大，-1 = 缩小
 * @returns 取整后的比例
 */
export function stepScaleByQuantum(current: number, direction: 1 | -1): number {
  if (!Number.isFinite(current) || current <= 0) {
    return current;
  }
  const steps = current / SCALE_QUANTUM;
  const onStep = Math.abs(steps - Math.round(steps)) < 0.001;
  const next = onStep
    ? Math.round(steps) + direction
    : direction > 0
      ? Math.ceil(steps - 0.001)
      : Math.floor(steps + 0.001);
  return next * SCALE_QUANTUM;
}

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
  /**
   * 适配宽度（传入容器宽度与页面宽度 pt）。
   *
   * ⚠️ **传了高度 -> 整页完整可见**（下面不会有滚动条）✅
   */
  fitWidth: (
    containerWidth: number,
    pageWidth: number,
    containerHeight?: number,
    pageHeight?: number,
  ) => void;
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
   * **当前的缩放**（给 wheel 监听用）。
   *
   * ⚠️ wheel 监听是**一次性注册**的（不随 scale 重注册）
   * -> 所以它读到的 `scale` 会**过期** ❌
   * -> 用 ref 存**最新值** -> 每次滚轮都能拿到当前比例 ✅
   */
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

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

  /*
   * ⚠️⚠️ **放大/缩小要"就近取整到 10%"**（用户反馈：
   * "缩放那里用户可以自己选择缩放的大小 最大不能超过250%
   *  比如说 fit的时候是237%，那么点击加号或者减号 放大缩小
   *  减号到230加号到240 这里用整十数"）。
   *
   * → 逻辑抽成了纯函数 \`stepScaleByQuantum\`（**可单测**）✅
   * → 237% 放大 -> **240%** ✅
   * → 237% 缩小 -> **230%** ✅
   */
  const zoomIn = useCallback(() => {
    setScale(stepScaleByQuantum(scale, 1));
  }, [scale, setScale]);

  const zoomOut = useCallback(() => {
    setScale(stepScaleByQuantum(scale, -1));
  }, [scale, setScale]);

  /**
   * 适配宽度：容器宽度 / 页面宽度（pt）。
   *
   * ⚠️ **会设置适配模式 = `'width'`** →
   *    之后容器变窄（比如打开缩略图）→ **自动重新适配**（WPS 式行为）。
   *
   * ⚠️⚠️ **两边要留空隙**（用户反馈：
   * "默认的fitWidth 两边也要留一点空隙的 具体像wps展示的一样"）。
   *
   * -> 之前减 `32`（左右各 16px）-> 页宽还是**比容器宽** ❌
   *   （实测：容器 1384px、页宽 1408px -> **下面出现横向滚动条** ❌
   *    -> 这就是用户说的"fitWidth 的时候下面还会出现滚动条"）
   * -> 现在减 `FIT_WIDTH_PADDING * 2`（左右各 24px）✅
   *   -> 页宽 = 1384 - 48 = 1336px < 容器 -> **没有横向滚动条** ✅
   *   -> 而且**页两边有留白**（WPS 那样）✅
   *
   * ⚠️ **不按高度限制**（实测踩过的坑）：
   *
   * -> 一开始想"也按高度算，取小的那个" -> 页变成 **90%** ❌
   *   -> 竖版页（612×792pt）按宽度算是 218% -> 按高度算只有 99% ❌
   *   -> **取小的** -> 页变得很小 -> **所有依赖坐标的 E2E 全挂** ❌
   * -> 用户要的是"宽度适配 + 两边留白" -> **只按宽度** ✅
   *
   * @param containerWidth 容器可用宽度（px）
   * @param pageWidth 页面宽度（pt，scale=1 时的尺寸）
   * @param containerHeight 容器可用高度（px）—— **保留但不用**
   * @param pageHeight 页面高度（pt，scale=1 时的尺寸）—— **保留但不用**
   */
  const fitWidth = useCallback(
    (
      containerWidth: number,
      pageWidth: number,
      _containerHeight?: number,
      _pageHeight?: number,
    ) => {
      if (containerWidth <= 0 || pageWidth <= 0) {
        return;
      }
      // 左右各留一点空隙（WPS 式）-> 页宽小于容器 -> 没有横向滚动条
      const available = containerWidth - FIT_WIDTH_PADDING * 2;
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
   * ⚠️⚠️ **Ctrl + 滚轮缩放**（审计发现的：注释里写了，**代码里根本没有**）。
   *
   * ### 问题
   *
   * -> 上面 \`setScale\` 的注释写着"用户手动缩放（点 +/-、**Ctrl+滚轮**）" ❌
   * -> 但**全仓库 0 个 wheel 监听** ❌
   *   -> 用户按 Ctrl 滚轮 -> **什么都不会发生** ❌
   *   -> 而这是**所有 PDF 阅读器的标准操作**（Chrome / Edge / WPS / Acrobat 都有）❌
   *
   * ### 现在的做法
   *
   * -> 在容器上监听 \`wheel\` -> **只有按住 Ctrl（或 Cmd）才拦** ✅
   *   -> 不按 Ctrl -> **不拦** -> 页面正常滚动 ✅（不能抢用户的滚动）
   * -> \`preventDefault\` -> **不让浏览器自己缩放页面**（那个是整个网页缩放）✅
   * -> 缩放**就近取整到 10%**（和 +/- 按钮一样）✅
   *
   * ⚠️ **监听用 \`{ passive: false }\`** -> 否则 \`preventDefault\` **不生效** ❌
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      // 只在按住 Ctrl / Cmd 时拦
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      // 拦下浏览器自己的"整页缩放"
      event.preventDefault();
      const direction: 1 | -1 = event.deltaY < 0 ? 1 : -1;
      setScale(stepScaleByQuantum(scaleRef.current, direction));
    };
    // ⚠️ **必须 `passive: false`** -> 否则 `preventDefault()` 被忽略 ❌
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
    };
  }, [containerRef, setScale]);

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
