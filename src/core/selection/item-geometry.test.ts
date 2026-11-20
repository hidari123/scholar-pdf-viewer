/**
 * `core/selection/item-geometry` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> 147 行、**零测试** ❌
 * -> 而且**没有从 `core/selection/index.ts` 导出** -> 宿主根本用不到 ❌
 *
 * ## 审计发现的边界风险
 *
 * -> \`glyphExtentOf\` 用 \`below = fontSize - above\` ❌
 *   -> 如果 \`measureAscentRatio\` **大于 1** -> \`below\` **是负数** ❌
 *   -> \`glyphHeight = above + below\` -> 高度算错 ❌
 *   -> \`clipRectToGlyph\` 可能返回**负高度的矩形**（上下颠倒）❌
 */

import { describe, expect, it } from 'vitest';
import { clipRectToGlyph, glyphExtentOf, itemBoxOf } from './item-geometry';

describe('glyphExtentOf', () => {
  it('**above + below 正好等于 fontSize**', () => {
    for (const font of ['sans-serif', 'serif', 'monospace', 'Arial', 'Times']) {
      for (const size of [8, 12, 16, 24, 48]) {
        const { above, below } = glyphExtentOf(font, size);
        expect(above + below).toBeCloseTo(size, 6);
      }
    }
  });

  it('**above 和 below 都不是负数**（审计发现的边界）', () => {
    for (const font of ['sans-serif', 'serif', 'monospace', 'Arial', 'Times', 'unknown-font']) {
      for (const size of [8, 12, 16, 24, 48, 96]) {
        const { above, below } = glyphExtentOf(font, size);
        expect(above).toBeGreaterThanOrEqual(0);
        expect(below).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('字号越大 -> 范围越大', () => {
    const small = glyphExtentOf('sans-serif', 10);
    const big = glyphExtentOf('sans-serif', 40);
    expect(big.above).toBeGreaterThan(small.above);
    expect(big.below).toBeGreaterThan(small.below);
  });
});

describe('itemBoxOf', () => {
  /*
   * ⚠️ `PositionedTextItem` 的**完整形状**（`text-layer/layout.ts` 排版出来的）。
   * -> 少字段 -> 类型报错 -> 这里补全 ✅
   */
  const item = {
    text: '示例文字',
    left: 100,
    top: 200,
    fontSize: 16,
    fontFamily: 'sans-serif',
    scaleX: 1,
    width: 80,
    angle: 0,
    hasEOL: false,
  };

  it('**基线 = top + ascent**（layout.ts 就是这么算的）', () => {
    const box = itemBoxOf(item);
    const { above } = glyphExtentOf(item.fontFamily, item.fontSize);
    expect(box.baseline).toBeCloseTo(item.top + above, 6);
  });

  it('left / fontSize / fontFamily 原样带过去', () => {
    const box = itemBoxOf(item);
    expect(box.left).toBe(100);
    expect(box.fontSize).toBe(16);
    expect(box.fontFamily).toBe('sans-serif');
  });

  it('**fontSize = 0 -> 基线 = top**（不崩）', () => {
    const box = itemBoxOf({ ...item, fontSize: 0 });
    expect(box.baseline).toBeCloseTo(item.top, 6);
  });

  it('**负字号也不崩**', () => {
    expect(() => itemBoxOf({ ...item, fontSize: -10 })).not.toThrow();
  });
});

describe('clipRectToGlyph', () => {
  const glyph = { above: 12, below: 4 }; // 字形高 16

  it('**正常情况 -> 裁剪成字形高度**', () => {
    const rect = { x: 10, y: 100, width: 80, height: 20 };
    // 基线 112 -> 字形 [100, 116] -> 高度 16
    const out = clipRectToGlyph(rect, 112, glyph);
    expect(out.y).toBeCloseTo(100, 6);
    expect(out.height).toBeCloseTo(16, 6);
    expect(out.x).toBe(10);
    expect(out.width).toBe(80);
  });

  it('**字形比矩形还高 -> 退回原矩形**（基线算错了的保险）', () => {
    const rect = { x: 10, y: 100, width: 80, height: 10 };
    const out = clipRectToGlyph(rect, 112, glyph);
    expect(out).toEqual(rect);
  });

  it('**字形完全在矩形上方 -> 退回原矩形**', () => {
    const rect = { x: 10, y: 200, width: 80, height: 20 };
    const out = clipRectToGlyph(rect, 112, glyph);
    expect(out).toEqual(rect);
  });

  it('**字形完全在矩形下方 -> 退回原矩形**', () => {
    const rect = { x: 10, y: 50, width: 80, height: 20 };
    const out = clipRectToGlyph(rect, 112, glyph);
    expect(out).toEqual(rect);
  });

  it('**高度永远不为负**（审计发现的边界）', () => {
    // 各种极端组合
    const cases = [
      { rect: { x: 0, y: 100, width: 10, height: 20 }, baseline: 112 },
      { rect: { x: 0, y: 100, width: 10, height: 18 }, baseline: 110 },
      { rect: { x: 0, y: 100, width: 10, height: 16 }, baseline: 108 },
      { rect: { x: 0, y: 100, width: 10, height: 30 }, baseline: 115 },
    ];
    for (const { rect, baseline } of cases) {
      const out = clipRectToGlyph(rect, baseline, glyph);
      expect(out.height).toBeGreaterThanOrEqual(0);
      // 高度不能超过原矩形
      expect(out.height).toBeLessThanOrEqual(rect.height + 0.001);
    }
  });

  it('**x / width 永远不变**（水平交给浏览器算）', () => {
    const rect = { x: 33, y: 100, width: 77, height: 20 };
    const out = clipRectToGlyph(rect, 112, glyph);
    expect(out.x).toBe(33);
    expect(out.width).toBe(77);
  });

  it('**不修改传入的矩形**（不污染调用方的数据）', () => {
    const rect = { x: 10, y: 100, width: 80, height: 20 };
    const snapshot = { ...rect };
    clipRectToGlyph(rect, 112, glyph);
    expect(rect).toEqual(snapshot);
  });

  it('**零高度的矩形也不崩**', () => {
    const rect = { x: 10, y: 100, width: 80, height: 0 };
    expect(() => clipRectToGlyph(rect, 112, glyph)).not.toThrow();
  });
});
