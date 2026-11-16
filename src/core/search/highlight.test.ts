import { describe, expect, it } from 'vitest';
import type { PositionedTextItem } from '../text-layer/layout';
import { hitsToRects, hitToRects, mapRangeToItems } from './highlight';
import type { SearchHit } from './search';

/**
 * 造一个文本项。
 */
function item(text: string, left: number, top: number, width: number, fontSize = 12) {
  return {
    text,
    left,
    top,
    width,
    fontSize,
    fontFamily: 'sans-serif',
    scaleX: 1,
    angle: 0,
    hasEOL: false,
  } satisfies PositionedTextItem;
}

/** 页面尺寸（px） */
const PAGE_WIDTH = 600;
const PAGE_HEIGHT = 800;

describe('mapRangeToItems', () => {
  const items = [item('Hello ', 0, 0, 60), item('World', 60, 0, 50), item('Next line', 0, 20, 90)];

  it('命中单个 item 内', () => {
    const result = mapRangeToItems(items, 2, 3);

    expect(result).toHaveLength(1);
    expect(result[0]?.item.text).toBe('Hello ');
    expect(result[0]?.offsetInItem).toBe(2);
    expect(result[0]?.charsInItem).toBe(3);
  });

  it('命中跨两个 item', () => {
    const result = mapRangeToItems(items, 4, 5);

    expect(result).toHaveLength(2);
    expect(result[0]?.item.text).toBe('Hello ');
    expect(result[1]?.item.text).toBe('World');
  });

  it('命中跨行', () => {
    const result = mapRangeToItems(items, 8, 6);

    expect(result).toHaveLength(2);
    expect(result[1]?.item.text).toBe('Next line');
  });

  it('完全在 item 之外 → 空', () => {
    const result = mapRangeToItems(items, 1000, 5);

    expect(result).toHaveLength(0);
  });

  it('start = 0（从第一个字开始）', () => {
    const result = mapRangeToItems(items, 0, 1);

    expect(result).toHaveLength(1);
    expect(result[0]?.offsetInItem).toBe(0);
  });
});

describe('hitToRects', () => {
  const items = [item('Hello ', 100, 200, 60), item('World', 160, 200, 50)];

  it('单个 item 的命中 → 一个矩形', () => {
    const hit: SearchHit = { pageNumber: 1, text: 'Hello', start: 0, length: 5 };
    const rects = hitToRects(hit, items, PAGE_WIDTH, PAGE_HEIGHT);

    expect(rects).toHaveLength(1);
    expect(rects[0]?.x).toBeCloseTo(100 / PAGE_WIDTH);
    expect(rects[0]?.y).toBeCloseTo(200 / PAGE_HEIGHT);
    expect(rects[0]?.width).toBeCloseTo((60 * 5) / 6 / PAGE_WIDTH);
    expect(rects[0]?.height).toBeCloseTo(12 / PAGE_HEIGHT);
  });

  it('部分命中 → 按比例裁剪宽度', () => {
    // 命中 "World" 的前 2 个字（"Wo"）
    const hit: SearchHit = { pageNumber: 1, text: 'Wo', start: 6, length: 2 };
    const rects = hitToRects(hit, items, PAGE_WIDTH, PAGE_HEIGHT);

    expect(rects).toHaveLength(1);
    expect(rects[0]?.x).toBeCloseTo(160 / PAGE_WIDTH);
    expect(rects[0]?.width).toBeCloseTo((50 * 2) / 5 / PAGE_WIDTH);
  });

  it('跨 item 的命中 → 两个矩形', () => {
    const hit: SearchHit = { pageNumber: 1, text: 'lo W', start: 3, length: 4 };
    const rects = hitToRects(hit, items, PAGE_WIDTH, PAGE_HEIGHT);

    expect(rects).toHaveLength(2);
  });

  it('空 items → 空结果', () => {
    const hit: SearchHit = { pageNumber: 1, text: 'x', start: 0, length: 1 };

    expect(hitToRects(hit, [], PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });

  it('页面尺寸非法 → 空结果', () => {
    const hit: SearchHit = { pageNumber: 1, text: 'x', start: 0, length: 1 };

    expect(hitToRects(hit, items, 0, PAGE_HEIGHT)).toHaveLength(0);
  });

  it('命中在 items 之外 → 空结果', () => {
    const hit: SearchHit = { pageNumber: 1, text: 'x', start: 9999, length: 1 };

    expect(hitToRects(hit, items, PAGE_WIDTH, PAGE_HEIGHT)).toHaveLength(0);
  });
});

describe('hitsToRects', () => {
  const itemsByPage = new Map([[1, [item('Hello', 0, 0, 50)]]]);
  const sizes = new Map([[1, { width: PAGE_WIDTH, height: PAGE_HEIGHT }]]);

  it('同一页的多个命中 → 合并到一页', () => {
    const hits: SearchHit[] = [
      { pageNumber: 1, text: 'He', start: 0, length: 2 },
      { pageNumber: 1, text: 'lo', start: 2, length: 2 },
    ];

    const result = hitsToRects(hits, itemsByPage, sizes);

    expect(result.size).toBe(1);
    expect(result.get(1)).toHaveLength(2);
  });

  it('不同页 → 分开', () => {
    const itemsByPage2 = new Map([
      [1, [item('Hello', 0, 0, 50)]],
      [2, [item('World', 0, 0, 50)]],
    ]);
    const sizes2 = new Map([
      [1, { width: PAGE_WIDTH, height: PAGE_HEIGHT }],
      [2, { width: PAGE_WIDTH, height: PAGE_HEIGHT }],
    ]);

    const hits: SearchHit[] = [
      { pageNumber: 1, text: 'He', start: 0, length: 2 },
      { pageNumber: 2, text: 'Wo', start: 0, length: 2 },
    ];

    const result = hitsToRects(hits, itemsByPage2, sizes2);

    expect(result.size).toBe(2);
  });

  it('页没有文本项 → 跳过', () => {
    const hits: SearchHit[] = [{ pageNumber: 99, text: 'x', start: 0, length: 1 }];

    expect(hitsToRects(hits, itemsByPage, sizes).size).toBe(0);
  });
});
