import { describe, expect, it } from 'vitest';
import { filterByDragOrigin, OUTLIER_DISTANCE } from './drag-origin';

describe('filterByDragOrigin', () => {
  /*
   * ⚠️ **实测数据**（真实 arXiv PDF 的页边戳）。
   *
   * 页边戳是**逐字符竖排**的（left=1226），和正文**同一视觉行**。
   */
  const rects = [
    { top: 222.5, left: 175.4, width: 45.1, height: 15.6 }, // 正文
    { top: 219.5, left: 175.4, width: 45.1, height: 20 },
    { top: 222.5, left: 220.5, width: 4.6, height: 15.6 }, // 正文
    { top: 222.5, left: 266, width: 11, height: 15.6 }, // 正文
    { top: 222.5, left: 366, width: 79, height: 15.6 }, // 正文
    { top: 210.9, left: 1225.9, width: 9.9, height: 16.9 }, // 页边戳（离正文 1000px）
  ];

  it('丢掉离正文 1000px 的页边戳', () => {
    const kept = filterByDragOrigin(rects, { startX: 278, endX: 432 });

    expect(kept.some((r) => r.left > 1000)).toBe(false);
    expect(kept.length).toBeGreaterThan(0);
  });

  /*
   * ⚠️ **实测踩过的坑**（用户反馈"多行选择时中间有的没有底色"）。
   *
   * 浏览器会把选区**扩展到行首**：
   * ```
   * 拖动:  x=487 → 607
   * 选区:  x=108 → ...      ← 左边整行都被包进来了（差 380px）
   * ```
   *
   * → 之前按"和拖动范围有重叠"过滤 → **行首那部分全被丢掉**
   * → 实测：14 个原生矩形只剩 4 个画出来了 → 中间的行没底色。
   */
  it('**保留浏览器扩展到行首的部分**（离拖动范围 380px）', () => {
    const withLineStart = [
      { top: 381, left: 108, width: 149, height: 23 }, // 行首（离拖动起点 380px）
      { top: 381, left: 289, width: 160, height: 30 }, // 拖动覆盖的部分
      { top: 381, left: 481, width: 79, height: 30 },
    ];
    const kept = filterByDragOrigin(withLineStart, { startX: 487, endX: 607 });

    expect(kept).toHaveLength(3);
    expect(kept.some((r) => r.left === 108)).toBe(true);
  });

  it('**丢掉真正的离群矩形**（离拖动范围 780px 的页边戳）', () => {
    const withStamp = [
      { top: 381, left: 289, width: 160, height: 30 },
      { top: 381, left: 1226, width: 10, height: 23 }, // 页边戳
    ];
    const kept = filterByDragOrigin(withStamp, { startX: 487, endX: 607 });

    expect(kept).toHaveLength(1);
    expect(kept[0]?.left).toBe(289);
  });

  it('页边戳在别的行时也要被丢掉', () => {
    const kept = filterByDragOrigin(rects, { startX: 278, endX: 432 });

    expect(kept.some((r) => r.left > 1000)).toBe(false);
  });

  it('同一列的多行 → 全部保留', () => {
    const column = [
      { top: 100, left: 175, width: 100, height: 15 },
      { top: 130, left: 175, width: 100, height: 15 },
      { top: 160, left: 175, width: 100, height: 15 },
    ];
    const kept = filterByDragOrigin(column, { startX: 180, endX: 250 });

    expect(kept).toHaveLength(3);
  });

  it('两栏排版：丢掉离得远的那一栏', () => {
    const twoColumns = [
      { top: 100, left: 100, width: 200, height: 15 }, // 左栏
      { top: 100, left: 900, width: 200, height: 15 }, // 右栏（离 650px → 离群）
    ];
    const kept = filterByDragOrigin(twoColumns, { startX: 120, endX: 250 });

    expect(kept).toHaveLength(1);
    expect(kept[0]?.left).toBe(100);
  });

  it('距离刚好在阈值上 → 保留', () => {
    const edge = [
      { top: 100, left: 100, width: 100, height: 15 },
      { top: 100, left: 100 + 100 + OUTLIER_DISTANCE, width: 100, height: 15 },
    ];
    const kept = filterByDragOrigin(edge, { startX: 120, endX: 200 });

    expect(kept).toHaveLength(2);
  });

  it('没有拖动范围 → 原样返回（不猜）', () => {
    expect(filterByDragOrigin(rects, null)).toHaveLength(rects.length);
  });

  it('只有一个矩形 → 原样返回', () => {
    const single = [rects[0] as (typeof rects)[number]];
    expect(filterByDragOrigin(single, { startX: 180, endX: 200 })).toHaveLength(1);
  });

  it('反向拖动（从右往左）也能工作', () => {
    const kept = filterByDragOrigin(rects, { startX: 432, endX: 278 });

    expect(kept.some((r) => r.left > 1000)).toBe(false);
  });
});
