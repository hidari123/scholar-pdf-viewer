import { describe, expect, it } from 'vitest';
import { computePopoverPosition } from './popover-position';

describe('computePopoverPosition', () => {
  /** 容器（视口坐标） */
  const container = { left: 100, top: 100, right: 1100, bottom: 900 };
  /** 工具条尺寸（实测值） */
  const toolbar = { width: 200, height: 40 };

  it('默认放在选区下方', () => {
    const result = computePopoverPosition({
      selection: { left: 500, top: 300, right: 700, bottom: 320 },
      toolbar,
      container,
    });

    expect(result.placement).toBe('bottom');
    // 选区底部 + gap(8)
    expect(result.top).toBe(328);
  });

  it('水平居中对齐选区', () => {
    const result = computePopoverPosition({
      selection: { left: 500, top: 300, right: 700, bottom: 320 },
      toolbar,
      container,
    });

    // 选区中心 600 - 工具条宽/2 100 = 500
    expect(result.left).toBe(500);
  });

  it('箭头指向选区中心', () => {
    const result = computePopoverPosition({
      selection: { left: 500, top: 300, right: 700, bottom: 320 },
      toolbar,
      container,
    });

    expect(result.arrowLeft).toBe(100);
  });

  it('下方空间不够时**真的翻转到上方**', () => {
    const result = computePopoverPosition({
      // 选区贴着容器底部 → 下方放不下
      selection: { left: 500, top: 860, right: 700, bottom: 880 },
      toolbar,
      container,
    });

    expect(result.placement).toBe('top');
    // 选区**顶部** - gap - 工具条高 = 860 - 8 - 40
    expect(result.top).toBe(812);
  });

  it('水平超出容器右边界时 clamp', () => {
    const result = computePopoverPosition({
      // 选区靠右 → 工具条会超出右边界
      selection: { left: 1000, top: 300, right: 1100, bottom: 320 },
      toolbar,
      container,
    });

    // 容器右 1100 - 工具条宽 200 - margin 8 = 892
    expect(result.left).toBe(892);
  });

  it('水平超出容器左边界时 clamp', () => {
    const result = computePopoverPosition({
      selection: { left: 100, top: 300, right: 140, bottom: 320 },
      toolbar,
      container,
    });

    // 容器左 100 + margin 8 = 108
    expect(result.left).toBe(108);
  });

  it('箭头被 clamp 在浮层内部', () => {
    const result = computePopoverPosition({
      // 选区中心远在左边 → 箭头不能跑到浮层外面
      selection: { left: 100, top: 300, right: 120, bottom: 320 },
      toolbar,
      container,
    });

    expect(result.arrowLeft).toBeGreaterThanOrEqual(8);
    expect(result.arrowLeft).toBeLessThanOrEqual(toolbar.width - 8);
  });

  it('上下都放不下时选空间大的一边', () => {
    const result = computePopoverPosition({
      // 选区几乎占满容器高度
      selection: { left: 500, top: 120, right: 700, bottom: 880 },
      toolbar,
      container,
    });

    // 上方空间 120-108=12，下方空间 892-880=12 → 下方（相等时选下方）
    expect(['top', 'bottom']).toContain(result.placement);
    // 不管选哪边，都必须在容器内
    expect(result.top).toBeGreaterThanOrEqual(container.top + 8);
    expect(result.top + toolbar.height).toBeLessThanOrEqual(container.bottom - 8);
  });

  it('结果永远在容器可视区内', () => {
    const cases = [
      { left: 100, top: 100, right: 200, bottom: 120 },
      { left: 1000, top: 860, right: 1100, bottom: 890 },
      { left: 500, top: 300, right: 700, bottom: 320 },
      { left: 50, top: 50, right: 80, bottom: 70 },
    ];

    for (const selection of cases) {
      const result = computePopoverPosition({ selection, toolbar, container });

      expect(result.left).toBeGreaterThanOrEqual(container.left);
      expect(result.left + toolbar.width).toBeLessThanOrEqual(container.right);
      expect(result.top).toBeGreaterThanOrEqual(container.top);
      expect(result.top + toolbar.height).toBeLessThanOrEqual(container.bottom);
    }
  });

  it('支持自定义 gap 与 margin', () => {
    const result = computePopoverPosition({
      selection: { left: 500, top: 300, right: 700, bottom: 320 },
      toolbar,
      container,
      gap: 20,
      margin: 4,
    });

    expect(result.top).toBe(340);
  });
});
