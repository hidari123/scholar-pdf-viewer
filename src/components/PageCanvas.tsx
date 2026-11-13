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

/** 渲染器（pdf.js RenderTask 的最小形状） */
export interface RenderTaskLike {
  /** 取消渲染 */
  cancel(): void;
  /** 渲染完成 */
  promise: Promise<void>;
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
  };
  /** 渲染到 canvas */
  render(params: {
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
      task = page.render({ canvasContext: context, viewport });
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

    return () => {
      task.cancel();
      if (renderTaskRef.current === task) {
        renderTaskRef.current = null;
      }
    };
  }, [page, scale, devicePixelRatio, onRenderError]);

  return <canvas ref={canvasRef} className="scpdf-canvas" role="img" aria-label={ariaLabel} />;
}
