import { describe, expect, it } from 'vitest';
import { filterByDragOrigin, MAX_SAME_LINE_GAP } from './drag-origin';

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
    { top: 210.9, left: 1225.9, width: 9.9, height: 16.9 }, // 页边戳（离正文 780px）
  ];

  it('丢掉离正文 780px 的页边戳', () => {
    const kept = filterByDragOrigin(rects, { startX: 278, endX: 432 });

    expect(kept.some((r) => r.left > 1000)).toBe(false);
    expect(kept.length).toBeGreaterThan(0);
  });

  /*
   * ⚠️ **实测踩过的坑**（用户截图：figure caption 的多行选择）。
   *
   * 浏览器把选区**扩展到整行**（不只是行首，还有行尾）：
   * ```
   * 拖动:  x=171 → 471
   * 选区:  x=166 → 1242     ← 整行！
   * ```
   *
   * → 之前按"距离 ≤ 450px"过滤 → **行尾（473~635px 远）全被丢掉**
   * → 实测：26 个被选中的 span 里有 **9 个漏选**（"An Agent Task Protocol"、
   *   "correctness"、"spans" …）
   * → 用户看到的现象："**多行选择时中间有的没有底色**"
   */
  it('**保留行尾的延伸**（离拖动终点 600px 远也要保留）', () => {
    /*
     * ⚠️ **真实实测数据**（figure caption 的第 1 行）。
     *
     * 行内的相邻间隙**最大只有 9px**（字母之间的空格）→ 远小于阈值 60px
     * → 整行都是"同一段" → 全保留。
     */
    const line = [
      { top: 1530, left: 166, width: 106, height: 21 }, // "Figure 1: A"
      { top: 1530, left: 281, width: 370, height: 21 }, // "E provides end-to-end ev"
      { top: 1530, left: 651, width: 6, height: 21 },
      { top: 1530, left: 657, width: 19, height: 21 }, // "m"
      { top: 1530, left: 676, width: 6, height: 21 },
      { top: 1530, left: 679, width: 15, height: 21 }, // "×"
      { top: 1530, left: 696, width: 6, height: 21 },
      { top: 1530, left: 700, width: 13, height: 21 }, // "n"
      { top: 1530, left: 712, width: 6, height: 21 },
      { top: 1530, left: 719, width: 225, height: 21 }, // "benchmark–harness grid."
      { top: 1530, left: 944, width: 6, height: 21 }, // 距拖动终点 473px
      { top: 1530, left: 953, width: 26, height: 21 }, // "（a）"
      { top: 1530, left: 979, width: 6, height: 21 },
      { top: 1530, left: 985, width: 257, height: 21 }, // "An Agent Task Protocol"
    ];
    const kept = filterByDragOrigin(line, { startX: 171, endX: 471 });

    // 整行都应该保留（浏览器扩展出来的）
    expect(kept).toHaveLength(14);
  });

  it('**保留浏览器扩展到行首的部分**（离拖动起点 380px）', () => {
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
    /*
     * ⚠️ **实测形态**：页边戳是**逐字符竖排**的 → 浏览器给的是**一串**窄矩形，
     * 散落在 x=1226 附近 → 和正文之间隔着一个 ~780px 的空洞。
     */
    const withStamp = [
      { top: 381, left: 289, width: 200, height: 30 }, // 正文（和拖动范围重叠）
      { top: 381, left: 1226, width: 10, height: 23 }, // 页边戳
      { top: 381, left: 1236, width: 10, height: 23 }, // 页边戳（下一个字符）
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
      { top: 100, left: 900, width: 200, height: 15 }, // 右栏（隔着一个巨大的空洞）
    ];
    const kept = filterByDragOrigin(twoColumns, { startX: 120, endX: 250 });

    expect(kept).toHaveLength(1);
    expect(kept[0]?.left).toBe(100);
  });

  it('**同一行内、只隔着正常字距 → 保留**（哪怕离得很远）', () => {
    const contiguous = [
      { top: 100, left: 100, width: 50, height: 15 },
      { top: 100, left: 160, width: 50, height: 15 }, // 间隔 10px（正常字距）
      { top: 100, left: 220, width: 50, height: 15 },
    ];
    const kept = filterByDragOrigin(contiguous, { startX: 110, endX: 130 });

    expect(kept).toHaveLength(3);
  });

  it('**同一行内、隔着超过阈值的空洞 → 断开**', () => {
    const withHole = [
      { top: 100, left: 100, width: 50, height: 15 },
      { top: 100, left: 100 + 50 + MAX_SAME_LINE_GAP + 10, width: 50, height: 15 },
    ];
    const kept = filterByDragOrigin(withHole, { startX: 110, endX: 130 });

    expect(kept).toHaveLength(1);
    expect(kept[0]?.left).toBe(100);
  });

  it('没有拖动范围 → 原样返回（不猜）', () => {
    expect(filterByDragOrigin(rects, null)).toHaveLength(rects.length);
  });

  it('只有一个矩形 → 原样返回', () => {
    const single = [rects[0] as (typeof rects)[number]];
    expect(filterByDragOrigin(single, { startX: 180, endX: 200 })).toHaveLength(1);
  });

  it('反向拖动（从右往左）也能工作', () => {
    /*
     * ⚠️ 页边戳的 top 和正文**不同**（210.9 vs 222.5）→ 垂直上**不重叠**
     * → 属于不同的行 → 那一行没有核心 → 整行丢掉 ✅
     */
    const kept = filterByDragOrigin(rects, { startX: 432, endX: 278 });

    expect(kept.some((r) => r.left > 1000)).toBe(false);
    // 反向时也要保留行首的延伸
    expect(kept.some((r) => r.left === 175.4)).toBe(true);
  });

  it('**每一行独立判断**（一行离群不影响其他行）', () => {
    const multiRow = [
      // 第 1 行：正常
      { top: 100, left: 175, width: 100, height: 15 },
      { top: 100, left: 280, width: 100, height: 15 },
      // 第 2 行：中间隔着一个大空洞 → 只有左半段属于这次选择
      { top: 140, left: 175, width: 100, height: 15 },
      { top: 140, left: 1000, width: 100, height: 15 },
    ];
    const kept = filterByDragOrigin(multiRow, { startX: 180, endX: 250 });

    expect(kept).toHaveLength(3);
    expect(kept.some((r) => r.top === 140 && r.left === 1000)).toBe(false);
  });
});
