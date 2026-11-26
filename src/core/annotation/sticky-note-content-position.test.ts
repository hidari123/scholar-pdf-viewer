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

  it('图标在右边 -> 翻到左边', () => {
    const pos = computeStickyNoteContentPosition({
      icon: { left: 900, top: 300, width: 22, height: 22 },
      size: SIZE,
      viewport: VIEWPORT,
    });
    // 右边放不下（900 + 22 + 26 + 200 > 1000 - 8）
    // -> 翻到左边：900 - 26 - 200 = 674
    expect(pos.left).toBe(674);
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
     * -> 居中：(1000 - 900) / 2 = 50
     * -> 再 clamp：max(8, min(50, 1000 - 900 - 8 = 92)) = 50
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
    // 右边放不下（480+22+26+600 > 1000-8）
    // 左边也放不下（480-26-600 < 8）
    // -> 居中：(1000-600)/2 = 200
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
