import { describe, expect, it } from 'vitest';
import type { PageFrame } from './extract';
import { extractSelection, pageOfRect } from './extract';

/** 两页的页框（容器坐标：页1 在上，页2 在下） */
const PAGES: PageFrame[] = [
  { pageNumber: 1, top: 0, left: 0, width: 600, height: 800 },
  { pageNumber: 2, top: 800, left: 0, width: 600, height: 800 },
];

/** 提取用到的参考尺寸 */
const REFERENCE = { width: 600, height: 800 };

describe('pageOfRect', () => {
  it('中心点落在页 1 内 → 页 1', () => {
    expect(pageOfRect({ top: 10, left: 10, width: 100, height: 20 }, PAGES)).toBe(1);
  });

  it('中心点落在页 2 内 → 页 2', () => {
    expect(pageOfRect({ top: 900, left: 10, width: 100, height: 20 }, PAGES)).toBe(2);
  });

  it('中心点不在任何页内 → null', () => {
    expect(pageOfRect({ top: 5000, left: 10, width: 100, height: 20 }, PAGES)).toBeNull();
  });

  it('跨页边界上的矩形按中心点判定（不丢矩形）', () => {
    // 矩形横跨页 1 底部边界：中心点在页 2 → 归页 2
    const rect = { top: 780, left: 10, width: 100, height: 60 };
    expect(pageOfRect(rect, PAGES)).toBe(2);
  });

  /*
   * ⚠️⚠️ **页是居中时的回归测试**（实测踩过的坑）。
   *
   * `.scpdf-page` 用 `margin-inline: auto` 居中 →
   * 当页宽 < 容器宽时（低缩放 / 适合页面），页会**居中偏移**。
   *
   * 实测（100% 缩放，容器 1384px，页 612px）：
   * ```
   * 页实际 left = 386
   * 选区矩形 centerX = 681.5
   * 若按 left=0 判定： 681.5 > 0 + 612 → **不属于任何页** ❌
   *                 → 选区被丢弃 → **自绘选区层为空**（用户看到"选不中"）
   * ```
   */
  it('页居中时（left ≠ 0）仍能归页', () => {
    const centered: PageFrame[] = [{ pageNumber: 1, top: 0, left: 386, width: 612, height: 792 }];
    // 选区在页的右半部分：centerX = 681.5（如果按 left=0 判定就会失败）
    const rect = { top: 105, left: 591, width: 181, height: 19 };
    expect(pageOfRect(rect, centered)).toBe(1);
  });

  it('页居中时，页外的矩形仍返回 null', () => {
    const centered: PageFrame[] = [{ pageNumber: 1, top: 0, left: 386, width: 612, height: 792 }];
    // centerX = 100 → 在页左侧的空白区
    const rect = { top: 105, left: 50, width: 100, height: 19 };
    expect(pageOfRect(rect, centered)).toBeNull();
  });

  /*
   * ⚠️ **水平容差**（实测踩过的坑）。
   *
   * 页框的 `left` 是**量出来的**（页是 `margin-inline: auto` 居中的）
   * → 面板开合 / 缩放 / 容器尺寸变化都会让它变，测量有 1~2px 误差。
   *
   * 实测（面板打开时）：页 left 本该是 0，量成了 −245
   * → 选区中心 681.5 > −245 + 612 = 367 → **不属于任何页** ❌
   */
  it('页框 left 有几像素误差时仍能归页（水平容差）', () => {
    // 页 left 应该是 0，量成了 −2（2px 误差）
    const slightlyOff: PageFrame[] = [{ pageNumber: 1, top: 0, left: -2, width: 612, height: 792 }];
    // 选区在页的**最右侧**（贴着右边界）→ 没有容差就会被判成"不在页内"
    const rect = { top: 105, left: 600, width: 20, height: 19 }; // centerX = 610
    expect(pageOfRect(rect, slightlyOff)).toBe(1);
  });

  it('页框 left 误差很大时仍然判为不属于该页', () => {
    const wayOff: PageFrame[] = [{ pageNumber: 1, top: 0, left: 200, width: 612, height: 792 }];
    // 页 spans 200..812，centerX = 100 → 在页左边 100px → 不属于该页
    const rect = { top: 105, left: 50, width: 100, height: 19 };
    expect(pageOfRect(rect, wayOff)).toBeNull();
  });
});

describe('extractSelection', () => {
  it('单页选区：输出视口矩形 + 归一化结构', () => {
    const result = extractSelection({
      text: 'hello',
      rects: [{ top: 10, left: 10, width: 100, height: 20 }],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result).not.toBeNull();
    expect(result?.text).toBe('hello');
    expect(result?.pages).toEqual([1]);
    expect(result?.rects[0]?.left).toBe(10);
    expect(result?.rects[0]?.top).toBe(10);
    // 归一化：坐标与参考尺寸同尺度 → x1 = 10
    expect(result?.norm.rects[0]?.x1).toBe(10);
    expect(result?.norm.rects[0]?.width).toBe(600);
    expect(result?.norm.pageNumber).toBe(1);
  });

  it('跨页选区：两页都归属，页码升序', () => {
    const result = extractSelection({
      text: 'across',
      rects: [
        { top: 10, left: 10, width: 100, height: 20 },
        { top: 810, left: 10, width: 100, height: 20 },
      ],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result?.pages).toEqual([1, 2]);
    expect(result?.rects).toHaveLength(2);
  });

  /*
   * ⚠️ **页居中时的回归测试**（实测 bug）。
   *
   * 旧实现把页框的 `left` 写死成 0 →
   * 页居中时（低缩放），选区矩形落在"页框之外" → 被丢弃
   * → `extractSelection` 返回 null → **自绘选区层为空**。
   */
  it('页居中（left ≠ 0）时选区不被丢弃', () => {
    const centered: PageFrame[] = [{ pageNumber: 1, top: 0, left: 386, width: 612, height: 792 }];
    const result = extractSelection({
      text: 'centered',
      rects: [{ top: 105, left: 591, width: 181, height: 19 }],
      pages: centered,
      reference: { width: 612, height: 792 },
    });

    expect(result).not.toBeNull();
    expect(result?.pages).toEqual([1]);
    expect(result?.rects).toHaveLength(1);
    // 页内坐标 = 视口坐标 - 页的 left
    expect(result?.rects[0]?.left).toBe(591 - 386);
  });

  it('同行碎矩形合并（浏览器把一行切成多段的情况）', () => {
    const result = extractSelection({
      text: 'merged',
      rects: [
        { top: 10, left: 10, width: 40, height: 20 },
        { top: 11, left: 50, width: 40, height: 19 },
      ],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result?.rects).toHaveLength(1);
    expect(result?.rects[0]?.width).toBe(80);
  });

  it('矩形转换到页内坐标（减去页框偏移）', () => {
    const result = extractSelection({
      text: 'page2',
      rects: [{ top: 810, left: 10, width: 100, height: 20 }],
      pages: PAGES,
      reference: REFERENCE,
    });

    // 页 2 的 top 偏移是 800 → 页内 top = 10
    expect(result?.rects[0]?.top).toBe(10);
    expect(result?.rects[0]?.pageNumber).toBe(2);
  });

  it('空矩形 / 空页框 → null', () => {
    expect(
      extractSelection({ text: '', rects: [], pages: PAGES, reference: REFERENCE }),
    ).toBeNull();
    expect(
      extractSelection({
        text: 'x',
        rects: [{ top: 1, left: 1, width: 1, height: 1 }],
        pages: [],
        reference: REFERENCE,
      }),
    ).toBeNull();
  });

  it('所有矩形都不属于任何页 → null', () => {
    expect(
      extractSelection({
        text: 'x',
        rects: [{ top: 99999, left: 0, width: 10, height: 10 }],
        pages: PAGES,
        reference: REFERENCE,
      }),
    ).toBeNull();
  });

  it('锚点取第一页的包围盒', () => {
    const result = extractSelection({
      text: 'x',
      rects: [
        { top: 10, left: 10, width: 100, height: 20 },
        { top: 810, left: 10, width: 100, height: 20 },
      ],
      pages: PAGES,
      reference: REFERENCE,
    });

    expect(result?.anchor.pageNumber).toBe(1);
    expect(result?.anchor.rect.top).toBe(10);
  });
});
