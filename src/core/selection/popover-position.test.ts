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

  /*
   * ⚠️⚠️ **吸附（sticky）模式**（审计修复：用户反馈"往下滚动工具栏也会消失"）。
   */
  describe('吸附（sticky）', () => {
    /** 视口（和容器一样，方便对照） */
    const viewport = { left: 0, top: 0, right: 1100, bottom: 900 };

    it('**选区完全在视口上方 -> 吸到容器顶部**（不消失）', () => {
      const result = computePopoverPosition({
        // 选区整个滚出去了（上方）
        selection: { left: 500, top: -300, right: 700, bottom: -280 },
        toolbar,
        container,
        viewport,
      });

      expect(result.placement).toBe('sticky-top');
      // 吸在容器顶部 + margin(8)
      expect(result.top).toBe(container.top + 8);
    });

    it('**选区完全在视口下方 -> 吸到容器底部**（不消失）', () => {
      const result = computePopoverPosition({
        selection: { left: 500, top: 1000, right: 700, bottom: 1020 },
        toolbar,
        container,
        viewport,
      });

      expect(result.placement).toBe('sticky-bottom');
      expect(result.top).toBe(container.bottom - toolbar.height - 8);
    });

    it('**选区部分可见 -> 正常贴着（不吸）**', () => {
      const result = computePopoverPosition({
        // 选区底部刚好在视口内
        selection: { left: 500, top: 850, right: 700, bottom: 870 },
        toolbar,
        container,
        viewport,
      });

      expect(result.placement).not.toBe('sticky-top');
      expect(result.placement).not.toBe('sticky-bottom');
    });

    it('**选区刚好在视口顶部 -> 不算"滚出去了"**', () => {
      const result = computePopoverPosition({
        selection: { left: 500, top: 0, right: 700, bottom: 20 },
        toolbar,
        container,
        viewport,
      });

      expect(result.placement).not.toBe('sticky-top');
    });

    /*
     * ⚠️ **回归守卫**：跨页时浮层不能"贴到视口底"（和选区脱节）。
     *
     * -> 之前跨页会用**并集矩形** -> bottom 巨大 -> 两边都放不下
     *    -> clamp 到视口底 -> **浮层和选区完全脱节** ❌
     */
    it('**跨页的并集矩形不会让浮层脱节到视口底**（锚点是最后一行）', () => {
      /*
       * 模拟：锚点 = 跨页选区的**最后一行**（在视口内）✅
       * -> 如果浮层还贴在视口底 -> 说明又用了并集矩形 ❌
       */
      const lastLine = { left: 500, top: 800, right: 700, bottom: 820 };
      const result = computePopoverPosition({
        selection: lastLine,
        toolbar,
        container,
        viewport,
      });

      // 浮层应该在选区附近（820 + gap 8 = 828），不是视口底 ❌
      expect(result.top).toBe(828);
      expect(result.top).toBeLessThan(viewport.bottom - toolbar.height);
    });
  });
});
