/**
 * **批注（小便签 / 便签纸）**的数据模型与几何计算。
 *
 * ## 用户需求
 *
 * > "第一个是添加批注 具体添加方式和wps的批注一样 也是加一个小便签纸一样的在上面
 * >  hover会展示出来"
 *
 * → 点高亮块 → "添加批注" → 在高亮旁边出现一个**小便签图标**（📝）
 * → **hover** 它 → 弹出**便签内容**
 *
 * ## 为什么单独一个文件
 *
 * - 批注和**高亮**是两种东西：高亮是"底色"，批注是"贴纸"
 * - 坐标体系不同：高亮跟着文字走，批注是**独立的小图标**
 * - 包的边界：包只给**格式 + 渲染 + 事件**，内容由宿主给
 */

/** 批注的最小形状（宿主传进来的） */
export interface AnnotationRecord {
  /** 宿主 id */
  id: string;
  /** 锚定的高亮 id（批注跟着高亮走） */
  highlightId: string;
  /** 便签内容 */
  content: string;
  /**
   * 便签图标的位置（**归一化**，缩放无关）。
   *
   * ⚠️ **不传就用默认位置**（高亮的右上角）。
   */
  position?: {
    /** 相对页宽的比例（0~1） */
    x: number;
    /** 相对页高的比例（0~1） */
    y: number;
  };
  /** 创建时间戳 */
  createdAt?: number;
}

/** 便签图标的默认尺寸（px，屏幕坐标） */
export const STICKY_NOTE_SIZE = 22;

/** 便签图标的默认位置（相对高亮的偏移，px） */
export const STICKY_NOTE_OFFSET = { x: 6, y: -10 };

/**
 * 算便签图标的**页内位置**（px）。
 *
 * @param annotation 批注
 * @param anchor 锚定的高亮在页内的矩形
 * @param pageSize 页的尺寸（px）
 * @returns 页内位置（便签图标的左上角）；没锚点则返回 null
 */
export function stickyNotePosition(
  annotation: AnnotationRecord,
  anchor: { left: number; top: number; width: number; height: number } | null,
  pageSize: { width: number; height: number },
): { left: number; top: number } | null {
  // 宿主指定了位置 → 用它（归一化 → 页内 px）
  if (annotation.position) {
    return {
      left: annotation.position.x * pageSize.width,
      top: annotation.position.y * pageSize.height,
    };
  }

  // 没指定 → 放在高亮的**右上角**（WPS 的做法）
  if (!anchor) {
    return null;
  }

  return {
    left: anchor.left + anchor.width + STICKY_NOTE_OFFSET.x,
    top: anchor.top + STICKY_NOTE_OFFSET.y,
  };
}
