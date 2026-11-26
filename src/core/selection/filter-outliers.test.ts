/**
 * `filter-outliers.ts` 的单元测试 ✅
 */

import { describe, expect, it } from 'vitest';
import type { ClientRectLike } from './dom-order';
import {
  filterByVerticalRange,
  filterOutliers,
  OUTLIER_HORIZONTAL_DISTANCE,
} from './filter-outliers';

/** 造一个矩形 ✅ */
function rect(left: number, top: number, width = 100, height = 20): ClientRectLike {
  return { left, top, width, height };
}

describe('filterOutliers（剔除离群矩形 ✅）', () => {
  it('普通矩形 -> 全部保留 ✅', () => {
    const rects = [rect(100, 100), rect(200, 120)];
    const result = filterOutliers({ rects, pageHeight: 1000, bodyRange: { left: 0, right: 800 } });

    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });

  it('整页矩形（超高）-> 剔除 ✅', () => {
    const rects = [rect(100, 0, 600, 1000), rect(100, 100)];
    const result = filterOutliers({ rects, pageHeight: 1000 });

    expect(result.kept).toHaveLength(1);
    expect(result.tooTall).toBe(1);
  });

  it('旋转文字（超高）-> 剔除 ✅', () => {
    // 页高 1000 -> 阈值 333 ✅ -> 高度 800 远超 ✅
    const rects = [rect(1460, 100, 30, 800), rect(100, 100)];
    const result = filterOutliers({ rects, pageHeight: 1000 });

    expect(result.kept).toHaveLength(1);
    expect(result.tooTall).toBe(1);
  });

  it('页边戳（水平离群）-> 剔除 ✅', () => {
    const rects = [rect(100, 100), rect(1460, 100)];
    const result = filterOutliers({
      rects,
      pageHeight: 1000,
      bodyRange: { left: 100, right: 900 },
    });

    expect(result.kept).toHaveLength(1);
    expect(result.tooFarHorizontally).toBe(1);
  });

  it('⚠️ 离群距离刚好在阈值内 -> 保留 ✅', () => {
    const edge = rect(100 + OUTLIER_HORIZONTAL_DISTANCE, 100, 1);
    const result = filterOutliers({
      rects: [edge],
      pageHeight: 1000,
      bodyRange: { left: 100, right: 900 },
    });

    expect(result.kept).toHaveLength(1);
  });

  it('没给 pageHeight -> 跳过超高判断 ✅', () => {
    const rects = [rect(100, 0, 600, 5000)];
    const result = filterOutliers({ rects });

    expect(result.kept).toHaveLength(1);
    expect(result.tooTall).toBe(0);
  });

  it('没给 bodyRange -> 跳过水平判断 ✅', () => {
    const rects = [rect(5000, 100)];
    const result = filterOutliers({ rects, pageHeight: 1000 });

    expect(result.kept).toHaveLength(1);
    expect(result.tooFarHorizontally).toBe(0);
  });

  it('⚠️ 全被丢掉 -> 返回原来的 ✅（保守 ✅）', () => {
    const rects = [rect(1460, 100)];
    const result = filterOutliers({
      rects,
      pageHeight: 1000,
      bodyRange: { left: 100, right: 900 },
    });

    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('空输入 -> 空结果 ✅', () => {
    const result = filterOutliers({ rects: [], pageHeight: 1000 });
    expect(result.kept).toHaveLength(0);
  });
});

describe('filterByVerticalRange（垂直过滤 ✅）', () => {
  it('范围内 -> 保留 ✅', () => {
    const rects = [rect(0, 100), rect(0, 200), rect(0, 300)];
    const kept = filterByVerticalRange(rects, { fromY: 90, toY: 250 });

    expect(kept).toHaveLength(2);
  });

  it('⚠️ 双向区间 ✅：上下两界都生效 ✅（不是只保留下界 ✅）', () => {
    const rects = [rect(0, 50), rect(0, 100), rect(0, 150), rect(0, 200)];
    // 判据 = `bottom > fromY && top < toY` ✅
    // -> top=50  ❌（bottom=70 <= 100 ✅）
    // -> top=100 ✅（bottom=120 > 100 ✅ -> top=100 < 200 ✅）
    // -> top=150 ✅
    // -> top=200 ❌（top=200 < 200 ❌）
    const kept = filterByVerticalRange(rects, { fromY: 100, toY: 200 });

    expect(kept).toHaveLength(2);
    expect(kept.map((r) => r.top)).toEqual([100, 150]);
  });

  it('⚠️ 往上拖 ✅：起点在下界时 ✅ 上面的内容不被丢 ✅', () => {
    // 往上拖 ✅ -> 区间 = [起点, 终点] ✅
    // -> **上界之上**的内容不在区间内 ✅ -> 该丢 ✅
    const rects = [rect(0, 50), rect(0, 100), rect(0, 150)];
    const kept = filterByVerticalRange(rects, { fromY: 100, toY: 160 });

    // -> top=100 / 150 ✅ 保留 ✅ -> top=50 ❌ 丢掉 ✅
    expect(kept).toHaveLength(2);
  });

  it('⚠️ 往下拖 ✅：终点在下界时 ✅ 下面的内容不被丢 ✅', () => {
    // 往下拖 ✅ -> 区间 = [起点, 终点] ✅
    const rects = [rect(0, 100), rect(0, 150), rect(0, 200), rect(0, 250)];
    const kept = filterByVerticalRange(rects, { fromY: 100, toY: 220 });

    // -> top=100 / 150 / 200 ✅ -> top=250 ❌
    expect(kept).toHaveLength(3);
  });

  it('range 为 null -> 全部保留 ✅', () => {
    const rects = [rect(0, 100), rect(0, 200)];
    expect(filterByVerticalRange(rects, null)).toHaveLength(2);
  });

  it('⚠️ 全被过滤掉 -> 返回原来的 ✅（保守 ✅）', () => {
    const rects = [rect(0, 1000)];
    const kept = filterByVerticalRange(rects, { fromY: 0, toY: 100 });

    expect(kept).toHaveLength(1);
  });
});
