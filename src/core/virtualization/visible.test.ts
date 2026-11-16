import { describe, expect, it } from 'vitest';
import type { PageBox } from './visible';
import { computeCurrentPage, computeVisiblePages } from './visible';

/**
 * 造 10 页，每页高 100，间隔 10（页顶边：0, 110, 220, ...）。
 */
function pages(count = 10, height = 100, gap = 10): PageBox[] {
  const result: PageBox[] = [];
  for (let i = 0; i < count; i += 1) {
    result.push({
      pageNumber: i + 1,
      top: i * (height + gap),
      height,
    });
  }
  return result;
}

describe('computeVisiblePages', () => {
  it('顶部时可见第一页', () => {
    const result = computeVisiblePages({
      scrollTop: 0,
      viewportHeight: 200,
      pages: pages(),
      bufferPages: 0,
    });

    expect(result).toEqual([1, 2]);
  });

  it('滚动后可见对应的页', () => {
    const result = computeVisiblePages({
      scrollTop: 220,
      viewportHeight: 100,
      pages: pages(),
      bufferPages: 0,
    });

    // 第 3 页的顶边是 220，底边是 320 → 视口 [220, 320] 完全覆盖它
    expect(result).toContain(3);
    expect(result).not.toContain(1);
  });

  it('缓冲区扩展前后各几页', () => {
    const result = computeVisiblePages({
      scrollTop: 220,
      viewportHeight: 100,
      pages: pages(),
      bufferPages: 2,
    });

    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('缓冲不会产生小于 1 的页码', () => {
    const result = computeVisiblePages({
      scrollTop: 0,
      viewportHeight: 100,
      pages: pages(),
      bufferPages: 3,
    });

    expect(Math.min(...result)).toBe(1);
  });

  it('视口内没有页时兜底取最接近的一页', () => {
    // scrollTop 远超文档末尾
    const result = computeVisiblePages({
      scrollTop: 100000,
      viewportHeight: 100,
      pages: pages(),
      bufferPages: 0,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(10);
  });

  it('空页列表 → 空结果', () => {
    expect(computeVisiblePages({ scrollTop: 0, viewportHeight: 100, pages: [] })).toHaveLength(0);
  });

  it('视口高度为 0 → 空结果', () => {
    expect(computeVisiblePages({ scrollTop: 0, viewportHeight: 0, pages: pages() })).toHaveLength(
      0,
    );
  });

  it('**缩放后页变高**：可见页数量变少但仍覆盖视口', () => {
    // 缩放前：每页 100px
    const before = computeVisiblePages({
      scrollTop: 0,
      viewportHeight: 300,
      pages: pages(10, 100, 10),
      bufferPages: 0,
    });

    // 缩放 3 倍后：每页 300px
    const after = computeVisiblePages({
      scrollTop: 0,
      viewportHeight: 300,
      pages: pages(10, 300, 30),
      bufferPages: 0,
    });

    expect(before.length).toBeGreaterThan(after.length);
    expect(after.length).toBeGreaterThan(0);
  });

  it('结果始终升序', () => {
    const result = computeVisiblePages({
      scrollTop: 330,
      viewportHeight: 100,
      pages: pages(),
      bufferPages: 2,
    });

    const sorted = [...result].sort((a, b) => a - b);
    expect(result).toEqual(sorted);
  });

  it('结果不重复', () => {
    const result = computeVisiblePages({
      scrollTop: 220,
      viewportHeight: 200,
      pages: pages(),
      bufferPages: 3,
    });

    expect(new Set(result).size).toBe(result.length);
  });
});

describe('computeCurrentPage', () => {
  it('顶部 → 第 1 页', () => {
    expect(computeCurrentPage({ scrollTop: 0, pages: pages() })).toBe(1);
  });

  it('滚动到第 3 页区域 → 第 3 页', () => {
    // 第 3 页顶边 = 220
    expect(computeCurrentPage({ scrollTop: 230, pages: pages() })).toBe(3);
  });

  it('刚好在边界上 → 上一页（顶边 <= scrollTop 的最后一页）', () => {
    // 第 2 页顶边 = 110，scrollTop = 110 → 第 2 页
    expect(computeCurrentPage({ scrollTop: 110, pages: pages() })).toBe(2);
  });

  it('空页列表 → 1', () => {
    expect(computeCurrentPage({ scrollTop: 0, pages: [] })).toBe(1);
  });

  it('超出末尾 → 最后一页', () => {
    expect(computeCurrentPage({ scrollTop: 100000, pages: pages() })).toBe(10);
  });
});
