/**
 * PageCanvas —— 单页渲染。
 *
 * 关键点（方案 §7.2）：
 * - **viewport 只读**：绝不手工变异 pdf.js 的 viewport 对象（主项目漂移 bug 的根因）
 * - **renderId 守卫**：缩放/旋转/换文件后，旧渲染回调直接丢弃
 * - **DPR**：canvas 按 devicePixelRatio 渲染（cap 2），高分屏不糊、低端机不爆
 * - **占位先行**：页面先按尺寸占位（滚动条稳定），canvas 后到
 */

import { useEffect, useRef } from 'react';
import { enqueueCanvasRender } from '../core/render/render-queue';

/** 渲染器（pdf.js RenderTask 的最小形状） */
export interface RenderTaskLike {
  /** 取消渲染 */
  cancel(): void;
  /** 渲染完成 */
  promise: Promise<void>;
}

/** 文本内容（pdf.js getTextContent 的最小形状） */
export interface TextContentLike {
  /** 文本项 */
  items: {
    str: string;
    transform: number[];
    width: number;
    height: number;
    fontName?: string;
    hasEOL?: boolean;
  }[];
}

/** 页面代理（pdf.js PDFPageProxy 的最小形状） */
export interface PageProxyLike {
  /** 页码（1-based） */
  pageNumber: number;
  /** 取视口（**只读**，由 pdf.js 算） */
  getViewport(params: { scale: number }): {
    width: number;
    height: number;
    scale: number;
    transform?: number[];
  };
  /** 取文本内容（用于文本层；没实现则不渲染文本层） */
  getTextContent?(): Promise<TextContentLike>;
  /** 取注解（链接等；没实现则不渲染链接层） */
  getAnnotations?(): Promise<
    {
      subtype?: string;
      rect: number[];
      url?: string;
      dest?: string | unknown[] | null;
    }[]
  >;
  /**
   * 渲染到 canvas。
   *
   * 参数同时带 `canvas` 与 `canvasContext`：
   * pdf.js v6 的 RenderParameters 要求 `canvas`（v5 只要 context），
   * 两个都给 → 跨 pdf.js 版本都能用（宿主注入的实现直接转发即可）。
   */
  render(params: {
    canvas?: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number; scale: number };
  }): RenderTaskLike;
}

/** PageCanvas 参数 */
export interface PageCanvasProps {
  /** 页面代理 */
  page: PageProxyLike | null;
  /** 当前缩放 */
  scale: number;
  /** 设备像素比（默认取 window.devicePixelRatio，cap 2） */
  devicePixelRatio?: number;
  /** 渲染失败 */
  onRenderError?: (error: unknown, pageNumber: number) => void;
  /** 无障碍标签 */
  ariaLabel?: string;
}

/**
 * 单页 canvas。
 *
 * @param props 参数
 */
export function PageCanvas(props: PageCanvasProps) {
  const { page, scale, devicePixelRatio, onRenderError, ariaLabel } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  /** 当前渲染任务（用于取消） */
  const renderTaskRef = useRef<RenderTaskLike | null>(null);

  /**
   * renderId：每次渲染自增。
   * 渲染回调回来时对比，不一致说明"这次渲染已经过期"（缩放/换文件了）→ 丢弃。
   */
  const renderIdRef = useRef(0);

  /**
   * ⚠️ **渲染队列的 token**（每次渲染换一个新的 ✅）
   *
   * -> 队列靠它判断"这是不是同一次渲染" ✅
   * -> 同 token 的旧任务会被**新的替换** ✅ -> 缩放时不浪费时间 ✅
   */
  const renderTokenRef = useRef<object>({});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !page) {
      return;
    }

    // 取消上一次未完成的渲染（否则两个渲染会往同一 canvas 画）
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;

    renderIdRef.current += 1;
    const renderId = renderIdRef.current;

    /*
     * ⚠️ **换一个新的 token** ✅
     *
     * -> 队列靠它把"同一次渲染"和"上一次渲染"区分开 ✅
     * -> 新的 token ✅ -> 队列里的旧任务被替换 ✅ -> 不排队画过期的 ✅
     */
    renderTokenRef.current = {};

    /*
     * ⚠️⚠️ **排队渲染**（实测：缩放时 4 页挤在同一帧 ❌ -> 59ms 长任务 ❌）
     *
     * -> 一次只画一页 ✅ -> 每页之间让出一帧 ✅
     * -> 单帧耗时降到 1/4 ✅（~15ms ✅）
     * -> 用户看到"逐页清晰" ✅ 而不是"整体卡住" ✅
     *
     * ⚠️ **尺寸改在队列里改** ✅
     * -> `canvas.width = ...` 会**清空位图** ✅
     * -> 放到队列外面 ❌ -> 4 页同时清空 ❌ -> 同时重画 ❌ -> 还是卡 ❌
     */
    enqueueCanvasRender(renderTokenRef.current, () => {
      // ⚠️ **过期了就别画了** ✅（排队期间又缩放了 ✅）
      if (renderIdRef.current !== renderId) {
        return;
      }

      // viewport 只读使用（绝不手工变异）
      const viewport = page.getViewport({ scale });

      const ratio = Math.min(devicePixelRatio ?? globalThis.devicePixelRatio ?? 1, 2);

      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      // 缩放 context：pdf.js 按 viewport 尺寸绘制，我们按 DPR 放大画布
      context.setTransform?.(ratio, 0, 0, ratio, 0, 0);

      let task: RenderTaskLike;
      try {
        // 同时传 canvas 与 canvasContext：pdf.js v6 需要 canvas，v5 只看 context
        task = page.render({ canvas, canvasContext: context, viewport });
      } catch (error) {
        onRenderError?.(error, page.pageNumber);
        return;
      }

      renderTaskRef.current = task;

      void task.promise
        .then(() => {
          // 过期渲染 → 丢弃（不处理错误）
          if (renderIdRef.current !== renderId) {
            return;
          }
        })
        .catch((error: unknown) => {
          // 取消导致的错误不算失败（用户快速缩放时会大量出现）
          if (renderIdRef.current !== renderId) {
            return;
          }
          onRenderError?.(error, page.pageNumber);
        });
    });

    return () => {
      renderTaskRef.current?.cancel();
      if (renderTaskRef.current) {
        renderTaskRef.current = null;
      }
    };
  }, [page, scale, devicePixelRatio, onRenderError]);

  return <canvas ref={canvasRef} className="scpdf-canvas" role="img" aria-label={ariaLabel} />;
}
