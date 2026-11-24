// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  clampScale,
  FIT_WIDTH_PADDING,
  MAX_SCALE,
  MIN_SCALE,
  quantizeScale,
  stepScaleByQuantum,
} from './useZoom';

describe('quantizeScale', () => {
  it('量化到 10% 的倍数', () => {
    expect(quantizeScale(2.2205)).toBeCloseTo(2.2);
    expect(quantizeScale(1.04)).toBeCloseTo(1.0);
    expect(quantizeScale(1.26)).toBeCloseTo(1.3);
    expect(quantizeScale(0.96)).toBeCloseTo(1.0);
  });

  it('已经是整十数的不变', () => {
    expect(quantizeScale(1)).toBeCloseTo(1.0);
    expect(quantizeScale(2.5)).toBeCloseTo(2.5);
    expect(quantizeScale(0.2)).toBeCloseTo(0.2);
  });

  it('量化后的比例 × 100 是整十数', () => {
    for (const raw of [2.2205, 1.037, 0.874, 1.999, 0.251]) {
      const percent = quantizeScale(raw) * 100;
      expect(Math.abs(percent - Math.round(percent))).toBeLessThan(0.0001);
    }
  });

  it('非法值原样返回', () => {
    expect(quantizeScale(0)).toBe(0);
    expect(Number.isNaN(quantizeScale(Number.NaN))).toBe(true);
  });
});

describe('缩放范围', () => {
  it('范围是 10% 的倍数（与量化步长一致）', () => {
    expect(MIN_SCALE * 100).toBe(Math.round(MIN_SCALE * 100));
    expect(MAX_SCALE * 100).toBe(Math.round(MAX_SCALE * 100));
  });
});

/**
 * **就近取整到 10%**（用户反馈：
 * "缩放那里用户可以自己选择缩放的大小 最大不能超过250%
 *  比如说 fit的时候是237%，那么点击加号或者减号 放大缩小
 *  减号到230加号到240 这里用整十数"）。
 */
describe('stepScaleByQuantum（就近取整到 10%）', () => {
  it('237% 放大 -> 240%（用户举的例子）', () => {
    expect(stepScaleByQuantum(2.37, 1)).toBeCloseTo(2.4, 5);
  });

  it('237% 缩小 -> 230%（用户举的例子）', () => {
    expect(stepScaleByQuantum(2.37, -1)).toBeCloseTo(2.3, 5);
  });

  it('235% 放大 -> 240%（就近，不是 250）', () => {
    expect(stepScaleByQuantum(2.35, 1)).toBeCloseTo(2.4, 5);
  });

  it('235% 缩小 -> 230%（就近，不是 220）', () => {
    expect(stepScaleByQuantum(2.35, -1)).toBeCloseTo(2.3, 5);
  });

  it('已经在整十数上 -> 直接加一步', () => {
    expect(stepScaleByQuantum(2.3, 1)).toBeCloseTo(2.4, 5);
    expect(stepScaleByQuantum(2.3, -1)).toBeCloseTo(2.2, 5);
  });

  it('90% -> 100% / 80%', () => {
    expect(stepScaleByQuantum(0.9, 1)).toBeCloseTo(1.0, 5);
    expect(stepScaleByQuantum(0.9, -1)).toBeCloseTo(0.8, 5);
  });

  it('连点两次不会跳过 10%', () => {
    // 237% -> 240% -> 250%（而不是 240% -> 260%）
    const once = stepScaleByQuantum(2.37, 1);
    const twice = stepScaleByQuantum(once, 1);
    expect(twice).toBeCloseTo(2.5, 5);
  });

  it('结果永远是 10% 的倍数', () => {
    for (const current of [0.37, 0.91, 1.03, 1.07, 2.37, 2.44, 2.46, 2.5]) {
      for (const direction of [1, -1] as const) {
        const next = stepScaleByQuantum(current, direction);
        const percent = next * 100;
        expect(Math.abs(percent - Math.round(percent / 10) * 10)).toBeLessThan(0.001);
      }
    }
  });

  it('非法输入原样返回', () => {
    expect(stepScaleByQuantum(Number.NaN, 1)).toBeNaN();
    expect(stepScaleByQuantum(0, 1)).toBe(0);
    expect(stepScaleByQuantum(-1, 1)).toBe(-1);
  });
});

describe('fitWidth 的留白', () => {
  it('两边都要留空隙（用户反馈："两边也要留一点空隙的"）', () => {
    // 至少 20px -> 看起来像 WPS 那样有留白
    expect(FIT_WIDTH_PADDING).toBeGreaterThanOrEqual(20);
  });
});

/*
 * ⚠️ **缩放上下限可以由宿主配置**（用户需求：
 * "这个上限下限宿主也可以配置" ✅）。
 */
describe('夹到缩放范围（上下限可配）', () => {
  it('**默认夹到 20% ~ 250%**', () => {
    expect(clampScale(0.05)).toBe(0.2);
    expect(clampScale(5)).toBe(2.5);
    expect(clampScale(1.5)).toBe(1.5);
  });

  it('**宿主可以指定上下限**', () => {
    expect(clampScale(5, 0.1, 4)).toBe(4);
    expect(clampScale(0.05, 0.1, 4)).toBe(0.1);
  });

  it('**宿主把上下限配反了 -> 用默认值**（不能让用户完全不能缩放）', () => {
    expect(clampScale(5, 4, 0.1)).toBe(2.5);
    expect(clampScale(0.05, 4, 0.1)).toBe(0.2);
  });
});
