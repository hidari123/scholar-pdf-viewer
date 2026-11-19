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
  pickHighlightAtPoint,
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
