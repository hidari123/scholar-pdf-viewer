/**
 * 重叠高亮的命中判定（用户需求）。
 *
 * > "如果两个高亮叠加在一起 删除的话两个都一起删掉了 逻辑不对
 * >  比如说 a和b有部分重叠了，如果是全部重叠 则不能进行再次高亮，
 * >  各种操作还是在原有高亮进行，如果部分重叠，重叠部分为c，
 * >  点击a独有部分，则选中a，点击b独有部分则选中b，
 * >  选中重叠部分c则谁在上面选中的是谁。"
 */

import { describe, expect, it } from 'vitest';
import {
  hitsAtPoint,
  isFullyOverlapping,
  isPartiallyOverlapping,
  isSameRect,
  pickHighlightAtPoint,
  pickHighlightByRect,
} from './hit-test';

describe('hitsAtPoint（点命中了哪些高亮）', () => {
  it('**点在空白 → 一个都没命中**', () => {
    const hits = hitsAtPoint(500, 500, [
      { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 0 },
    ]);
    expect(hits).toHaveLength(0);
  });

  it('**点在一个高亮里 → 命中它**', () => {
    const hits = hitsAtPoint(150, 110, [
      { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 0 },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe('a');
    expect(hits[0]?.isOverlapping).toBe(false);
  });

  it('**点在重叠部分 → 命中两个，且标记为重叠**', () => {
    const hits = hitsAtPoint(150, 110, [
      { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 0 },
      { id: 'b', left: 150, top: 100, width: 100, height: 20, zIndex: 1 },
    ]);
    expect(hits).toHaveLength(2);
    expect(hits.every((h) => h.isOverlapping)).toBe(true);
    expect(hits[0]?.overlappingIds).toEqual(['a', 'b']);
  });

  /*
   * ⚠️ **命中结果要带上【矩形】**（第 27 轮加的）。
   *
   * -> 宿主可能传了**重复的 id** ❌
   * -> 按 id 找 DOM 元素 -> 找到**第一个** ❌
   * -> 按**矩形**找 -> **精确到那一个** ✅
   */
  it('**命中结果带上那个矩形**（用来精确定位 DOM 元素）', () => {
    const rect = { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 0 };
    const hits = hitsAtPoint(150, 110, [rect]);
    expect(hits[0]?.rect).toEqual(rect);
  });

  it('**重复 id 的两个高亮 -> 各自的矩形不同**', () => {
    // ⚠️ **两个矩形有重叠** -> 同一个点能同时命中两个 ✅
    const rects = [
      { id: 'dup', left: 100, top: 100, width: 200, height: 20, zIndex: 0 },
      { id: 'dup', left: 200, top: 100, width: 200, height: 20, zIndex: 1 },
    ];
    const hits = hitsAtPoint(250, 110, rects);
    expect(hits).toHaveLength(2);
    // ⚠️ **id 相同，但矩形不同** -> 靠矩形区分 ✅
    expect(hits[0]?.rect.left).not.toBe(hits[1]?.rect.left);
  });

  /*
   * ⚠️ **`isSameRect`**（用来消歧重复 id 的高亮）。
   */
  it('**同一个矩形 -> true**', () => {
    expect(
      isSameRect(
        { left: 100, top: 100, width: 50, height: 20 },
        { left: 100, top: 100, width: 50, height: 20 },
      ),
    ).toBe(true);
  });

  it('**位置差 1px 以内 -> true**（容差）', () => {
    expect(
      isSameRect(
        { left: 100, top: 100, width: 50, height: 20 },
        { left: 100.5, top: 99.8, width: 50, height: 20 },
      ),
    ).toBe(true);
  });

  it('**位置差超过容差 -> false**', () => {
    expect(
      isSameRect(
        { left: 100, top: 100, width: 50, height: 20 },
        { left: 300, top: 100, width: 50, height: 20 },
      ),
    ).toBe(false);
  });

  it('**尺寸不同 -> false**', () => {
    expect(
      isSameRect(
        { left: 100, top: 100, width: 50, height: 20 },
        { left: 100, top: 100, width: 80, height: 20 },
      ),
    ).toBe(false);
  });

  /*
   * ⚠️ **`pickHighlightByRect`**（消歧重复 id 的高亮）。
   */
  it('**只有一个候选 -> 直接返回它**', () => {
    const result = pickHighlightByRect(
      [{ name: 'a' }],
      { left: 0, top: 0, width: 1, height: 1 },
      () => null,
    );
    expect(result?.name).toBe('a');
  });

  it('**多个候选 -> 按矩形挑出对得上的那个**', () => {
    const candidates = [
      { name: 'a', x: 100 },
      { name: 'b', x: 300 },
    ];
    const result = pickHighlightByRect(
      candidates,
      { left: 300, top: 0, width: 50, height: 20 },
      (c) => ({ left: c.x, top: 0, width: 50, height: 20 }),
    );
    // ⚠️ **必须挑 "b"**（不是第一个）✅
    expect(result?.name).toBe('b');
  });

  it('**都对不上 -> 退回第一个**（老行为）', () => {
    const candidates = [{ name: 'a' }, { name: 'b' }];
    const result = pickHighlightByRect(
      candidates,
      { left: 999, top: 999, width: 1, height: 1 },
      () => ({ left: 0, top: 0, width: 1, height: 1 }),
    );
    expect(result?.name).toBe('a');
  });

  it('**没有候选 -> undefined**', () => {
    const result = pickHighlightByRect([], { left: 0, top: 0, width: 1, height: 1 }, () => null);
    expect(result).toBeUndefined();
  });

  it('**结果按"从上到下"排序**（zIndex 大的在前）', () => {
    const hits = hitsAtPoint(150, 110, [
      { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 0 },
      { id: 'b', left: 150, top: 100, width: 100, height: 20, zIndex: 5 },
    ]);
    expect(hits[0]?.id).toBe('b');
  });
});

describe('pickHighlightAtPoint（该选中哪个）', () => {
  const rects = [
    // a：x 100~200
    { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 0 },
    // b：x 150~250（和 a 部分重叠，重叠区 = 150~200）
    { id: 'b', left: 150, top: 100, width: 100, height: 20, zIndex: 1 },
  ];

  it('**点 a 的独有部分 → 选 a**', () => {
    const hit = pickHighlightAtPoint(120, 110, rects);
    expect(hit?.id).toBe('a');
    expect(hit?.isOverlapping).toBe(false);
  });

  it('**点 b 的独有部分 → 选 b**', () => {
    const hit = pickHighlightAtPoint(220, 110, rects);
    expect(hit?.id).toBe('b');
    expect(hit?.isOverlapping).toBe(false);
  });

  it('**点重叠部分 c → 选在上面那个（b）**', () => {
    const hit = pickHighlightAtPoint(170, 110, rects);
    expect(hit?.id).toBe('b');
    expect(hit?.isOverlapping).toBe(true);
  });

  it('**交换层级 → 点重叠部分选另一个**', () => {
    const swapped = [
      { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 9 },
      { id: 'b', left: 150, top: 100, width: 100, height: 20, zIndex: 1 },
    ];
    const hit = pickHighlightAtPoint(170, 110, swapped);
    expect(hit?.id).toBe('a');
  });

  it('**完全重叠 → 下面的永远选不到**', () => {
    const same = [
      { id: 'a', left: 100, top: 100, width: 100, height: 20, zIndex: 0 },
      { id: 'b', left: 100, top: 100, width: 100, height: 20, zIndex: 1 },
    ];
    const hit = pickHighlightAtPoint(150, 110, same);
    expect(hit?.id).toBe('b');
    expect(hit?.isOverlapping).toBe(true);
  });

  it('**没命中 → null**', () => {
    expect(pickHighlightAtPoint(500, 500, rects)).toBeNull();
  });
});

describe('重叠判定', () => {
  it('**完全重叠**', () => {
    expect(
      isFullyOverlapping(
        { left: 100, top: 100, width: 100, height: 20 },
        { left: 100, top: 100, width: 100, height: 20 },
      ),
    ).toBe(true);
  });

  it('**位置差 1px → 算完全重叠**（容差内）', () => {
    expect(
      isFullyOverlapping(
        { left: 100, top: 100, width: 100, height: 20 },
        { left: 100.5, top: 100, width: 100, height: 20 },
      ),
    ).toBe(true);
  });

  it('**位置差很多 → 不算完全重叠**', () => {
    expect(
      isFullyOverlapping(
        { left: 100, top: 100, width: 100, height: 20 },
        { left: 150, top: 100, width: 100, height: 20 },
      ),
    ).toBe(false);
  });

  it('**部分重叠**', () => {
    expect(
      isPartiallyOverlapping(
        { left: 100, top: 100, width: 100, height: 20 },
        { left: 150, top: 100, width: 100, height: 20 },
      ),
    ).toBe(true);
  });

  it('**完全重叠 → 不是"部分重叠"**', () => {
    expect(
      isPartiallyOverlapping(
        { left: 100, top: 100, width: 100, height: 20 },
        { left: 100, top: 100, width: 100, height: 20 },
      ),
    ).toBe(false);
  });

  it('**不相交 → 不是部分重叠**', () => {
    expect(
      isPartiallyOverlapping(
        { left: 100, top: 100, width: 50, height: 20 },
        { left: 300, top: 100, width: 50, height: 20 },
      ),
    ).toBe(false);
  });
});
