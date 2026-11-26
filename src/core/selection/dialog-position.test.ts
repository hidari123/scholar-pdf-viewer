import { describe, expect, it } from 'vitest';
import { computeDialogPosition, dialogSafeMargin } from './dialog-position';

/**
 * `core/selection/dialog-position` 的单元测试。
 *
 * ## 为什么重要（审计发现的）
 *
 * -> 用户反馈："如果批注在这一行最右边 打开编辑批注的框过于靠右
 *   已经贴着最右边了 需要往中间来点" ❌
 *
 * -> 之前 \`safeMargin = margin * 2 = 24\` ❌
 *   -> 480px 弹窗 + 24px 右边距 -> **几乎贴着屏幕边** ❌
 *
 * -> 现在：
 *   1. **安全边距跟视口宽度成比例**
 *   2. **锚点靠右时按右边缘对齐**（左边缘对齐必然贴边）
 *
 * ⚠️ **之前这个逻辑内嵌在组件里** -> jsdom 没布局 -> **没法单测** ❌
 * -> 现在抽成**纯函数** -> **可以单测**
 */

describe('dialogSafeMargin', () => {
  it('**安全边距跟视口宽度成比例**', () => {
    // 1500 * 0.06 = 90
    expect(dialogSafeMargin(1500)).toBe(90);
    // 800 * 0.06 = 48 -> 但最小是 48
    expect(dialogSafeMargin(800)).toBe(48);
    // 3000 * 0.06 = 180 -> 但最大是 96
    expect(dialogSafeMargin(3000)).toBe(96);
    // 极窄
    expect(dialogSafeMargin(300)).toBe(48);
  });

  it('**永远不小于 48px**（之前只有 24px）', () => {
    for (const w of [200, 400, 600, 800, 1000]) {
      expect(dialogSafeMargin(w)).toBeGreaterThanOrEqual(48);
    }
  });

  it('**永远不大于 96px**（超宽屏不夸张）', () => {
    for (const w of [1600, 2000, 3000, 5000]) {
      expect(dialogSafeMargin(w)).toBeLessThanOrEqual(96);
    }
  });
});

describe('computeDialogPosition', () => {
  /** 弹窗尺寸（实测） */
  const size = { width: 480, height: 300 };

  it('**锚点在最右边 -> 按右边缘对齐（往中间来）**', () => {
    const result = computeDialogPosition({
      anchor: { left: 1000, top: 300, right: 1490, bottom: 320 },
      size,
      viewport: { width: 1500, height: 950 },
    });

    /*
     * -> 右边缘对齐 -> 期望 left = 1490 - 480 = 1010
     * -> 但 **安全区** 是 1500 - 480 - 90 = 930 -> 1010 超出 -> **clamp 到 930**
     *   （锚点太靠右时，弹窗不能跟着贴边 -> 这正是用户要的"往中间来点"）
     */
    expect(result.left).toBe(930);
    // 弹窗右边离视口右边 90px
    expect(1500 - (result.left + size.width)).toBe(90);
    expect(1500 - (result.left + size.width)).toBeGreaterThanOrEqual(48);
  });

  it('**锚点贴到视口最右 -> 弹窗留出安全边距（不贴边）**', () => {
    const result = computeDialogPosition({
      anchor: { left: 1480, top: 300, right: 1500, bottom: 320 },
      size,
      viewport: { width: 1500, height: 950 },
    });

    // 右边缘对齐会得到 1500 - 480 = 1020 -> **超出安全区** -> clamp 到 930
    expect(result.left).toBe(930);
    // 右边距 >= 48
    expect(1500 - (result.left + size.width)).toBeGreaterThanOrEqual(48);
  });

  it('**锚点在左半边 -> 按左边缘对齐**', () => {
    const result = computeDialogPosition({
      anchor: { left: 300, top: 300, right: 500, bottom: 320 },
      size,
      viewport: { width: 1500, height: 950 },
    });

    expect(result.left).toBe(300);
  });

  it('**锚点贴到视口最左 -> 留出安全边距**', () => {
    const result = computeDialogPosition({
      anchor: { left: 0, top: 300, right: 200, bottom: 320 },
      size,
      viewport: { width: 1500, height: 950 },
    });

    // clamp 到 safeMargin = 90
    expect(result.left).toBe(90);
    expect(result.left).toBeGreaterThanOrEqual(48);
  });

  it('**小屏：安全边距变小但仍 >= 48**', () => {
    const result = computeDialogPosition({
      anchor: { left: 600, top: 300, right: 690, bottom: 320 },
      size,
      viewport: { width: 700, height: 950 },
    });

    // 700 * 0.06 = 42 -> max(48, ...) = 48
    // clamp -> 700 - 480 - 48 = 172
    expect(result.left).toBe(172);
    expect(result.left).toBeGreaterThanOrEqual(48);
  });

  it('**极窄视口 -> 弹窗不被挤出视口**', () => {
    const result = computeDialogPosition({
      anchor: { left: 350, top: 300, right: 395, bottom: 320 },
      size,
      viewport: { width: 400, height: 800 },
    });

    expect(result.left).toBeGreaterThanOrEqual(0);
    expect(result.left).toBeLessThanOrEqual(400);
  });

  it('**垂直：默认贴在锚点下方**', () => {
    const result = computeDialogPosition({
      anchor: { left: 300, top: 300, right: 500, bottom: 320 },
      size,
      viewport: { width: 1500, height: 950 },
    });

    // 320 + gap(8) = 328
    expect(result.top).toBe(328);
  });

  it('**垂直：下面放不下 -> 放上面**', () => {
    const result = computeDialogPosition({
      anchor: { left: 300, top: 700, right: 500, bottom: 720 },
      size,
      viewport: { width: 1500, height: 950 },
    });

    // 720 + 8 + 300 = 1028 > 950 - 12 -> 翻到上面
    // above = 700 - 8 - 300 = 392
    expect(result.top).toBe(392);
  });

  /*
   * ⚠️ **"高度"决定贴上面还是贴下面**（第 27 轮实测踩到的坑）。
   *
   * -> 便利贴详情面板的**真实高度**不是固定的（`min(460px, 70%)`）❌
   * -> 之前写死 **320** -> 算"下面放不下" -> 面板被放到**上面** ❌
   *    -> 实测：`anchor.bottom(391) + 30 + 320 = 741 > 732 - 12` ❌
   *    -> -> `top = anchor.top - 30 - 320 = 16` -> **贴在 PDF 最上方**
   * -> 用 **200**（比"锚点下面能放下的高度"小）-> **正常贴在下面**
   */
  it('**高度够小 -> 贴在锚点下面**（不会翻到上面）', () => {
    const result = computeDialogPosition({
      anchor: { left: 539, top: 367, right: 563, bottom: 391 },
      size: { width: 322, height: 200 },
      viewport: { width: 1442, height: 732 },
      gap: 30,
    });

    // 391 + 30 = 421 -> 下面放得下（421 + 200 = 621 < 720）
    expect(result.top).toBe(421);
  });

  it('**高度太大 -> 翻到上面**（这正是之前的 bug）', () => {
    const result = computeDialogPosition({
      anchor: { left: 539, top: 367, right: 563, bottom: 391 },
      size: { width: 322, height: 320 },
      viewport: { width: 1442, height: 732 },
      gap: 30,
    });

    // 391 + 30 + 320 = 741 > 720 -> 翻到上面
    // above = 367 - 30 - 320 = 17
    expect(result.top).toBe(17);
  });

  it('**垂直：整个弹窗都在视口内**', () => {
    const cases = [
      { left: 300, top: 0, right: 500, bottom: 10 },
      { left: 300, top: 900, right: 500, bottom: 950 },
      { left: 300, top: 400, right: 500, bottom: 420 },
    ];

    for (const anchor of cases) {
      const result = computeDialogPosition({
        anchor,
        size,
        viewport: { width: 1500, height: 950 },
      });

      expect(result.top).toBeGreaterThanOrEqual(0);
      expect(result.top + size.height).toBeLessThanOrEqual(950);
    }
  });
});
