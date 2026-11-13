import { describe, expect, it } from 'vitest';
import type { TextContentLike, TextLayerItemLike, TextViewportLike } from './layout';
import { estimateTextLayerHeight, layoutTextContent, positionTextItem } from './layout';

/** A4 视口（scale=1）：595×842 */
function viewport(scale = 1): TextViewportLike {
  return {
    width: 595 * scale,
    height: 842 * scale,
    scale,
    // pdf.js 的标准视口矩阵：x' = x*scale, y' = height - y*scale
    transform: [scale, 0, 0, -scale, 0, 842 * scale],
  };
}

/** 造一个文本项 */
function item(str: string, x: number, y: number, fontSize = 12, hasEOL = false): TextLayerItemLike {
  return {
    str,
    // [a, b, c, d, e, f]：字体大小在 d，位置在 (e, f)
    transform: [1, 0, 0, fontSize, x, y],
    width: str.length * fontSize * 0.5,
    height: fontSize,
    hasEOL,
  };
}

describe('positionTextItem', () => {
  it('x 位置直接映射到屏幕', () => {
    const result = positionTextItem(item('Hi', 100, 700), viewport());

    expect(result).not.toBeNull();
    expect(result?.left).toBeCloseTo(100);
  });

  it('y 轴翻转：PDF 里越高，屏幕上越靠上', () => {
    // PDF 空间 y=700（靠近页顶）→ 屏幕 y = 842 - 700 = 142
    const result = positionTextItem(item('Hi', 72, 700), viewport());

    expect(result?.top).toBeCloseTo(142 - 12);
  });

  it('PDF 里越低，屏幕上越靠下', () => {
    const high = positionTextItem(item('A', 72, 700), viewport());
    const low = positionTextItem(item('B', 72, 100), viewport());

    expect(high?.top).toBeLessThan(low?.top ?? 0);
  });

  it('字体大小 = d × 视口缩放', () => {
    const result = positionTextItem(item('Hi', 0, 700, 18), viewport());

    expect(result?.fontSize).toBeCloseTo(18);
  });

  it('缩放 2 倍时字体大小翻倍', () => {
    const result = positionTextItem(item('Hi', 0, 700, 12), viewport(2));

    expect(result?.fontSize).toBeCloseTo(24);
  });

  it('缩放 2 倍时 x 坐标翻倍', () => {
    const result = positionTextItem(item('Hi', 100, 700), viewport(2));

    expect(result?.left).toBeCloseTo(200);
  });

  it('矩阵非法时返回 null', () => {
    const result = positionTextItem(
      { str: 'x', transform: [1, 0], width: 1, height: 1 },
      viewport(),
    );

    expect(result).toBeNull();
  });

  it('字体大小为 0 时返回 null', () => {
    const result = positionTextItem(
      { str: 'x', transform: [1, 0, 0, 0, 10, 10], width: 1, height: 1 },
      viewport(),
    );

    expect(result).toBeNull();
  });
});

describe('layoutTextContent', () => {
  it('同一行的多个 item 合并成一段', () => {
    const content: TextContentLike = {
      items: [item('Hello', 72, 700), item(' World', 110, 700, 12, true)],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Hello World');
  });

  it('hasEOL 分行', () => {
    const content: TextContentLike = {
      items: [item('Line 1', 72, 700, 12, true), item('Line 2', 72, 680, 12, true)],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe('Line 1');
    expect(lines[1]?.text).toBe('Line 2');
  });

  it('最后一行没有 EOL 也保留', () => {
    const content: TextContentLike = {
      items: [item('Last', 72, 700, 12, false)],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(1);
  });

  it('空字符串 item 被跳过', () => {
    const content: TextContentLike = {
      items: [item('', 72, 700), item('Text', 72, 700, 12, true)],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Text');
  });

  it('多行的 top 依次增大（从上到下）', () => {
    const content: TextContentLike = {
      items: [item('Top', 72, 700, 12, true), item('Bottom', 72, 600, 12, true)],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines[0]?.top).toBeLessThan(lines[1]?.top ?? 0);
  });

  it('混合字体大小时取较大值', () => {
    const content: TextContentLike = {
      items: [item('Small', 72, 700, 10), item('Big', 100, 700, 20, true)],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines[0]?.fontSize).toBeCloseTo(20);
  });
});

describe('estimateTextLayerHeight', () => {
  it('空内容高度为 0', () => {
    expect(estimateTextLayerHeight([])).toBe(0);
  });

  it('取最底部行的位置', () => {
    const height = estimateTextLayerHeight([
      { text: 'a', left: 0, top: 100, fontSize: 12, hasEOL: false },
      { text: 'b', left: 0, top: 200, fontSize: 12, hasEOL: false },
    ]);

    expect(height).toBe(212);
  });
});
