import { describe, expect, it } from 'vitest';
import { clipToBaseline } from './shape';

describe('clipToBaseline', () => {
  /**
   * 真实 PDF 实测（230%）：
   * - 浏览器的选区矩形：y=231.92, h=44（字体自然行盒）
   * - 文字本身（span）：  y=237.92, h=33
   * → 差 6px（偏上），框高多 11px
   */
  const baselines = [
    { baseline: 237.92 + 23, above: 23, below: 10 }, // 基线在 y=260.92
  ];

  it('把浏览器行盒裁剪成贴合字形', () => {
    const result = clipToBaseline({ x: 449.7, y: 231.92, width: 151.16, height: 44 }, baselines);

    // 裁剪后：顶 = 基线 - above，底 = 基线 + below
    expect(result.y).toBeCloseTo(237.92, 1);
    expect(result.height).toBeCloseTo(33, 1);
    // 水平不动
    expect(result.x).toBe(449.7);
    expect(result.width).toBe(151.16);
  });

  it('支持 {left, top} 形状（视图坐标）', () => {
    const result = clipToBaseline({ left: 100, top: 231.92, width: 151, height: 44 }, baselines);

    expect(result.left).toBe(100);
    expect(result.top).toBeCloseTo(237.92, 1);
    expect(result.height).toBeCloseTo(33, 1);
  });

  it('裁剪结果必须完全在原矩形内（否则退回原矩形）', () => {
    // 基线离矩形太远 → 说明不属于这一行 → 不裁剪
    const result = clipToBaseline({ x: 0, y: 100, width: 100, height: 20 }, [
      { baseline: 500, above: 10, below: 10 },
    ]);

    expect(result.y).toBe(100);
    expect(result.height).toBe(20);
  });

  it('基线表为空时退回原矩形', () => {
    const rect = { x: 0, y: 100, width: 100, height: 20 };
    expect(clipToBaseline(rect, [])).toEqual(rect);
  });

  it('选离矩形中心最近的基线', () => {
    const result = clipToBaseline({ x: 0, y: 100, width: 100, height: 20 }, [
      { baseline: 110, above: 10, below: 10 }, // 远
      { baseline: 200, above: 10, below: 10 }, // 近（中心 110）
    ]);

    // 用 baseline=200 → 顶 = 190，落在 [100,120] 外 → 退回
    expect(result.y).toBe(100);
  });

  it('字形高度 >= 原矩形高度时不裁剪（防退化）', () => {
    const rect = { x: 0, y: 100, width: 100, height: 20 };
    const result = clipToBaseline(rect, [{ baseline: 110, above: 30, below: 30 }]);

    expect(result).toEqual(rect);
  });

  it('不修改入参', () => {
    const rect = { x: 0, y: 100, width: 100, height: 20 };
    const snapshot = JSON.stringify(rect);
    const baseSnapshot = JSON.stringify(baselines);

    clipToBaseline(rect, baselines);

    expect(JSON.stringify(rect)).toBe(snapshot);
    expect(JSON.stringify(baselines)).toBe(baseSnapshot);
  });
});
