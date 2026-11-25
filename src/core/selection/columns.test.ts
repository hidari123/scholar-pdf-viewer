import { describe, expect, it } from 'vitest';
import { columnIndexAt, columnOfRect, computeColumns } from './columns';

/**
 * 造一页的基线。
 *
 * @param n 行数
 * @param left 左栏范围
 * @param right 右栏范围
 */
function makeTwoColumns(n: number, left: [number, number], right: [number, number]) {
  const baselines = [];
  for (let i = 0; i < n; i++) {
    // ⚠️ **两栏的行【不在同一个 y】** ✅（实测 ✅ 这才是真实情况 ✅）
    baselines.push({ top: 700 - i * 14, left: left[0], right: left[1] });
    baselines.push({ top: 693 - i * 14, left: right[0], right: right[1] });
  }
  return baselines;
}

describe('computeColumns（双栏识别 ✅）', () => {
  it('**单栏 -> 只有一栏** ✅', () => {
    const baselines = [];
    for (let i = 0; i < 20; i++) {
      baselines.push({ top: 700 - i * 14, left: 35, right: 560 });
    }
    const columns = computeColumns(baselines, 595);
    expect(columns).toHaveLength(1);
  });

  it('**双栏 -> 两栏** ✅（用实测的第 3 页数据 ✅）', () => {
    // ⚠️ **实测第 3 页** ✅：左栏 x 范围 35.9-283.9 ✅ 右栏 311-570 ✅
    const baselines = makeTwoColumns(20, [36, 284], [311, 570]);
    const columns = computeColumns(baselines, 595);
    expect(columns).toHaveLength(2);
    expect(columns[0]?.right).toBeLessThan(columns[1]?.left ?? 0);
  });

  it('**两栏的 x 范围【重叠】也能认出来** ✅（实测的真实难点 ✅）', () => {
    // ⚠️ **左栏长单词伸到 311pt** ✅ 右栏从 248pt 就开始 ✅ -> 重叠 ✅
    const baselines = makeTwoColumns(20, [36, 311], [248, 570]);
    const columns = computeColumns(baselines, 595);
    expect(columns).toHaveLength(2);
  });

  it('**三栏 -> 三栏** ✅', () => {
    const baselines = [];
    for (let i = 0; i < 20; i++) {
      baselines.push({ top: 700 - i * 14, left: 30, right: 180 });
      baselines.push({ top: 693 - i * 14, left: 210, right: 360 });
      baselines.push({ top: 686 - i * 14, left: 390, right: 550 });
    }
    const columns = computeColumns(baselines, 595);
    expect(columns).toHaveLength(3);
  });

  it('**栏的行数太少 -> 不算一栏** ✅（标题/图注 ✅）', () => {
    const baselines = makeTwoColumns(20, [36, 284], [311, 570]);
    // ⚠️ **加一条整宽的标题** ✅
    baselines.push({ top: 760, left: 36, right: 560 });
    const columns = computeColumns(baselines, 595);
    expect(columns).toHaveLength(2);
  });

  it('**空数据 -> 空数组** ✅', () => {
    expect(computeColumns([], 595)).toEqual([]);
  });

  it('**页宽为 0 -> 空数组** ✅', () => {
    expect(computeColumns(makeTwoColumns(3, [36, 284], [311, 570]), 0)).toEqual([]);
  });
});

describe('columnIndexAt / columnOfRect', () => {
  const columns = [
    { left: 36, right: 284 },
    { left: 311, right: 570 },
  ];

  it('**落在第一栏 -> 0** ✅', () => {
    expect(columnIndexAt(columns, 100)).toBe(0);
  });

  it('**落在第二栏 -> 1** ✅', () => {
    expect(columnIndexAt(columns, 400)).toBe(1);
  });

  it('**落在外面 -> -1** ✅', () => {
    expect(columnIndexAt(columns, 1000)).toBe(-1);
  });

  it('**columnOfRect 用中心点判断** ✅', () => {
    expect(columnOfRect(columns, { left: 100, right: 120 })).toBe(0);
    expect(columnOfRect(columns, { left: 400, right: 420 })).toBe(1);
  });
});
