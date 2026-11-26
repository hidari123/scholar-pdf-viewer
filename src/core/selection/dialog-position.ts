/**
 * 批注弹窗的定位 —— **纯函数**（可单测，无 DOM）。
 *
 * ## 为什么要单独抽出来
 *
 * -> 之前定位逻辑**内嵌在组件里** ❌
 *   -> jsdom **没有布局** -> `getBoundingClientRect()` 返回 **0×0** ❌
 *   -> **没法写单测** ❌
 *   -> 之前只靠 E2E 测 -> 覆盖慢 + 难定位 ❌
 *
 * -> 现在：**抽成纯函数**
 *   -> 输入：锚点 / 尺寸 / 视口
 *   -> 输出：left / top
 *   -> **可以单测**
 *
 * ## 用户反馈（要修的问题）
 *
 * > "如果批注在这一行最右边 打开编辑批注的框过于靠右 已经贴着最右边了 需要往中间来点"
 *
 * -> 之前 \`safeMargin = margin * 2 = 24\` ❌
 *   -> 480px 弹窗 + 24px 右边距 -> **几乎贴着屏幕边** ❌
 */

/** 矩形（视口坐标） */
export interface DialogRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 定位输入 */
export interface DialogPositionInput {
  /** 锚点（批注的位置，视口坐标） */
  anchor: DialogRect;
  /** 弹窗尺寸（实测） */
  size: { width: number; height: number };
  /** 视口尺寸 */
  viewport: { width: number; height: number };
  /** 间距（弹窗与锚点的距离） */
  gap?: number;
  /** 基础边距（离视口边缘至少留这么多） */
  margin?: number;
}

/** 定位结果 */
export interface DialogPosition {
  left: number;
  top: number;
}

const DEFAULT_GAP = 8;
const DEFAULT_MARGIN = 12;

/**
 * **安全边距**（离视口边缘至少留这么多）。
 *
 * ⚠️ **跟视口宽度成比例**（用户要的"往中间来点"）。
 *
 * -> \`max(48, min(96, round(vw * 0.06)))\`
 *   -> 视口 1500px -> **90px**  （480px 弹窗 + 90px 边距 -> 明显往中间）
 *   -> 视口 800px  -> **48px**  （小屏也不会挤没）
 *   -> 视口 3000px -> **96px**  （超宽屏也不会太夸张）
 *
 * @param viewportWidth 视口宽度
 * @returns 安全边距
 */
export function dialogSafeMargin(viewportWidth: number): number {
  return Math.max(48, Math.min(96, Math.round(viewportWidth * 0.06)));
}

/**
 * 计算批注弹窗的位置。
 *
 * ## 水平规则
 *
 * 1. **锚点在右半边** -> 按【**右边缘**】对齐（弹窗向左展开）
 *    -> 之前是**左边缘**对齐 -> 锚点在右边时**必然贴边** ❌
 * 2. **锚点在左半边** -> 按【**左边缘**】对齐
 * 3. 最后 clamp 到**安全区**内（左右各留 \`safeMargin\`）
 *
 * ## 垂直规则
 *
 * 1. 默认贴在锚点**下方**
 * 2. 下面放不下 -> 放**上面**
 * 3. 上下都放不下 -> 居中
 * 4. 最后 clamp 到视口内
 *
 * @param input 输入
 * @returns 位置（视口坐标）
 */
export function computeDialogPosition(input: DialogPositionInput): DialogPosition {
  const { anchor, size, viewport } = input;
  const gap = input.gap ?? DEFAULT_GAP;
  const margin = input.margin ?? DEFAULT_MARGIN;
  const vw = viewport.width;
  const vh = viewport.height;

  // 垂直：默认贴在锚点下方
  let top = anchor.bottom + gap;

  // 下面放不下 -> 放上面
  if (top + size.height > vh - margin) {
    const above = anchor.top - gap - size.height;
    if (above >= margin) {
      top = above;
    } else {
      // 上下都放不下 -> 贴着可视区中间
      top = Math.max(margin, Math.min((vh - size.height) / 2, vh - size.height - margin));
    }
  }

  // 垂直 clamp（保证"保存"按钮在屏幕内）
  if (top + size.height > vh - margin) {
    top = Math.max(margin, vh - size.height - margin);
  }
  if (top < margin) {
    top = margin;
  }

  // 水平
  const safeMargin = dialogSafeMargin(vw);
  const anchorIsOnRight = anchor.right > vw / 2;
  const desiredLeft = anchorIsOnRight ? anchor.right - size.width : anchor.left;

  const minLeft = safeMargin;
  const maxLeft = vw - size.width - safeMargin;
  const left = Math.max(minLeft, Math.min(desiredLeft, Math.max(minLeft, maxLeft)));

  return { left, top };
}
