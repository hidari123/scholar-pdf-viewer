/**
 * 索引坐标 → 渲染坐标的换算（实测踩过的坑：搜索高亮定位不准）。
 *
 * 用户反馈："搜索高亮还是错位"
 *
 * ## 场景（真实 PDF，搜 "A2E"）
 *
 * ```
 * 索引的项: ["A2E", " is ", ...]        ← 索引里 "A2E" 是一个项
 * 渲染的项: ["A", "2", "E", " is ", ...] ← 渲染侧拆成了三个项
 * ```
 *
 * → 命中偏移是**索引坐标系**的（指向 "A2E"）
 * → 直接拿去切渲染项 → **只切到 "A"** → 高亮只有 1 个字符宽 ❌
 */

import { describe, expect, it } from 'vitest';
import { alignRenderedToIndex, convertIndexOffsetToRendered } from './align';

describe('convertIndexOffsetToRendered（索引坐标 → 渲染坐标）', () => {
  it('**索引一个项、渲染三个项 → 三个渲染项都对上**', () => {
    const indexTexts = ['A2E', ' is ', 'great'];
    const renderedTexts = ['A', '2', 'E', ' is ', 'great'];
    const alignment = alignRenderedToIndex(indexTexts, renderedTexts);

    /*
     * ⚠️ **三个渲染项都要对上索引项 0**。
     * → "A2E" 包含 "A"、"2"、"E"
     * → 如果"占用"了索引项 → "2"、"E" 对不上 → **高亮只框住 "A"** ❌
     */
    expect(alignment[0]).toBe(0);
    expect(alignment[1]).toBe(0);
    expect(alignment[2]).toBe(0);
  });

  it('**索引一个项、渲染三个项 → 换算后覆盖全部三个**', () => {
    const indexTexts = ['A2E', ' is ', 'great'];
    const renderedTexts = ['A', '2', 'E', ' is ', 'great'];
    const alignment = alignRenderedToIndex(indexTexts, renderedTexts);

    // 索引偏移 0 → "A2E"（3 个字）
    const converted = convertIndexOffsetToRendered(indexTexts, renderedTexts, alignment, 0, 3);

    expect(converted).not.toBeNull();
    expect(converted?.start).toBe(0);
    expect(converted?.length).toBe(3);
  });

  it('**换算后的区间落在渲染文本里，且内容就是关键词**', () => {
    const indexTexts = ['Hello ', 'A2E', ' world'];
    const renderedTexts = ['Hello ', 'A', '2', 'E', ' world'];
    const alignment = alignRenderedToIndex(indexTexts, renderedTexts);

    // 索引里 "A2E" 的偏移 = 6
    const converted = convertIndexOffsetToRendered(indexTexts, renderedTexts, alignment, 6, 3);

    expect(converted).not.toBeNull();
    const rendered = renderedTexts.join('');
    expect(
      rendered.slice(converted?.start ?? 0, (converted?.start ?? 0) + (converted?.length ?? 0)),
    ).toBe('A2E');
  });

  it('**两边边界一样 → 换算结果和原偏移一致**', () => {
    const indexTexts = ['Hello ', 'world'];
    const renderedTexts = ['Hello ', 'world'];
    const alignment = alignRenderedToIndex(indexTexts, renderedTexts);

    const converted = convertIndexOffsetToRendered(indexTexts, renderedTexts, alignment, 6, 5);

    expect(converted?.start).toBe(6);
    expect(converted?.length).toBe(5);
  });

  it('**偏移超出范围 → null**', () => {
    const indexTexts = ['abc'];
    const renderedTexts = ['abc'];
    const alignment = alignRenderedToIndex(indexTexts, renderedTexts);

    expect(convertIndexOffsetToRendered(indexTexts, renderedTexts, alignment, 100, 5)).toBeNull();
  });

  it('**对不上 → null**（不瞎画）', () => {
    // 对齐表全 -1（渲染项和索引项完全对不上）
    const indexTexts = ['abc', 'def'];
    const renderedTexts = ['xyz', 'uvw'];

    expect(convertIndexOffsetToRendered(indexTexts, renderedTexts, [-1, -1], 0, 3)).toBeNull();
  });

  it('**部分能对上 → 用能对上的部分**', () => {
    const indexTexts = ['A2E', 'x'];
    const renderedTexts = ['A', '2', 'E', 'y'];
    // 只有 "A" 对上了索引的第 0 项
    const alignment = [0, -1, -1, -1];

    const converted = convertIndexOffsetToRendered(indexTexts, renderedTexts, alignment, 0, 3);

    expect(converted).not.toBeNull();
    expect(converted?.start).toBe(0);
    expect(converted?.length).toBe(1);
  });
});
