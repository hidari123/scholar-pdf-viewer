import { describe, expect, it } from 'vitest';
import {
  computePrintPageSize,
  computePrintScale,
  computePrintScaleForRender,
  DEFAULT_PRINT_MARGIN,
  MM_TO_PX,
  orientPaper,
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

describe('computePrintScaleForRender', () => {
  /*
   * ⚠️ **实测数据**（真实 arXiv PDF，18 页）。
   *
   * ```
   * 屏幕上的页: 1407.6 × 1821.6 px   ← "适合宽度"的缩放（2.3×）
   * A4 可打印区: (210-24) × (297-24) mm = 186 × 273 mm = 703 × 1032 px
   * ```
   */
  const rendered = { width: 1407.6, height: 1821.6 };

  it('**按"渲染后的像素"算缩放**（实测 0.499）', () => {
    const scale = computePrintScaleForRender(rendered, PAPER_SIZES.A4);

    // min(703/1407.6, 1032/1821.6) = min(0.4994, 0.5665) = 0.4994
    expect(scale).toBeCloseTo(0.4994, 3);
  });

  it('**缩完正好落在 A4 可打印区里**（不会溢出到第二张纸）', () => {
    const a4 = PAPER_SIZES.A4;
    if (!a4) {
      throw new Error('没有 A4 纸张规格');
    }
    const scale = computePrintScaleForRender(rendered, a4);
    const printableWidthPx = (a4.width - 24) * MM_TO_PX;
    const printableHeightPx = (a4.height - 24) * MM_TO_PX;

    expect(rendered.width * scale).toBeLessThanOrEqual(printableWidthPx + 1);
    expect(rendered.height * scale).toBeLessThanOrEqual(printableHeightPx + 1);
  });

  it('⚠️ **和"物理比例"不同**（别用错函数）', () => {
    const a4 = PAPER_SIZES.A4;
    if (!a4) {
      throw new Error('没有 A4 纸张规格');
    }
    // 物理比例：216mm 的页放到 186mm 的可打印区 → 0.861
    const physical = computePrintScale({ width: 612, height: 792 }, a4);
    const forRender = computePrintScaleForRender(rendered, a4);

    expect(physical).toBeCloseTo(0.8615, 3);
    expect(forRender).toBeCloseTo(0.499, 3);
    // ⚠️ 用物理比例去缩屏幕像素 → **会溢出**（实测 18 页印成 33 页）
    expect(rendered.width * physical).toBeGreaterThan((a4.width - 24) * MM_TO_PX);
  });

  it('**不放大超过 1 倍**', () => {
    const scale = computePrintScaleForRender({ width: 100, height: 100 }, PAPER_SIZES.A4);

    expect(scale).toBeLessThanOrEqual(1);
  });

  it('**尺寸无效 → 1**', () => {
    expect(computePrintScaleForRender({ width: 0, height: 0 })).toBe(1);
    expect(computePrintScaleForRender({ width: -1, height: 100 })).toBe(1);
  });

  it('**A3 纸 → 缩放更大**（纸更大 → 缩得更少）', () => {
    const a4 = computePrintScaleForRender(rendered, PAPER_SIZES.A4);
    const a3 = computePrintScaleForRender(rendered, PAPER_SIZES.A3);

    expect(a3).toBeGreaterThan(a4);
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

/*
 * ⚠️ **打印方向**（用户反馈："而且横向打印有很多空白页"）。
 *
 * -> 横向 A4 的可印区是 **297 × 210mm**（不是 210 × 297）
 * -> 不换 -> 按**纵向**的高度算缩放 ❌
 *    -> 缩放太大 ❌ -> 每页占 **2 张纸** ❌
 *    -> 实测：18 页印成 **36 张** ❌
 */
describe('orientPaper', () => {
  it('**纵向 -> 不变**', () => {
    const a4 = { width: 210, height: 297 };
    expect(orientPaper(a4, 'portrait')).toEqual(a4);
    expect(orientPaper(a4, 'auto')).toEqual(a4);
  });

  it('**横向 -> 宽高互换**', () => {
    expect(orientPaper({ width: 210, height: 297 }, 'landscape')).toEqual({
      width: 297,
      height: 210,
    });
  });
});

describe('computePrintScaleForRender（方向）', () => {
  const rendered = { width: 1408, height: 1822 };

  it('**横向的缩放比纵向【小】**', () => {
    const portrait = computePrintScaleForRender(rendered, PAPER_SIZES.A4);
    const landscape = computePrintScaleForRender(rendered, PAPER_SIZES.A4, undefined, 'landscape');
    expect(landscape).toBeLessThan(portrait);
  });

  it('**横向：页高正好放得进横向的纸**（703px = 186mm @96dpi）', () => {
    const scale = computePrintScaleForRender(rendered, PAPER_SIZES.A4, undefined, 'landscape');
    // 可印高 = (210 - 24) mm = 186mm = 703px
    const printableHeightPx = (210 - 12 - 12) * (96 / 25.4);
    expect(rendered.height * scale).toBeLessThanOrEqual(printableHeightPx + 1);
  });

  it('**纵向：页高正好放得进纵向的纸**（1032px = 273mm @96dpi）', () => {
    const scale = computePrintScaleForRender(rendered, PAPER_SIZES.A4);
    const printableHeightPx = (297 - 12 - 12) * (96 / 25.4);
    expect(rendered.height * scale).toBeLessThanOrEqual(printableHeightPx + 1);
  });
});
