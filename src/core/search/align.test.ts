import { describe, expect, it } from 'vitest';
import { joinItemTexts, mapOffsetToItemTexts, selectSearchItems } from './align';

describe('selectSearchItems', () => {
  /** 造一个 pdf.js 的文本项 */
  function raw(str: string, hasEOL = false) {
    return { str, transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10, hasEOL };
  }

  it('**跳过空项**（渲染侧也会跳过 → 索引必须同步跳过）', () => {
    const items = [raw('Hello'), raw(''), raw('World')];

    const selected = selectSearchItems(items);

    expect(selected).toHaveLength(2);
    expect(selected[0]?.str).toBe('Hello');
    expect(selected[1]?.str).toBe('World');
  });

  it('**跳过没有 transform 的项**（定位不了）', () => {
    const items = [
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 0], width: 1, height: 1, hasEOL: false },
      { str: 'Bad', transform: [] as number[], width: 1, height: 1, hasEOL: false },
    ];

    expect(selectSearchItems(items)).toHaveLength(1);
  });

  it('**保持原始顺序**（不排序）', () => {
    const items = [raw('Zebra'), raw('Apple'), raw('Mango')];

    const selected = selectSearchItems(items);

    expect(selected.map((i) => i.str)).toEqual(['Zebra', 'Apple', 'Mango']);
  });
});

describe('joinItemTexts', () => {
  it('拼接所有项', () => {
    expect(joinItemTexts([{ str: 'Hello ' }, { str: 'World' }])).toBe('Hello World');
  });

  it('空数组 → 空串', () => {
    expect(joinItemTexts([])).toBe('');
  });
});

describe('mapOffsetToItemTexts', () => {
  const texts = ['Hello ', 'World', 'Next'];

  it('命中单个项内', () => {
    const result = mapOffsetToItemTexts(texts, 2, 3);

    expect(result).toHaveLength(1);
    expect(result[0]?.index).toBe(0);
    expect(result[0]?.offsetInItem).toBe(2);
    expect(result[0]?.charsInItem).toBe(3);
  });

  it('命中跨两个项', () => {
    const result = mapOffsetToItemTexts(texts, 4, 5);

    expect(result).toHaveLength(2);
    expect(result[0]?.index).toBe(0);
    expect(result[1]?.index).toBe(1);
  });

  it('命中跨三个项', () => {
    const result = mapOffsetToItemTexts(texts, 5, 10);

    expect(result).toHaveLength(3);
  });

  it('超出范围 → 空', () => {
    expect(mapOffsetToItemTexts(texts, 100, 5)).toHaveLength(0);
  });
});
