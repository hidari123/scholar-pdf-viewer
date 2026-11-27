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

/*
 * ⚠️ **图标和内容框的间距**（px）
 *
 * -> 之前 26 ❌ -> 翻到左边时框主体离图标太远 ❌
 * -> 现在 18 ✅（用户反馈："大概距离20px或者15px会好一些" ✅）
 */
const DEFAULT_GAP = 18;
const DEFAULT_MARGIN = 8;

/**
 * 算便签内容框的位置（视口坐标）。
 *
 * ## 水平规则
 *
 * 1. 默认贴在图标**右边**（框的左边缘 = 图标右边缘 + gap）
 * 2. 右边放不下（超出视口减安全边距）-> 翻到**左边**
 *    - ⚠️ **两种翻法都试过**（用户反馈了两轮 ✅）
 *    - "中心对齐" -> 框中心离图标中心只有 13px
 *      -> 框有 142px 宽 -> **整个盖住图标** ❌
 *      -> 用户反馈："离得又太近了 已经重叠上去了" ❌
 *    - "边缘对齐" -> 框的右边缘 = 图标左边缘 - gap
 *      -> **不重叠** ✅ -> 但框的主体离图标远 ❌
 *      -> 用户反馈："距离批注按钮太远" ❌
 *    - **现在：边缘对齐 + 把 gap 调小 + 把框做窄** ✅
 *      -> 边缘间距 18px ✅（用户要 15~20 ✅）
 *      -> 框窄了 ✅ -> 主体离图标也近一点 ✅
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

  /*
   * ⚠️ **翻到左边时用"边缘对齐"**（不重叠 ✅）
   *
   * -> 之前试过"中心对齐" ❌
   *    -> 框中心离图标中心只有 13px ❌
   *    -> 框宽 142px ❌ -> **整个盖住图标** ❌
   *    -> 用户反馈："离得又太近了 已经重叠上去了" ❌
   * -> 现在：框的**右边缘** = 图标的**左边缘** - gap ✅
   *    -> **不重叠** ✅
   *    -> 边缘间距就是 gap ✅（18px ✅）
   *    -> 框的主体离图标远一点 ✅ -> 靠"框做窄"补回来 ✅
   */
  const flippedLeft = icon.left - gap - size.width;

  let left: number;
  if (rightLeft + size.width <= vw - margin) {
    left = rightLeft;
  } else if (flippedLeft >= margin) {
    left = flippedLeft;
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
