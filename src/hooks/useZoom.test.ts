// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { MAX_SCALE, MIN_SCALE, quantizeScale } from './useZoom';

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
