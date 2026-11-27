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
    expect(pos.left).toBe(140);
    expect(pos.top).toBe(300);
  });

  it('图标在右边 -> 翻到左边（边缘对齐 ✅ 不重叠 ✅）', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 900, top: 300, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    /*
     * 右边放不下（900 + 22 + 18 + 200 > 1000 - 8）-> 翻到左边
     *
     * ⚠️ **边缘对齐**（不重叠 ✅）
     * -> 框的右边缘 = 图标的左边缘 - gap = 900 - 18 = 882
     * -> left = 882 - 200 = 682
     * -> 再 clamp 到"视口右边界减安全边距" -> 1000 - 200 - 8 = 792
     * -> 取小 -> 682
     *
     * ⚠️ 之前试过"中心对齐" ❌
     * -> 框中心离图标中心只有 13px ❌ -> 整个盖住图标 ❌
     * -> 用户反馈："离得又太近了 已经重叠上去了" ❌
     */
    expect(pos.left).toBe(682);
  });

  it('⚠️ **翻到左边时和图标不重叠**（用户反馈 ✅）', () => {
    const icon = { left: 1420, top: 300, width: 24, height: 24 };
    const size = { width: 142, height: 60 };
    const pos = computeStickyNoteContentPosition({
      icon,
      size,
      viewport: { width: 1600, height: 800 },
    });

    // 右边放不下（1420 + 24 + 18 + 142 = 1604 > 1600 - 8）-> 翻到左边 ✅
    // -> 框的右边缘 = 图标左边缘 - 18 = 1402 ✅
    const boxRight = pos.left + size.width;
    expect(boxRight).toBeLessThanOrEqual(icon.left);
    // 边缘间距 = gap = 18 ✅
    expect(icon.left - boxRight).toBe(18);
    expect(pos.left).toBe(1260);
  });

  it('⚠️ **翻到左边时 ✅ 框和图标不重叠**（用户反馈 ✅）', () => {
    const icon = { left: 1420, top: 300, width: 24, height: 24 };
    const size = { width: 142, height: 60 };
    const flipped = computeStickyNoteContentPosition({
      icon,
      size,
      viewport: { width: 1600, height: 800 },
    });

    // ⚠️ **不能重叠**（用户反馈："离得又太近了 已经重叠上去了"）
    const boxRight = flipped.left + size.width;
    expect(boxRight).toBeLessThanOrEqual(icon.left);
    expect(icon.left - boxRight).toBeGreaterThanOrEqual(15);
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
     * -> 左边：边缘对齐 480-18-900 = -438 ✅ -> 放不下（< 8 ✅）
     *    -> 走"居中"分支 ✅
     * -> 居中：(1000-900)/2 = 50 ✅ -> clamp 后还是 50 ✅
     */
    expect(pos.left).toBe(50);
    expect(pos.left + 900).toBeLessThanOrEqual(VIEWPORT.width);
  });

  it('内容框比视口窄一点但两边都放不下 -> 居中', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 480, top: 300, width: 22, height: 22 },
      size: { width: 600, height: 150 },
      viewport: VIEWPORT,
    });
    /*
     * 右边放不下（480+22+18+600 > 1000-8）✅
     * 左边也放不下（边缘对齐 480-18-600 = -138 < 8 ✅）
     * -> 走"居中"分支 ✅ -> (1000-600)/2 = 200 ✅
     */
    expect(pos.left).toBe(200);
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
