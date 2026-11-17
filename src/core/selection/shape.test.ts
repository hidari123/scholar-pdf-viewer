import { describe, expect, it } from 'vitest';
import { buildSelectionShapes, mergeOverlappingRects } from './shape';

describe('buildSelectionShapes', () => {
  /** 两页的页框（容器内容坐标） */
  const pageBoxes = [
    { pageNumber: 1, top: 0, left: 0, width: 600, height: 800 },
    { pageNumber: 2, top: 800, left: 0, width: 600, height: 800 },
  ];

  /** 容器在视口里的位置 */
  const containerRect = { top: 100, left: 50 };

  it('按中心点归页', () => {
    const shapes = buildSelectionShapes(
      [{ top: 110, left: 60, width: 100, height: 20 }],
      pageBoxes,
      containerRect,
      0,
    );

    expect(shapes).toHaveLength(1);
    expect(shapes[0]?.pageNumber).toBe(1);
  });

  it('换算成页内坐标（容器内容坐标 - 页框 top/left）', () => {
    // 视口 top=110 → 容器内容 top = 110 - 100 + 0 = 10 → 页内 top = 10 - 0 = 10
    const shapes = buildSelectionShapes(
      [{ top: 110, left: 60, width: 100, height: 20 }],
      pageBoxes,
      containerRect,
      0,
    );

    expect(shapes[0]?.rects[0]).toEqual({ x: 10, y: 10, width: 100, height: 20 });
  });

  it('考虑容器的 scrollTop', () => {
    // 滚动 200 后, 视口 top=110 对应内容 top = 110-100+200 = 210
    const shapes = buildSelectionShapes(
      [{ top: 110, left: 60, width: 100, height: 20 }],
      pageBoxes,
      containerRect,
      200,
    );

    expect(shapes[0]?.rects[0]?.y).toBe(210);
  });

  it('跨页的选区分成两组', () => {
    const shapes = buildSelectionShapes(
      [
        { top: 110, left: 60, width: 100, height: 20 }, // 第 1 页
        { top: 910, left: 60, width: 100, height: 20 }, // 第 2 页
      ],
      pageBoxes,
      containerRect,
      0,
    );

    expect(shapes).toHaveLength(2);
    expect(shapes[0]?.pageNumber).toBe(1);
    expect(shapes[1]?.pageNumber).toBe(2);
  });

  it('忽略零尺寸的矩形', () => {
    const shapes = buildSelectionShapes(
      [
        { top: 110, left: 60, width: 0, height: 20 },
        { top: 110, left: 60, width: 100, height: 0 },
      ],
      pageBoxes,
      containerRect,
      0,
    );

    expect(shapes).toHaveLength(0);
  });

  it('不属于任何页的矩形被丢弃', () => {
    const shapes = buildSelectionShapes(
      [{ top: 5000, left: 60, width: 100, height: 20 }],
      pageBoxes,
      containerRect,
      0,
    );

    expect(shapes).toHaveLength(0);
  });

  it('结果按页码排序', () => {
    const shapes = buildSelectionShapes(
      [
        { top: 910, left: 60, width: 100, height: 20 },
        { top: 110, left: 60, width: 100, height: 20 },
      ],
      pageBoxes,
      containerRect,
      0,
    );

    expect(shapes.map((s) => s.pageNumber)).toEqual([1, 2]);
  });
});

describe('mergeOverlappingRects', () => {
  it('空数组返回空', () => {
    expect(mergeOverlappingRects([])).toEqual([]);
  });

  it('不重叠的矩形保持不变', () => {
    const rects = [
      { x: 0, y: 0, width: 100, height: 20 },
      { x: 0, y: 30, width: 100, height: 20 },
    ];

    expect(mergeOverlappingRects(rects)).toHaveLength(2);
  });

  it('垂直重叠的矩形合并成一行', () => {
    // 同一行的两个 span: 正文(高 23) + 上标(高 17, 起点更上)
    const rects = [
      { x: 100, y: 10, width: 200, height: 23 },
      { x: 100, y: 4, width: 200, height: 17 },
    ];

    const merged = mergeOverlappingRects(rects);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({ x: 100, y: 4, width: 200, height: 29 });
  });

  it('合并后取并集（不缩小）', () => {
    const rects = [
      { x: 100, y: 10, width: 200, height: 20 },
      { x: 150, y: 12, width: 300, height: 18 },
    ];

    const merged = mergeOverlappingRects(rects);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.x).toBe(100);
    expect(merged[0]?.width).toBe(350);
  });

  it('水平不相交但垂直重叠的不合并', () => {
    const rects = [
      { x: 0, y: 0, width: 50, height: 40 },
      { x: 200, y: 0, width: 50, height: 40 },
    ];

    expect(mergeOverlappingRects(rects)).toHaveLength(2);
  });

  it('不修改入参', () => {
    const rects = [
      { x: 100, y: 10, width: 200, height: 23 },
      { x: 100, y: 4, width: 200, height: 17 },
    ];
    const snapshot = JSON.stringify(rects);

    mergeOverlappingRects(rects);

    expect(JSON.stringify(rects)).toBe(snapshot);
  });

  /*
   * ⚠️ 以下是"大长方形"bug 的回归测试。
   *
   * 真实 PDF 实测：arXiv 页边戳是 `transform: rotate(-90deg)` 的竖排文字，
   * 浏览器给它的 rect 是 `h=829`（整页高）。
   * 旧实现（只跟 `merged[last]` 比较）会让这个巨型矩形**吸收**掉
   * 所有与它垂直重叠的小矩形 → 画出一大块。
   */
  it('剔除异常高的矩形（旋转文字），不画出一大块', () => {
    const rects = [
      { x: 100, y: 10, width: 200, height: 23 }, // 正常文字行
      { x: 88, y: -460, width: 56, height: 829 }, // ← 旋转的页边戳
      { x: 300, y: 40, width: 200, height: 23 }, // 正常文字行
    ];

    const merged = mergeOverlappingRects(rects);

    // 巨型矩形被丢掉 → 不再吸收别的矩形
    expect(merged.every((r) => r.height < 100)).toBe(true);
    expect(merged).toHaveLength(2);
  });

  it('异常矩形不与正常矩形合并（高度保持正常）', () => {
    const rects = [
      { x: 100, y: 10, width: 200, height: 23 },
      { x: 95, y: 5, width: 200, height: 830 },
    ];

    const merged = mergeOverlappingRects(rects);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.height).toBe(23);
  });

  it('同一行内有空隙的片段**不合并**（避免涂到中间的空白）', () => {
    const rects = [
      { x: 0, y: 0, width: 50, height: 20 },
      { x: 200, y: 0, width: 50, height: 20 },
    ];

    const merged = mergeOverlappingRects(rects);

    // 必须保持 2 段（不能取并集变成一个 250px 宽的块）
    expect(merged).toHaveLength(2);
    expect(merged[0]?.width).toBe(50);
    expect(merged[1]?.x).toBe(200);
  });

  it('跨行的矩形**不合并成一个大块**', () => {
    const rects = [
      { x: 0, y: 0, width: 400, height: 20 },
      { x: 0, y: 30, width: 400, height: 20 },
      { x: 0, y: 60, width: 400, height: 20 },
    ];

    const merged = mergeOverlappingRects(rects);

    // 三行 → 三个矩形（不是一个 80px 高的大长方形）
    expect(merged).toHaveLength(3);
    expect(merged.every((r) => r.height <= 20)).toBe(true);
  });
});
