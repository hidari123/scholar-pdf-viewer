/**
 * `dom-order.ts` 的单元测试
 *
 * -> 用**纯数据**测 -> 不需要 DOM
 * -> 覆盖【反向拖选】【跨栏】【兜底】【字符级矩形分配】
 */

import { describe, expect, it } from 'vitest';
import type { ClientRectLike, DomOrderItem } from './dom-order';
import { assignRectsToItems, clipByDomOrder, compareItems, describeDomOrder } from './dom-order';

/** 造一个项 */
function item(pageNumber: number, itemIndex: number): DomOrderItem {
  return {
    pageNumber,
    itemIndex,
    rect: {
      top: 100 + itemIndex * 20,
      left: 100 + itemIndex * 10,
      width: 50,
      height: 20,
    },
  };
}

/** 造一页的 n 个项 */
function pageItems(pageNumber: number, n: number): DomOrderItem[] {
  return Array.from({ length: n }, (_, i) => item(pageNumber, i));
}

describe('clipByDomOrder（按文档顺序裁剪）', () => {
  it('单栏区间 -> 只保留区间内的项', () => {
    const items = pageItems(1, 10);
    const result = clipByDomOrder({ items, start: items[3] ?? null, end: items[6] ?? null });

    expect(result.kept).toHaveLength(4);
    expect(result.dropped).toHaveLength(6);
    expect(result.keptItems).toHaveLength(4);
  });

  it('⚠️ 反向拖选 -> 与正向【完全对称】（这是 bug 的核心）', () => {
    const items = pageItems(1, 10);
    const forward = clipByDomOrder({ items, start: items[2] ?? null, end: items[7] ?? null });
    const backward = clipByDomOrder({ items, start: items[7] ?? null, end: items[2] ?? null });

    expect(backward.kept).toHaveLength(forward.kept.length);
    expect(backward.kept).toHaveLength(6);
    expect(backward.keptItems.map((i) => i.itemIndex)).toEqual(
      forward.keptItems.map((i) => i.itemIndex),
    );
  });

  it('跨栏 -> 区间内的项全保留（左栏末尾 -> 右栏开头）', () => {
    // 一页里：左栏 0..4，右栏 5..9（文本流顺序）
    const items = pageItems(1, 10);
    const result = clipByDomOrder({ items, start: items[4] ?? null, end: items[6] ?? null });

    // 区间 4..6 -> 3 个（包含中间夹着的右栏开头）
    expect(result.kept).toHaveLength(3);
    expect(result.keptItems.map((i) => i.itemIndex)).toEqual([4, 5, 6]);
  });

  it('跨页 -> 区间连续', () => {
    const items = [...pageItems(1, 3), ...pageItems(2, 3)];
    const result = clipByDomOrder({ items, start: items[1] ?? null, end: items[4] ?? null });

    // p1[1], p1[2], p2[0], p2[1] -> 4 个
    expect(result.kept).toHaveLength(4);
  });

  it('起点不在文本层 -> 保守全保留', () => {
    const items = pageItems(1, 10);
    const result = clipByDomOrder({ items, start: null, end: items[5] ?? null });

    expect(result.kept).toHaveLength(10);
    expect(result.dropped).toHaveLength(0);
    expect(result.keptItems).toHaveLength(10);
  });

  it('找不到起点 -> 退化到【第一个项】（不是全保留）', () => {
    const items = pageItems(1, 10);
    const result = clipByDomOrder({
      items,
      start: item(9, 999), // 不存在的项
      end: items[5] ?? null,
    });

    // ⚠️ 不能全保留（旧写法会多选）
    expect(result.kept).toHaveLength(6);
    expect(result.dropped).toHaveLength(4);
  });

  it('找不到终点 -> 退化到【最后一个项】', () => {
    const items = pageItems(1, 10);
    const result = clipByDomOrder({
      items,
      start: items[5] ?? null,
      end: item(9, 999),
    });

    // 起点 index=5 -> 终点退化到 index=9 -> 5 个
    expect(result.kept).toHaveLength(5);
    expect(result.dropped).toHaveLength(5);
  });

  it('输入乱序 -> 内部按【页码 + 页内索引】排序', () => {
    const items = [item(2, 1), item(1, 3), item(1, 0), item(2, 0), item(1, 1), item(1, 2)];

    const result = clipByDomOrder({
      items,
      start: item(1, 1),
      end: item(2, 0),
    });

    // 全局序: p1[0..3], p2[0..1]
    // 区间 = p1[1] .. p2[0] -> 4 个
    expect(result.kept).toHaveLength(4);
    expect(result.dropped).toHaveLength(2);
  });

  it('空输入 -> 空结果', () => {
    const result = clipByDomOrder({ items: [], start: null, end: null });
    expect(result.kept).toHaveLength(0);
    expect(result.keptItems).toHaveLength(0);
    expect(result.dropped).toHaveLength(0);
  });

  it('同一个项做起点和终点 -> 只保留那一个', () => {
    const items = pageItems(1, 10);
    const result = clipByDomOrder({ items, start: items[4] ?? null, end: items[4] ?? null });

    expect(result.kept).toHaveLength(1);
  });

  it('⚠️ 回归：7 个视觉行 / 52 个 rect -> 一个都不丢', () => {
    // 实测（真实 PDF）：浏览器给 52 个 rect，分成 7 个视觉行
    // -> 旧实现（按垂直重叠分行）只分出 3 组 -> 整行丢失
    const rows = 7;
    const perRow = 8; // 52 / 7
    const items: DomOrderItem[] = [];
    let n = 0;
    for (let r = 0; r < rows; r += 1) {
      for (let i = 0; i < perRow; i += 1) {
        n += 1;
        items.push(item(1, n - 1));
      }
    }

    const result = clipByDomOrder({
      items,
      start: items[0] ?? null,
      end: items[items.length - 1] ?? null,
    });

    expect(result.kept).toHaveLength(items.length);
    expect(result.dropped).toHaveLength(0);
  });
});

describe('compareItems（全局顺序）', () => {
  it('先比页码', () => {
    expect(compareItems(item(1, 99), item(2, 0))).toBeLessThan(0);
  });

  it('同页再比页内序号', () => {
    expect(compareItems(item(1, 1), item(1, 2))).toBeLessThan(0);
  });

  it('完全相同 -> 0', () => {
    expect(compareItems(item(1, 1), item(1, 1))).toBe(0);
  });
});

describe('describeDomOrder（诊断信息）', () => {
  it('正常区间 -> fallback=false', () => {
    const items = pageItems(1, 10);
    const debug = describeDomOrder({ items, start: items[2] ?? null, end: items[5] ?? null });

    expect(debug.fallback).toBe(false);
    expect(debug.startIndex).toBe(2);
    expect(debug.endIndex).toBe(5);
    expect(debug.keptCount).toBe(4);
    expect(debug.droppedCount).toBe(6);
  });

  it('找不到起点 -> fallback=true', () => {
    const items = pageItems(1, 10);
    const debug = describeDomOrder({ items, start: item(9, 999), end: items[5] ?? null });

    expect(debug.fallback).toBe(true);
    expect(debug.startIndex).toBe(-1);
  });
});

describe('assignRectsToItems（字符级矩形分配）', () => {
  /** 造一个矩形 */
  function rect(left: number, top: number, width = 100, height = 20): ClientRectLike {
    return { left, top, width, height };
  }

  it('矩形落在某项内 -> 归属该项', () => {
    const items = [rect(0, 0, 100, 20), rect(0, 30, 100, 20)];
    const rangeRects = [rect(10, 5, 25, 20)];

    const map = assignRectsToItems(items, rangeRects);

    expect(map.get(0)).toHaveLength(1);
    expect(map.get(1)).toBeUndefined();
  });

  it('字符级矩形 -> 宽度小于项宽（实测：选 1 个字 w=25，项 w=411）', () => {
    const items = [rect(0, 0, 411, 49)];
    const rangeRects = [rect(207, 0, 25, 49)];

    const map = assignRectsToItems(items, rangeRects);
    const got = map.get(0);

    expect(got).toHaveLength(1);
    expect(got?.[0]?.width).toBe(25);
  });

  it('矩形跨两项的边界 -> 归属【第一个包含中心】的项', () => {
    // 两项紧挨着  （0..20 和 20..40）
    const items = [rect(0, 0, 100, 20), rect(0, 20, 100, 20)];
    // 矩形 top=12 h=20 -> 中心 y=22 -> 只在第二项里
    const rangeRects = [rect(10, 12, 25, 20)];

    const map = assignRectsToItems(items, rangeRects);

    expect(map.get(0)).toBeUndefined();
    expect(map.get(1)).toHaveLength(1);
  });

  it('矩形刚好在两项之间（都不含） -> 丢弃', () => {
    const items = [rect(0, 0, 100, 20), rect(0, 30, 100, 20)];
    // 中心 y=25 -> 两项都不含  （0..20 和 30..50）
    const rangeRects = [rect(10, 15, 25, 20)];

    const map = assignRectsToItems(items, rangeRects);

    expect(map.size).toBe(0);
  });

  it('归属不到 -> 丢弃（避免画出选区外的）', () => {
    const items = [rect(0, 0, 100, 20)];
    const rangeRects = [rect(500, 500, 25, 20)];

    const map = assignRectsToItems(items, rangeRects);

    expect(map.size).toBe(0);
  });

  it('多个矩形 -> 都归属到同一项', () => {
    const items = [rect(0, 0, 400, 20)];
    const rangeRects = [rect(10, 0, 25, 20), rect(50, 0, 25, 20)];

    const map = assignRectsToItems(items, rangeRects);

    expect(map.get(0)).toHaveLength(2);
  });

  it('空输入 -> 空结果', () => {
    expect(assignRectsToItems([], []).size).toBe(0);
    expect(assignRectsToItems([rect(0, 0)], []).size).toBe(0);
  });
});
