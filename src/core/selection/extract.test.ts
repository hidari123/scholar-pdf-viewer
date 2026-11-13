import { describe, expect, it } from 'vitest';
import type { PageFrame } from './extract';
import { extractSelection, pageOfRect } from './extract';

/** 两页的页框（容器坐标：页1 在上，页2 在下） */
const PAGES: PageFrame[] = [
  { pageNumber: 1, top: 0, left: 0, width: 600, height: 800 },
  { pageNumber: 2, top: 800, left: 0, width: 600, height: 800 },
];

/** 提取用到的参考尺寸 */
const REFERENCE = { width: 600, height: 800 };

describe('pageOfRect', () => {
  it('中心点落在页 1 内 → 页 1', () => {
    expect(pageOfRect({ top: 10, left: 10, width: 100, height: 20 }, PAGES)).toBe(1);
  });

  it('中心点落在页 2 内 → 页 2', () => {
    expect(pageOfRect({ top: 900, left: 10, width: 100, height: 20 }, PAGES)).toBe(2);
  });

  it('中心点不在任何页内 → null', () => {
    expect(pageOfRect({ top: 5000, left: 10, width: 100, height: 20 }, PAGES)).toBeNull();
  });

  it('跨页边界上的矩形按中心点判定（不丢矩形）', () => {
    // 矩形横跨页 1 底部边界：中心点在页 2 → 归页 2
    const rect = { top: 780, left: 10, width: 100, height: 60 };
    expect(pageOfRect(rect, PAGES)).toBe(2);
  });
});

describe('extractSelection', () => {
  it('单页选区：输出视口矩形 + 归一化结构', () => {
    const result = extractSelection({
      text: 'hello',
      rects: [{ top: 10, left: 10, width: 100, height: 20 }],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result).not.toBeNull();
    expect(result?.text).toBe('hello');
    expect(result?.pages).toEqual([1]);
    expect(result?.rects[0]?.left).toBe(10);
    expect(result?.rects[0]?.top).toBe(10);
    // 归一化：坐标与参考尺寸同尺度 → x1 = 10
    expect(result?.norm.rects[0]?.x1).toBe(10);
    expect(result?.norm.rects[0]?.width).toBe(600);
    expect(result?.norm.pageNumber).toBe(1);
  });

  it('跨页选区：两页都归属，页码升序', () => {
    const result = extractSelection({
      text: 'across',
      rects: [
        { top: 10, left: 10, width: 100, height: 20 },
        { top: 810, left: 10, width: 100, height: 20 },
      ],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result?.pages).toEqual([1, 2]);
    expect(result?.rects).toHaveLength(2);
  });

  it('同行碎矩形合并（浏览器把一行切成多段的情况）', () => {
    const result = extractSelection({
      text: 'merged',
      rects: [
        { top: 10, left: 10, width: 40, height: 20 },
        { top: 11, left: 50, width: 40, height: 19 },
      ],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result?.rects).toHaveLength(1);
    expect(result?.rects[0]?.width).toBe(80);
  });

  it('矩形转换到页内坐标（减去页框偏移）', () => {
    const result = extractSelection({
      text: 'page2',
      rects: [{ top: 810, left: 10, width: 100, height: 20 }],
      pages: PAGES,
      reference: REFERENCE,
    });

    // 页 2 的 top 偏移是 800 → 页内 top = 10
    expect(result?.rects[0]?.top).toBe(10);
    expect(result?.rects[0]?.pageNumber).toBe(2);
  });

  it('空矩形 / 空页框 → null', () => {
    expect(
      extractSelection({ text: '', rects: [], pages: PAGES, reference: REFERENCE }),
    ).toBeNull();
    expect(
      extractSelection({
        text: 'x',
        rects: [{ top: 1, left: 1, width: 1, height: 1 }],
        pages: [],
        reference: REFERENCE,
      }),
    ).toBeNull();
  });

  it('所有矩形都不属于任何页 → null', () => {
    expect(
      extractSelection({
        text: 'x',
        rects: [{ top: 99999, left: 0, width: 10, height: 10 }],
        pages: PAGES,
        reference: REFERENCE,
      }),
    ).toBeNull();
  });

  it('锚点取第一页的包围盒', () => {
    const result = extractSelection({
      text: 'x',
      rects: [
        { top: 10, left: 10, width: 100, height: 20 },
        { top: 810, left: 10, width: 100, height: 20 },
      ],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result?.anchor.pageNumber).toBe(1);
    expect(result?.anchor.rect.top).toBe(10);
  });
});
