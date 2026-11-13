import { describe, expect, it } from 'vitest';
import type { ViewRect } from '../types';
import { boundingRectOf, optimizeClientRects } from './optimize-rects';

/** 造一个矩形 */
function rect(left: number, top: number, width: number, height: number, pageNumber = 1): ViewRect {
  return { left, top, width, height, pageNumber };
}

describe('optimizeClientRects', () => {
  it('同一行的相邻矩形合并成一条', () => {
    const result = optimizeClientRects([rect(0, 10, 50, 20), rect(50, 11, 40, 19)], 1);

    expect(result).toHaveLength(1);
    expect(result[0]?.width).toBe(90);
    expect(result[0]?.height).toBe(20);
  });

  it('不同行的矩形不合并', () => {
    const result = optimizeClientRects([rect(0, 10, 50, 20), rect(0, 40, 50, 20)], 1);

    expect(result).toHaveLength(2);
  });

  it('不同页的矩形不合并', () => {
    const result = optimizeClientRects([rect(0, 10, 50, 20, 1), rect(0, 10, 50, 20, 2)], 1);

    expect(result).toHaveLength(2);
  });

  it('被完全包含的矩形被剔除', () => {
    const result = optimizeClientRects([rect(10, 10, 10, 10), rect(0, 0, 100, 100)], 1);

    expect(result).toHaveLength(1);
    expect(result[0]?.width).toBe(100);
  });

  it('完全相同的矩形去重（只留一条）', () => {
    const result = optimizeClientRects([rect(0, 0, 10, 10), rect(0, 0, 10, 10)], 1);

    expect(result).toHaveLength(1);
  });

  it('跨页排序：页码优先（修主项目的乘法排序 bug）', () => {
    // 主项目原式：pageNumber * top 相减比较 → 页2(top=5) 会排到 页1(top=100) 前面
    const result = optimizeClientRects([rect(0, 5, 10, 10, 2), rect(0, 100, 10, 10, 1)], 1);

    expect(result.map((r) => r.pageNumber)).toEqual([1, 2]);
  });

  it('同页内按 top 排序', () => {
    const result = optimizeClientRects([rect(0, 40, 10, 10), rect(0, 10, 10, 10)], 1);

    expect(result.map((r) => r.top)).toEqual([10, 40]);
  });

  it('输入不可变（不修改调用方传入的对象）', () => {
    const a = rect(0, 10, 50, 20);
    const b = rect(50, 11, 40, 19);
    const input = [a, b];

    const result = optimizeClientRects(input, 1);

    // 原始对象必须一字未改（主项目原实现会直接改 A.width）
    expect(a.width).toBe(50);
    expect(a.height).toBe(20);
    expect(b.width).toBe(40);
    expect(input).toHaveLength(2);
    // 结果是新对象
    expect(result[0]).not.toBe(a);
  });

  it('空数组返回空数组', () => {
    expect(optimizeClientRects([], 1)).toEqual([]);
  });

  it('缩放放大误差容差：缩放越大越容易判定同行', () => {
    // 垂直差 6px：1x 时不算同行（>5），4x 时容差 20 → 算同行
    const at1x = optimizeClientRects([rect(0, 10, 50, 20), rect(50, 16, 40, 19)], 1);
    const at4x = optimizeClientRects([rect(0, 10, 50, 20), rect(50, 16, 40, 19)], 4);

    expect(at1x).toHaveLength(2);
    expect(at4x).toHaveLength(1);
  });
});

describe('boundingRectOf', () => {
  it('空数组返回 null', () => {
    expect(boundingRectOf([])).toBeNull();
  });

  it('算出包围盒', () => {
    const result = boundingRectOf([rect(10, 10, 20, 20), rect(30, 40, 20, 20)]);

    expect(result?.left).toBe(10);
    expect(result?.top).toBe(10);
    expect(result?.width).toBe(40);
    expect(result?.height).toBe(50);
  });
});
