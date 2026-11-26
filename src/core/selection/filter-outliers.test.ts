/**
 * `filter-outliers.ts` 的单元测试
 */

import { describe, expect, it } from 'vitest';
import type { ClientRectLike } from './dom-order';
import { filterOutliers, OUTLIER_HORIZONTAL_DISTANCE } from './filter-outliers';

/** 造一个矩形 */
function rect(left: number, top: number, width = 100, height = 20): ClientRectLike {
  return { left, top, width, height };
}

describe('filterOutliers（剔除离群矩形）', () => {
  it('普通矩形 -> 全部保留', () => {
    const rects = [rect(100, 100), rect(200, 120)];
    const result = filterOutliers({ rects, pageHeight: 1000, bodyRange: { left: 0, right: 800 } });

    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('整页矩形（超高）-> 剔除', () => {
    const rects = [rect(100, 0, 600, 1000), rect(100, 100)];
    const result = filterOutliers({ rects, pageHeight: 1000 });

    expect(result.kept).toHaveLength(1);
    expect(result.tooTall).toBe(1);
  });

  it('旋转文字（超高）-> 剔除', () => {
    // 页高 1000 -> 阈值 333 -> 高度 800 远超
    const rects = [rect(1460, 100, 30, 800), rect(100, 100)];
    const result = filterOutliers({ rects, pageHeight: 1000 });

    expect(result.kept).toHaveLength(1);
    expect(result.tooTall).toBe(1);
  });

  it('页边戳（水平离群）-> 剔除', () => {
    const rects = [rect(100, 100), rect(1460, 100)];
    const result = filterOutliers({
      rects,
      pageHeight: 1000,
      bodyRange: { left: 100, right: 900 },
    });

    expect(result.kept).toHaveLength(1);
    expect(result.tooFarHorizontally).toBe(1);
  });

  it('离群距离刚好在阈值内 -> 保留', () => {
    const edge = rect(100 + OUTLIER_HORIZONTAL_DISTANCE, 100, 1);
    const result = filterOutliers({
      rects: [edge],
      pageHeight: 1000,
      bodyRange: { left: 100, right: 900 },
    });

    expect(result.kept).toHaveLength(1);
  });

  it('没给 pageHeight -> 跳过超高判断', () => {
    const rects = [rect(100, 0, 600, 5000)];
    const result = filterOutliers({ rects });

    expect(result.kept).toHaveLength(1);
    expect(result.tooTall).toBe(0);
  });

  it('没给 bodyRange -> 跳过水平判断', () => {
    const rects = [rect(5000, 100)];
    const result = filterOutliers({ rects, pageHeight: 1000 });

    expect(result.kept).toHaveLength(1);
    expect(result.tooFarHorizontally).toBe(0);
  });

  it('⚠️ 全被丢掉 -> 返回原来的（保守）', () => {
    const rects = [rect(1460, 100)];
    const result = filterOutliers({
      rects,
      pageHeight: 1000,
      bodyRange: { left: 100, right: 900 },
    });

    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('空输入 -> 空结果', () => {
    const result = filterOutliers({ rects: [], pageHeight: 1000 });
    expect(result.kept).toHaveLength(0);
  });
});
