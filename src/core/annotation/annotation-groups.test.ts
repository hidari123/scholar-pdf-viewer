/**
 * 批注分组的测试。
 *
 * 用户需求：
 * > "如果要批注的内容在同一行呢 别的软件是怎么处理的这个逻辑 你调研一下
 * >  目前这两个批注会叠在一起 我认为可以只出现一个图标 然后悬浮在图标上可以选择批注几"
 */

import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_GROUP_TOLERANCE,
  groupAnnotations,
  horizontalGap,
  isSameRow,
  unionAnchor,
  verticalOverlap,
} from './annotation-groups';

/** 造一个带锚点的批注 */
function item(id: string, left: number, top: number, width = 100, height = 18) {
  return { id, left, top, width, height };
}

describe('批注分组（同一行 → 一个图标）', () => {
  it('**同一行的两个批注 → 合成一组**', () => {
    const groups = groupAnnotations([item('a', 100, 200), item('b', 220, 202)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.annotations.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('**不同行的批注 → 分开**', () => {
    const groups = groupAnnotations([
      item('a', 100, 200),
      item('b', 100, 240), // 差 40px（行距）
    ]);

    expect(groups).toHaveLength(2);
  });

  it('**同一行但水平相距很远 → 分开**（不能把整页并成一组）', () => {
    const groups = groupAnnotations([item('a', 100, 200), item('b', 900, 200)]);

    expect(groups).toHaveLength(2);
  });

  it('**三个批注在同一行 → 一组**', () => {
    const groups = groupAnnotations([
      item('a', 100, 200),
      item('b', 220, 201),
      item('c', 340, 199),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.annotations).toHaveLength(3);
  });

  it('**组内按水平位置排序**（图标从左到右）', () => {
    const groups = groupAnnotations([
      item('c', 340, 200),
      item('a', 100, 200),
      item('b', 220, 200),
    ]);

    expect(groups[0]?.annotations.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('**组的锚点是所有成员的并集**', () => {
    const groups = groupAnnotations([item('a', 100, 200, 50, 18), item('b', 220, 200, 80, 18)]);

    const anchor = groups[0]?.anchor;
    expect(anchor?.left).toBe(100);
    expect(anchor?.top).toBe(200);
    expect(anchor?.width).toBe(200); // 100 → 300
    expect(anchor?.height).toBe(18);
  });

  it('**空输入 → 空结果**', () => {
    expect(groupAnnotations([])).toEqual([]);
  });

  it('**单个批注 → 一组**', () => {
    const groups = groupAnnotations([item('a', 100, 200)]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.annotations).toHaveLength(1);
  });
});

describe('同一行的判定（isSameRow）', () => {
  it('**垂直重叠 > 50% → 同一行**', () => {
    // 高 18，重叠 15 → 83%
    expect(
      isSameRow(
        { left: 0, top: 200, width: 10, height: 18 },
        { left: 0, top: 203, width: 10, height: 18 },
      ),
    ).toBe(true);
  });

  it('**垂直重叠 < 50% → 不同行**', () => {
    // 高 18，重叠 7 → 39%
    expect(
      isSameRow(
        { left: 0, top: 200, width: 10, height: 18 },
        { left: 0, top: 211, width: 10, height: 18 },
      ),
    ).toBe(false);
  });

  it('**完全不相交 → 不同行**', () => {
    expect(
      isSameRow(
        { left: 0, top: 200, width: 10, height: 18 },
        { left: 0, top: 300, width: 10, height: 18 },
      ),
    ).toBe(false);
  });
});

describe('辅助函数', () => {
  it('**verticalOverlap 算重叠高度**', () => {
    expect(
      verticalOverlap(
        { left: 0, top: 200, width: 10, height: 18 },
        { left: 0, top: 203, width: 10, height: 18 },
      ),
    ).toBe(15);
  });

  it('**horizontalGap 重叠时是 0**（不是负数）', () => {
    expect(
      horizontalGap(
        { left: 100, top: 0, width: 50, height: 10 },
        { left: 120, top: 0, width: 50, height: 10 },
      ),
    ).toBe(0);
  });

  it('**horizontalGap 算间隙**', () => {
    expect(
      horizontalGap(
        { left: 100, top: 0, width: 50, height: 10 },
        { left: 200, top: 0, width: 50, height: 10 },
      ),
    ).toBe(50);
  });

  it('**unionAnchor 合并矩形**', () => {
    const union = unionAnchor([
      { left: 100, top: 200, width: 50, height: 18 },
      { left: 220, top: 210, width: 80, height: 20 },
    ]);

    expect(union).toEqual({ left: 100, top: 200, width: 200, height: 30 });
  });

  it('**unionAnchor 空数组 → 全 0**', () => {
    expect(unionAnchor([])).toEqual({ left: 0, top: 0, width: 0, height: 0 });
  });

  it('**容差常量合理**（同一行的阈值）', () => {
    // 垂直重叠 50% → 同行
    expect(ANNOTATION_GROUP_TOLERANCE.verticalOverlapRatio).toBe(0.5);
    // 水平 120px → 差不多一行
    expect(ANNOTATION_GROUP_TOLERANCE.horizontalDistance).toBe(120);
  });
});
