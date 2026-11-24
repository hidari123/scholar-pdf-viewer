import { describe, expect, it } from 'vitest';
import { computeVisiblePages } from './visible';

/**
 * 造 N 个页占位。
 *
 * @param count 页数
 * @param height 每页高
 */
function makePages(count: number, height = 1000) {
  const pages = [];
  for (let i = 1; i <= count; i += 1) {
    pages.push({ pageNumber: i, top: (i - 1) * (height + 20), height });
  }
  return pages;
}

describe('computeVisiblePages 的边界（审核补测）', () => {
  it('**0 页 -> 空数组**', () => {
    const result = computeVisiblePages({
      scrollTop: 0,
      viewportHeight: 800,
      pages: [],
    });
    expect(result).toEqual([]);
  });

  it('**负的 scrollTop 不该崩**', () => {
    expect(() =>
      computeVisiblePages({
        scrollTop: -100,
        viewportHeight: 800,
        pages: makePages(10),
      }),
    ).not.toThrow();
  });

  it('**负的 viewportHeight 不该崩**', () => {
    expect(() =>
      computeVisiblePages({
        scrollTop: 0,
        viewportHeight: -500,
        pages: makePages(10),
      }),
    ).not.toThrow();
  });

  it('**滚到底 -> 能看到最后一页**', () => {
    const pages = makePages(10);
    const last = pages[pages.length - 1];
    if (!last) {
      throw new Error('测试数据有问题');
    }
    const result = computeVisiblePages({
      scrollTop: last.top,
      viewportHeight: 800,
      pages,
    });
    expect(result).toContain(10);
  });

  it('**滚太远 -> 不返回越界的页**', () => {
    const result = computeVisiblePages({
      scrollTop: 999_999,
      viewportHeight: 800,
      pages: makePages(10),
    });
    for (const page of result) {
      expect(page).toBeGreaterThanOrEqual(1);
      expect(page).toBeLessThanOrEqual(10);
    }
  });

  it('**缓冲区会多带几页**', () => {
    const pages = makePages(20);
    /*
     * ⚠️ **默认缓冲区就是 3** ✅
     * -> 所以"不带缓冲"的那次**必须显式传 0** ✅
     * -> 否则两次算出来一样多 ❌
     */
    const withoutBuffer = computeVisiblePages({
      scrollTop: 0,
      viewportHeight: 800,
      pages,
      bufferPages: 0,
    });
    const withBuffer = computeVisiblePages({
      scrollTop: 0,
      viewportHeight: 800,
      pages,
      bufferPages: 3,
    });
    expect(withBuffer.length).toBeGreaterThan(withoutBuffer.length);
  });

  it('**结果是升序且不重复**', () => {
    const result = computeVisiblePages({
      scrollTop: 3000,
      viewportHeight: 800,
      pages: makePages(20),
      bufferPages: 2,
    });
    for (let i = 1; i < result.length; i += 1) {
      const prev = result[i - 1];
      const cur = result[i];
      if (prev === undefined || cur === undefined) {
        continue;
      }
      expect(cur).toBeGreaterThan(prev);
    }
  });
});
