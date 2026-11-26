/**
 * 便签内容框（hover 弹出的浮层）的定位。
 *
 * ## 为什么不能跟着页内坐标走
 *
 * 内容框原来在页内，定位写死 `left: 26px`（图标的右边）。
 * 页边角的便签会把内容框顶出页面，被 `.scpdf-page` 的 `overflow: hidden` 裁掉。
 *
 * 实测（真实 PDF）：
 *
 * ```
 * 便签在页右边   -> 内容框超出页边界 128px  -> 被裁
 * 便签在页右下角 -> 超出 128px 宽 + 71px 高 -> 被裁
 * ```
 *
 * ## 现在的做法
 *
 * 改成 `position: fixed` + 视口坐标，和主题菜单、选区浮层同一套。
 *
 * `position: fixed` 的定位只受 viewport 约束，和 DOM 位置无关
 * —— 只要祖先链上没有 transform / filter / perspective / contain，
 * 浮层就等价于挂在 body 上。包的 CSS 已确保没有这些属性。
 */

/** 输入 */
export interface StickyNoteContentPositionInput {
  /** 便签图标的矩形（视口坐标） */
  icon: { left: number; top: number; width: number; height: number };
  /** 内容框的尺寸（px） */
  size: { width: number; height: number };
  /** 视口尺寸 */
  viewport: { width: number; height: number };
  /** 内容框和图标之间的间距 */
  gap?: number;
  /** 离视口边缘至少留这么多 */
  margin?: number;
}

/** 定位结果（视口坐标） */
export interface StickyNoteContentPosition {
  left: number;
  top: number;
}

const DEFAULT_GAP = 26;
const DEFAULT_MARGIN = 8;

/**
 * 算便签内容框的位置（视口坐标）。
 *
 * ## 水平规则
 *
 * 1. 默认贴在图标**右边**
 * 2. 右边放不下（超出视口减安全边距）-> 翻到**左边**
 * 3. 左右都放不下 -> 贴着视口中间
 *
 * ## 垂直规则
 *
 * 1. 默认和图标**顶部对齐**
 * 2. 下方放不下 -> 翻到**上方**
 * 3. 上下都放不下 -> 视口中间
 *
 * @param input 输入
 * @returns 位置（视口坐标）
 */
export function computeStickyNoteContentPosition(
  input: StickyNoteContentPositionInput,
): StickyNoteContentPosition {
  const { icon, size, viewport } = input;
  const gap = input.gap ?? DEFAULT_GAP;
  const margin = input.margin ?? DEFAULT_MARGIN;

  const vw = viewport.width;
  const vh = viewport.height;

  /*
   * 水平：先试右边，再试左边
   */
  const rightLeft = icon.left + icon.width + gap;
  const leftLeft = icon.left - gap - size.width;

  let left: number;
  if (rightLeft + size.width <= vw - margin) {
    left = rightLeft;
  } else if (leftLeft >= margin) {
    left = leftLeft;
  } else {
    // 两边都放不下 -> 贴着视口中间
    left = Math.max(margin, (vw - size.width) / 2);
  }
  // 最后 clamp
  left = Math.max(margin, Math.min(left, Math.max(margin, vw - size.width - margin)));

  /*
   * 垂直：先试和图标顶部对齐，再试上方
   */
  const belowTop = icon.top;
  const aboveTop = icon.top - size.height;

  let top: number;
  if (belowTop + size.height <= vh - margin) {
    top = belowTop;
  } else if (aboveTop >= margin) {
    top = aboveTop;
  } else {
    top = Math.max(margin, Math.min((vh - size.height) / 2, vh - size.height - margin));
  }
  top = Math.max(margin, Math.min(top, Math.max(margin, vh - size.height - margin)));

  return { left, top };
}
