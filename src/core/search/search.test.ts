import { describe, expect, it } from 'vitest';
import type { TextPageLike } from './index';
import { PdfSearch } from './index';

/** 造一页文本内容 */
function page(pageNumber: number, text: string): TextPageLike {
  return {
    pageNumber,
    getTextContent: async () => ({
      items: [{ str: text, transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10, hasEOL: false }],
    }),
  };
}

/** 造一个取页函数 */
function pages(...texts: string[]) {
  const map = new Map<number, TextPageLike>();
  texts.forEach((text, index) => {
    map.set(index + 1, page(index + 1, text));
  });
  return async (pageNumber: number) => map.get(pageNumber);
}

describe('PdfSearch', () => {
  it('建索引后可搜到关键词', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('hello world', 'another page'), 2);

    const hits = search.search('world');

    expect(hits).toHaveLength(1);
    expect(hits[0]?.pageNumber).toBe(1);
    expect(hits[0]?.text).toBe('world');
    expect(hits[0]?.start).toBe(6);
  });

  it('多页多命中：按页码顺序返回', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('target one', 'no match', 'target two'), 3);

    const hits = search.search('target');

    expect(hits.map((h) => h.pageNumber)).toEqual([1, 3]);
  });

  it('同一页多个命中', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('aXbXc'), 1);

    const hits = search.search('X');

    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.start)).toEqual([1, 3]);
  });

  it('忽略大小写（默认开）', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('PDF Document'), 1);

    expect(search.search('pdf')).toHaveLength(1);
  });

  it('可关闭大小写敏感', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('PDF Document'), 1);

    expect(search.search('pdf', { ignoreCase: false })).toHaveLength(0);
  });

  it('全角字符能命中半角（归一化）', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('ＡＢＣ'), 1);

    expect(search.search('abc')).toHaveLength(1);
  });

  it('空关键词返回空', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('text'), 1);

    expect(search.search('   ')).toEqual([]);
  });

  it('单页命中上限', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('x'.repeat(500)), 1);

    expect(search.search('x', { maxHitsPerPage: 10 })).toHaveLength(10);
  });

  it('总命中上限', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('xxx', 'xxx', 'xxx'), 3);

    expect(search.search('x', { maxHits: 5 })).toHaveLength(5);
  });

  it('未建索引时搜索返回空（不报错）', () => {
    const search = new PdfSearch();

    expect(search.search('anything')).toEqual([]);
  });

  it('分页取文本失败时跳过该页，不中断整体建索引', async () => {
    const failing = async (pageNumber: number) => {
      if (pageNumber === 2) {
        throw new Error('page broken');
      }
      return page(pageNumber, 'good text');
    };

    const search = new PdfSearch();
    await search.buildIndex(failing, 3);

    // 索引建完了（第 2 页失败不影响整体）
    expect(search.isComplete).toBe(true);
    expect(search.indexedPages).toBe(3);
    // 第 2 页记为空文本 → 搜不到；第 1、3 页正常 → 各 1 个命中
    expect(search.search('good')).toHaveLength(2);
    expect(search.getPageText(2)).toBe('');
  });

  it('getPageText / getText 取全文', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('page one', 'page two'), 2);

    expect(search.getPageText(1)).toBe('page one');
    expect(search.getText()).toContain('page one');
    expect(search.getText()).toContain('page two');
  });

  it('reset 后索引清空', async () => {
    const search = new PdfSearch();
    await search.buildIndex(pages('text'), 1);

    search.reset();

    expect(search.indexedPages).toBe(0);
    expect(search.search('text')).toEqual([]);
  });

  it('重复 buildIndex 不会重复建（幂等）', async () => {
    let callCount = 0;
    const counting = async (pageNumber: number) => {
      callCount += 1;
      return page(pageNumber, 'text');
    };

    const search = new PdfSearch();
    await search.buildIndex(counting, 1);
    await search.buildIndex(counting, 1);

    expect(callCount).toBe(1);
  });
});
