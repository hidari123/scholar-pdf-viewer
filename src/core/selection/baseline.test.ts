import { describe, expect, it } from 'vitest';
import { clipToBaseline } from './shape';

describe('clipToBaseline', () => {
  /**
   * 真实 PDF 实测（230%）：
   * - 浏览器的选区矩形：y=231.92, h=44（字体自然行盒）
   * - 文字本身（span）：  y=237.92, h=33（font-size × line-height(1)）
   * → 差 6px（偏上），框高多 11px
   *
   * 字形框表：**直接存 span 的盒子**（top + fontSize + 水平范围）。
   */
  const baselines = [
    { top: 237.92, height: 33, baseline: 237.92 + 26.4, left: 449.7, width: 151.16 },
  ];

  it('把浏览器行盒裁剪成贴合字形', () => {
    const result = clipToBaseline({ x: 449.7, y: 231.92, width: 151.16, height: 44 }, baselines);

    // 裁剪后：顶 = 字形框的 top，底 = top + height
    expect(result.y).toBeCloseTo(237.92, 2);
    expect(result.height).toBeCloseTo(33, 2);
    // 水平不动
    expect(result.x).toBe(449.7);
    expect(result.width).toBe(151.16);
  });

  it('支持 {left, top} 形状（视图坐标）', () => {
    const result = clipToBaseline({ left: 100, top: 231.92, width: 151, height: 44 }, baselines);

    expect(result.left).toBe(100);
    expect(result.top).toBeCloseTo(237.92, 2);
    expect(result.height).toBeCloseTo(33, 2);
  });

  /*
   * ⚠️ 回归：**同一行混着正文和上标**时，必须挑对。
   *
   * 真实 PDF 实测：
   * ```
   * 选区矩形   y=452.8 h=27      (452.8..479.8)
   * 上标 "*"   y=451.7 h=16      (451.7..467.7)  ← 基线更近
   * 正文       y=456.8 h=20.6    (456.8..477.4)  ← 水平上才跟矩形重叠
   * ```
   *
   * 只按基线最近 → 选到上标 → 它的盒子超出选区矩形 → 被"保险"拒绝 → 不裁剪 ❌
   * → 必须**依次尝试**（或优先水平重叠大的）。
   */
  it('同一行混着正文和上标时，挑水平重叠的那个', () => {
    const mixed = [
      // 上标（基线更近，但水平上只重叠 6px）
      { top: 451.7, height: 16, baseline: 464.5, left: 242.7, width: 7.3 },
      // 正文（水平上重叠 180px）
      { top: 456.8, height: 20.6, baseline: 473.3, left: 253, width: 180.5 },
    ];

    const result = clipToBaseline({ x: 253, y: 452.8, width: 186.6, height: 27 }, mixed);

    expect(result.y).toBeCloseTo(456.8, 1);
    expect(result.height).toBeCloseTo(20.6, 1);
  });

  it('裁剪结果必须完全在原矩形内（否则退回原矩形）', () => {
    // 这一行离矩形太远 → 不属于这一行 → 不裁剪
    const result = clipToBaseline({ x: 0, y: 100, width: 100, height: 20 }, [
      { top: 500, height: 10, baseline: 508, left: 0, width: 100 },
    ]);

    expect(result.y).toBe(100);
    expect(result.height).toBe(20);
  });

  it('字形框表为空时退回原矩形', () => {
    const rect = { x: 0, y: 100, width: 100, height: 20 };
    expect(clipToBaseline(rect, [])).toEqual(rect);
  });

  it('选基线离矩形中心最近的那一行', () => {
    const result = clipToBaseline({ x: 0, y: 100, width: 100, height: 20 }, [
      { top: 110, height: 10, baseline: 118, left: 0, width: 100 },
      { top: 105, height: 10, baseline: 113, left: 0, width: 100 },
    ]);

    expect(result.y).toBe(105);
    expect(result.height).toBe(10);
  });

  it('离得太远（> 2 倍行高）时不裁剪', () => {
    const rect = { x: 0, y: 100, width: 100, height: 20 };
    // baseline 差 100px，行高 10px → 100 > 20 → 不裁剪
    const result = clipToBaseline(rect, [
      { top: 205, height: 10, baseline: 213, left: 0, width: 100 },
    ]);

    expect(result).toEqual(rect);
  });

  it('字形框超出原矩形时不裁剪（防退化）', () => {
    const rect = { x: 0, y: 100, width: 100, height: 20 };
    // 字形框 top=95 → 超出原矩形上边界 → 不裁剪
    const result = clipToBaseline(rect, [
      { top: 95, height: 10, baseline: 103, left: 0, width: 100 },
    ]);

    expect(result).toEqual(rect);
  });

  it('字形框高度为 0 时不裁剪', () => {
    const rect = { x: 0, y: 100, width: 100, height: 20 };
    const result = clipToBaseline(rect, [
      { top: 105, height: 0, baseline: 105, left: 0, width: 100 },
    ]);

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
