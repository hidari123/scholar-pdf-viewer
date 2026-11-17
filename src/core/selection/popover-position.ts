/**
 * 选区浮层的定位 —— **纯函数**（可单测，无 DOM）。
 *
 * **为什么自己算，不用 UI 库的 Popover**：
 * 原 scholar-club 用 antd `<Popover>` + `overlayStyle` 覆盖定位，
 * 结果是**绕过了 antd 的定位引擎**（箭头都对不齐），还留下一堆问题：
 * - 坐标系错：`getClientRects()`（视口坐标）+ `window.scrollY` → 当文档坐标用
 * - 不跟随内部滚动：PDF 在内部容器滚，`window.scrollY` 根本不是那个滚动量
 * - 假翻转：永远在下方，"翻转"只是 `popoverY -= 50` 这个魔法数字
 * - 魔法数字：宽度猜 `200`（实际 350-400）、高度猜 `50`（从来没量过）
 *
 * **我们的做法**：
 * - 用 `position: fixed` → 坐标就是**视口坐标** → 不需要任何 scroll 换算
 * - 弹层尺寸**实测**（不猜）
 * - **真翻转**：先试下方，放不下再试上方
 * - clamp 到**容器**的可视区
 */

/** 矩形（视口坐标） */
export interface PopoverRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 定位所需的输入 */
export interface PopoverPositionInput {
  /** 选区矩形（视口坐标） */
  selection: PopoverRect;
  /** 弹层尺寸（实测） */
  toolbar: { width: number; height: number };
  /** 容器矩形（视口坐标）—— PDF 的可视区 */
  container: PopoverRect;
  /**
   * 视口矩形（视口坐标）。
   *
   * ⚠️ **垂直方向要用"视口"，不能用"容器"** ——
   *    容器可能比窗口还高（内部滚动）→ 按容器判定会误判"放不下"→ 浮层乱翻。
   */
  viewport?: PopoverRect;
  /** 间距（浮层与选区的距离） */
  gap?: number;
  /** 容器边距（离容器边缘至少留这么多） */
  margin?: number;
}

/** 定位结果 */
export interface PopoverPosition {
  /** 浮层左上角（视口坐标，配合 position: fixed） */
  top: number;
  left: number;
  /** 浮层在选区的上方还是下方 */
  placement: 'top' | 'bottom';
  /** 箭头（指示器）的 x 坐标（相对浮层左边缘） */
  arrowLeft: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_MARGIN = 8;

/**
 * 计算选区浮层的位置。
 *
 * @param input 输入
 * @returns 位置（视口坐标）
 */
export function computePopoverPosition(input: PopoverPositionInput): PopoverPosition {
  const { selection, toolbar, container } = input;
  const viewport = input.viewport;
  const gap = input.gap ?? DEFAULT_GAP;
  const margin = input.margin ?? DEFAULT_MARGIN;

  // 水平：居中对齐选区
  const selectionCenterX = (selection.left + selection.right) / 2;
  let left = selectionCenterX - toolbar.width / 2;

  // 水平 clamp：不能超出容器
  const minLeft = container.left + margin;
  const maxLeft = container.right - toolbar.width - margin;
  left = Math.max(minLeft, Math.min(left, Math.max(minLeft, maxLeft)));

  // 箭头位置：指向选区中心（相对于浮层左边缘，并 clamp 在浮层内部）
  const arrowLeft = Math.max(8, Math.min(toolbar.width - 8, selectionCenterX - left));

  // 垂直：优先放在下方
  const below = selection.bottom + gap;
  const above = selection.top - gap - toolbar.height;

  /*
   * ⚠️ **垂直边界用"视口"，不是"容器"**。
   *
   * 实测（真实 PDF，缩放后）：
   * ```
   * 容器可视区:  97..908     ← 容器比窗口还高（908 > 视口 900）
   * 选区底部:    880
   * 浮层高度:    38
   * ```
   * 按容器算：下方只剩 908-880 = 28px < 38 → **翻到上方** → top=750
   *          → 浮层跑到选区**上面 130px**，看起来"跑偏了"。
   *
   * 但其实下方在**视口内**是有空间的（视口底 900，浮层到 918 会出屏一点）。
   * → 判定"放得下"应该看**视口**，容器只用来做水平 clamp。
   */
  const viewportBottom = viewport?.bottom ?? container.bottom;
  const viewportTop = viewport?.top ?? container.top;

  let top: number;
  let placement: 'top' | 'bottom';

  if (below + toolbar.height <= viewportBottom - margin) {
    // 下方放得下 → 放下方
    top = below;
    placement = 'bottom';
  } else if (above >= viewportTop + margin) {
    // 下方放不下但上方放得下 → **真的翻转**到上方
    top = above;
    placement = 'top';
  } else {
    // 两边都放不下 → 选空间较大的一边，再 clamp
    const spaceBelow = viewportBottom - margin - selection.bottom;
    const spaceAbove = selection.top - (viewportTop + margin);

    if (spaceAbove > spaceBelow) {
      top = above;
      placement = 'top';
    } else {
      top = below;
      placement = 'bottom';
    }
  }

  // 垂直 clamp（不超出**视口**）
  const minTop = viewportTop + margin;
  const maxTop = viewportBottom - toolbar.height - margin;
  top = Math.max(minTop, Math.min(top, Math.max(minTop, maxTop)));

  return { top, left, placement, arrowLeft };
}
