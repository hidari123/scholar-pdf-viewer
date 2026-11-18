import { describe, expect, it } from 'vitest';
import { filterByDragOrigin, MAX_COLUMN_GAP } from './drag-origin';

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

  it('页边戳在别的行时也要被丢掉（水平不重叠）', () => {
    const kept = filterByDragOrigin(rects, { startX: 278, endX: 432 });

    expect(kept.some((r) => r.left > 1000)).toBe(false);
  });

  it('**保留拖动范围右边的文字**（浏览器扩展到词边界）', () => {
    // 拖动 278→432，浏览器把选区扩展到 175~445
    const kept = filterByDragOrigin(rects, { startX: 278, endX: 432 });

    // 366~445 那段要保留（用户拖过去了）
    expect(kept.some((r) => r.left === 366)).toBe(true);
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

  it('两栏排版：只保留和拖动范围重叠的那一栏', () => {
    const twoColumns = [
      { top: 100, left: 100, width: 200, height: 15 }, // 左栏
      { top: 100, left: 500, width: 200, height: 15 }, // 右栏
    ];
    const kept = filterByDragOrigin(twoColumns, { startX: 120, endX: 250 });

    expect(kept).toHaveLength(1);
    expect(kept[0]?.left).toBe(100);
  });

  it('小间隙（< MAX_COLUMN_GAP）算同一段 → 都保留', () => {
    const tight = [
      { top: 100, left: 100, width: 100, height: 15 },
      { top: 100, left: 100 + 100 + MAX_COLUMN_GAP - 2, width: 100, height: 15 },
    ];
    const kept = filterByDragOrigin(tight, { startX: 120, endX: 200 });

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
