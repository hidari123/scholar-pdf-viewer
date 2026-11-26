/**
 * **剔除"离群矩形"**
 *
 * ## 要剔除什么
 *
 * | 类型 | 特征 | 为什么 |
 * |---|---|---|
 * | **整页矩形** | `height` 接近页高 | 旋转/裁剪产生的伪矩形 |
 * | **旋转文字** | `height` 远超一行 | 竖排页边戳（`rotate(-90deg)`）|
 * | **页边戳** | 水平方向离正文很远 | 竖排在页边的 arXiv 水印 |
 *
 * ## ⚠️ **为什么这些不能靠"按 y 分行"解决**
 *
 * -> 旧实现（`drag-origin.ts`）用"行的连续性"判断
 * -> 那个启发式在**双栏**里必然出错
 *    -> 左右栏 y 不对齐 -> 分错组 -> 整行丢失
 * -> -> 本模块**不做分行** -> 只按**绝对尺寸 / 绝对位置**剔除
 *
 * ## 与 `dom-order.ts` 的分工
 *
 * -> `dom-order.ts`：**决定"选了哪一段"**（语义）
 * -> 本模块：**决定"哪些矩形不该画"**（修正）
 *
 * @packageDocumentation
 */

import type { ClientRectLike } from './dom-order';

/**
 * **水平离群的距离阈值**（px）
 *
 * ## 实测（真实 PDF `paper.pdf`）
 *
 * -> 正文栏宽 ~600px
 * -> 页边戳（竖排 arXiv 水印）离正文 **~780px**
 * -> -> 阈值 **300px** -> 能剔掉页边戳
 * -> -> 又不会剔掉"同一行的正常延伸"
 */
export const OUTLIER_HORIZONTAL_DISTANCE = 300;

/** 输入 */
export interface FilterOutliersInput {
  /** 候选矩形 */
  rects: readonly ClientRectLike[];
  /** 页高（**视口坐标**）；不给 -> 跳过"整页/超高"判断 */
  pageHeight?: number;
  /** 正文的水平范围（**视口坐标**）；不给 -> 跳过"页边戳"判断 */
  bodyRange?: { left: number; right: number };
}

/** 输出 */
export interface FilterOutliersResult {
  /** 保留的矩形 */
  kept: ClientRectLike[];
  /** 丢弃的矩形 */
  dropped: ClientRectLike[];
  /** 被当成"超高"丢掉的（整页矩形 / 旋转文字）*/
  tooTall: number;
  /** 被当成"水平离群"丢掉的（页边戳）*/
  tooFarHorizontally: number;
}

/**
 * **剔除离群矩形**
 *
 * ## ⚠️ **全被丢掉时返回原来的**（保守）
 *
 * -> 阈值判断不可能完美
 * -> 万一判错 -> **宁可多画** ❌ 也不要一个不画
 *
 * @param input 输入
 * @returns 保留 / 丢弃的矩形
 */
export function filterOutliers(input: FilterOutliersInput): FilterOutliersResult {
  const { rects, pageHeight, bodyRange } = input;

  if (rects.length === 0) {
    return { kept: [], dropped: [], tooTall: 0, tooFarHorizontally: 0 };
  }

  const kept: ClientRectLike[] = [];
  const dropped: ClientRectLike[] = [];
  let tooTall = 0;
  let tooFarHorizontally = 0;

  for (const rect of rects) {
    /*
     * ⚠️ **超高判断**（整页矩形 / 旋转文字）
     * -> 阈值 = 页高的 1/3 -> 一行文字远小于它
     */
    if (pageHeight !== undefined && pageHeight > 0 && rect.height > pageHeight / 3) {
      tooTall += 1;
      dropped.push(rect);
      continue;
    }

    /*
     * ⚠️ **水平离群判断**（页边戳）
     */
    if (bodyRange) {
      const center = rect.left + rect.width / 2;
      const distance =
        center < bodyRange.left
          ? bodyRange.left - center
          : center > bodyRange.right
            ? center - bodyRange.right
            : 0;
      if (distance > OUTLIER_HORIZONTAL_DISTANCE) {
        tooFarHorizontally += 1;
        dropped.push(rect);
        continue;
      }
    }

    kept.push(rect);
  }

  // ⚠️ **全被丢掉 -> 返回原来的**（保守）
  if (kept.length === 0 && rects.length > 0) {
    return {
      kept: [...rects],
      dropped: [],
      tooTall,
      tooFarHorizontally,
    };
  }

  return { kept, dropped, tooTall, tooFarHorizontally };
}
