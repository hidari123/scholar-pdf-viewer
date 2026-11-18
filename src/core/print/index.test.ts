import { describe, expect, it } from 'vitest';
import {
  computePrintPageSize,
  computePrintScale,
  DEFAULT_PRINT_MARGIN,
  MM_TO_PX,
  PAPER_SIZES,
} from './index';

describe('computePrintScale', () => {
  it('A4 页 + A4 纸 → 缩放比 ≤ 1（不放大）', () => {
    // A4 = 595 × 842 pt
    const scale = computePrintScale({ width: 595, height: 842 }, PAPER_SIZES.A4);

    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(1);
  });

  /*
   * ⚠️ **A4 纸放 A4 页** → 可打印区比页面小（要留边距）
   * → 缩放比应该 **略小于 1**（约 0.87）。
   */
  it('A4 页在 A4 纸上：缩放比 = 可打印区 / 页面', () => {
    const scale = computePrintScale({ width: 595, height: 842 }, PAPER_SIZES.A4);

    // 可打印区 186 × 273 mm；页面 209.9 × 297 mm
    expect(scale).toBeCloseTo(186 / 209.9, 2);
  });

  it('A3 纸比 A4 页大 → 仍然不放大（≤ 1）', () => {
    const scale = computePrintScale({ width: 595, height: 842 }, PAPER_SIZES.A3);

    expect(scale).toBeLessThanOrEqual(1);
  });

  it('页面比纸大得多 → 缩得很小（但 > 0）', () => {
    const scale = computePrintScale({ width: 2000, height: 3000 }, PAPER_SIZES.A4);

    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(0.5);
  });

  it('边距越大 → 缩放比越小', () => {
    const small = computePrintScale({ width: 595, height: 842 }, PAPER_SIZES.A4, {
      top: 5,
      right: 5,
      bottom: 5,
      left: 5,
    });
    const large = computePrintScale({ width: 595, height: 842 }, PAPER_SIZES.A4, {
      top: 30,
      right: 30,
      bottom: 30,
      left: 30,
    });

    expect(large).toBeLessThan(small);
  });

  it('非法页尺寸 → 1（不缩放）', () => {
    expect(computePrintScale({ width: 0, height: 0 })).toBe(1);
    expect(computePrintScale({ width: -1, height: 100 })).toBe(1);
  });

  it('非法边距（超过纸宽）→ 1（不缩放）', () => {
    const scale = computePrintScale({ width: 595, height: 842 }, PAPER_SIZES.A4, {
      top: 200,
      right: 200,
      bottom: 200,
      left: 200,
    });

    expect(scale).toBe(1);
  });
});

describe('computePrintPageSize', () => {
  it('可打印区（mm）→ 像素', () => {
    const size = computePrintPageSize({ width: 595, height: 842 }, PAPER_SIZES.A4);

    // 210 - 12 - 12 = 186 mm
    expect(size.width).toBeCloseTo(186 * MM_TO_PX, 1);
    // 297 - 12 - 12 = 273 mm
    expect(size.height).toBeCloseTo(273 * MM_TO_PX, 1);
  });
});

describe('PAPER_SIZES', () => {
  it('包含常用的纸张规格', () => {
    expect(PAPER_SIZES.A4).toBeDefined();
    expect(PAPER_SIZES.Letter).toBeDefined();
    expect(PAPER_SIZES.A3).toBeDefined();
  });

  it('默认边距是合理的（不小于 5mm）', () => {
    expect(DEFAULT_PRINT_MARGIN.top).toBeGreaterThanOrEqual(5);
    expect(DEFAULT_PRINT_MARGIN.left).toBeGreaterThanOrEqual(5);
  });
});
