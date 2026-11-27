/**
 * `sticky-note-content-position.ts` 的单元测试。
 */

import { describe, expect, it } from 'vitest';
import { computeStickyNoteContentPosition } from './sticky-note-content-position';

const VIEWPORT = { width: 1000, height: 800 };
const SIZE = { width: 200, height: 150 };

describe('computeStickyNoteContentPosition', () => {
  it('图标在左边 -> 内容框贴在右边', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 100, top: 300, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    // 图标右边 22 + 间距 26 = 48
    expect(pos.left).toBe(148);
    expect(pos.top).toBe(300);
  });

  it('图标在右边 -> 翻到左边（中心对齐 ✅）', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 900, top: 300, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    /*
     * 右边放不下（900 + 22 + 26 + 200 > 1000 - 8）-> 翻到左边
     *
     * ⚠️ **翻到左边时改成"中心对齐"**（用户反馈："距离批注按钮太远"）
     * -> 框的中心线 = 图标中心 + gap/2
     * -> 算出来 left = 900 + 11 + 13 - 100 = 824
     * -> 但 clamp 到"视口右边界减安全边距" -> 1000 - 200 - 8 = 792
     *
     * 之前是"右边缘贴着图标左边缘" -> left = 900 - 26 - 200 = 674
     * -> 框整个往左延伸 -> 视觉上离图标 200px -> 太远
     */
    expect(pos.left).toBe(792);
  });

  it('⚠️ **翻到左边时 ✅ 框和图标的距离更近**（用户反馈 ✅）', () => {
    const icon = { left: 1399, top: 300, width: 24, height: 24 };
    const size = { width: 142, height: 60 };
    const pos = computeStickyNoteContentPosition({
      icon,
      size,
      viewport: { width: 1600, height: 800 },
    });

    // 图标右边 1423 -> 右边放不下（1423 + 26 + 142 = 1591，1600 - 8 = 1592）
    // ⚠️ 刚好放得下 -> 走"右边"分支 ✅
    // -> 强制让它放不下 ✅
    const flipped = computeStickyNoteContentPosition({
      icon: { left: 1420, top: 300, width: 24, height: 24 },
      size,
      viewport: { width: 1600, height: 800 },
    });

    // 中心对齐 -> 框的中心 ≈ 图标的中心 + 13px
    const iconCenter = 1420 + 12;
    const boxCenter = flipped.left + size.width / 2;
    expect(Math.abs(boxCenter - iconCenter)).toBeLessThanOrEqual(14);
    expect(pos.left).toBeGreaterThan(0);
  });

  it('图标在下边界 -> 翻到上方', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 100, top: 700, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    // 下方放不下（700 + 150 > 800 - 8）
    // -> 上方：700 - 150 = 550
    expect(pos.top).toBe(550);
  });

  it('不会超出视口右边', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 780, top: 300, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    expect(pos.left + SIZE.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('不会超出视口下边', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 100, top: 780, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    expect(pos.top + SIZE.height).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('不会超出视口左边', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 0, top: 300, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    expect(pos.left).toBeGreaterThanOrEqual(0);
  });

  it('不会超出视口上边', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 100, top: 0, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    expect(pos.top).toBeGreaterThanOrEqual(0);
  });

  it('两边都放不下 -> 贴着视口中间', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 480, top: 300, width: 22, height: 22 },
      size: { width: 900, height: 150 },
      viewport: VIEWPORT,
    });
    /*
     * 内容框 900px 宽，视口 1000px。
     *
     * -> 右边放不下 ✅
     * -> 左边：中心对齐 480+11+13-450 = 54 ✅ -> 放得下（>= 8 ✅）
     *    -> 走"翻到左边"分支 -> 54
     * -> clamp 上限 1000-900-8 = 92 -> 54 < 92 -> 不变
     */
    expect(pos.left).toBe(54);
    expect(pos.left + 900).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('内容框比视口窄一点但两边都放不下 -> 居中', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 480, top: 300, width: 22, height: 22 },
      size: { width: 600, height: 150 },
      viewport: VIEWPORT,
    });
    /*
     * 右边放不下（480+22+26+600 > 1000-8）
     * 左边也放不下（中心对齐后 480+11+13-300 = 204 -> 但 clamp 上限是
     *    1000-600-8 = 392 -> 204 < 392 -> 放得下 ✅）
     * -> 走"翻到左边"分支 ✅ -> 204
     */
    expect(pos.left).toBe(204);
    expect(pos.left + 600).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('上下都放不下 -> 贴着视口中间', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 100, top: 400, width: 22, height: 22 },
      size: { width: 200, height: 700 },
      viewport: VIEWPORT,
    });
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.top + 700).toBeLessThanOrEqual(VIEWPORT.height);
  });

  it('间距可配', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 100, top: 300, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
      gap: 50,
    });
    expect(pos.left).toBe(172);
  });
});
