import { describe, expect, it } from 'vitest';
import type { TextContentLike, TextLayerItemLike, TextViewportLike } from './layout';
import {
  estimateTextLayerHeight,
  layoutTextContent,
  layoutTextItems,
  positionTextItem,
} from './layout';

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

/**
 * 造一个文本项（pdf.js TextItem 的形状）。
 *
 * 关键：`height` 是**字体高度**（真实字号），
 * `transform[3]` 是字体渲染矩阵的垂直分量（**不等于字号**）。
 */
function item(
  str: string,
  x: number,
  y: number,
  options: { fontHeight?: number; width?: number; hasEOL?: boolean } = {},
): TextLayerItemLike {
  const fontHeight = options.fontHeight ?? 12;
  return {
    str,
    // [a, b, c, d, e, f]：d 是渲染矩阵的垂直分量（≠字号）
    transform: [1, 0, 0, fontHeight * 0.9, x, y],
    width: options.width ?? str.length * fontHeight * 0.5,
    height: fontHeight,
    hasEOL: options.hasEOL ?? false,
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
});

describe('layoutTextItems（逐 item 排版 —— 精准定位的核心）', () => {
  it('每个 item 一个片段（不再按行合并）', () => {
    const content: TextContentLike = {
      items: [
        item('Hello', 72, 700, { hasEOL: false }),
        item(' World', 110, 700, { hasEOL: true }),
      ],
    };

    const items = layoutTextItems(content, viewport());

    expect(items).toHaveLength(2);
  });

  it('每个片段保留自己的 left（不同 item 位置不同）', () => {
    const content: TextContentLike = {
      items: [item('A', 72, 700), item('B', 96.62, 700), item('C', 112.38, 700)],
    };

    const items = layoutTextItems(content, viewport());

    expect(items[0]?.left).toBeCloseTo(72);
    expect(items[1]?.left).toBeCloseTo(96.62);
    expect(items[2]?.left).toBeCloseTo(112.38);
  });

  it('每个片段保留自己的宽度（用 item.width，不用浏览器估算）', () => {
    const content: TextContentLike = {
      items: [item('Shanghai', 112.38, 762.12, { width: 78, fontHeight: 4.56 })],
    };

    const items = layoutTextItems(content, viewport());

    expect(items[0]?.width).toBeCloseTo(78);
  });

  it('字号用 item.height（真实字体高度），不是 transform[3]', () => {
    // 同一行里 d=4.56 但真实字号是 9.66
    const content: TextContentLike = {
      items: [item('A', 522.2, 762.67, { fontHeight: 9.67, width: 7 })],
    };

    const items = layoutTextItems(content, viewport());

    expect(items[0]?.fontSize).toBeCloseTo(9.67);
  });

  it('top = 基线 - 字号（按各自的字号算）', () => {
    const content: TextContentLike = {
      items: [item('A', 72, 700, { fontHeight: 10 })],
    };

    const items = layoutTextItems(content, viewport());

    // 屏幕基线 = 842 - 700 = 142；top = 142 - 10 = 132
    expect(items[0]?.top).toBeCloseTo(132);
  });

  it('缩放时几何整体放大', () => {
    const content: TextContentLike = {
      items: [item('A', 100, 700, { fontHeight: 10, width: 20 })],
    };

    const items = layoutTextItems(content, viewport(2));

    expect(items[0]?.left).toBeCloseTo(200);
    expect(items[0]?.width).toBeCloseTo(40);
    expect(items[0]?.fontSize).toBeCloseTo(20);
  });

  it('空字符串 item 被跳过', () => {
    const content: TextContentLike = {
      items: [item('', 72, 700), item('Text', 72, 700)],
    };

    const items = layoutTextItems(content, viewport());

    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('Text');
  });

  it('按 (top, left) 排序（同一行内按 x 递增）', () => {
    const content: TextContentLike = {
      items: [item('C', 112, 700), item('A', 72, 700), item('B', 90, 700)],
    };

    const items = layoutTextItems(content, viewport());

    expect(items.map((i) => i.text)).toEqual(['A', 'B', 'C']);
  });

  it('不同行的顺序按 y（PDF y 越大越靠上）', () => {
    const content: TextContentLike = {
      items: [item('lower', 72, 600), item('upper', 72, 700)],
    };

    const items = layoutTextItems(content, viewport());

    expect(items[0]?.text).toBe('upper');
  });
});

describe('layoutTextContent（按行合并 —— 保留给不需要精确位置的场景）', () => {
  it('同一行的多个 item 合并成一段', () => {
    const content: TextContentLike = {
      items: [item('Hello', 72, 700), item(' World', 110, 700, { hasEOL: true })],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Hello World');
  });

  it('hasEOL 分行', () => {
    const content: TextContentLike = {
      items: [item('Line 1', 72, 700, { hasEOL: true }), item('Line 2', 72, 680, { hasEOL: true })],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe('Line 1');
    expect(lines[1]?.text).toBe('Line 2');
  });

  it('最后一行没有 EOL 也保留', () => {
    const content: TextContentLike = {
      items: [item('Last', 72, 700, { hasEOL: false })],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(1);
  });

  it('空字符串 item 被跳过', () => {
    const content: TextContentLike = {
      items: [item('', 72, 700), item('Text', 72, 700, { hasEOL: true })],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines).toHaveLength(1);
    expect(lines[0]?.text).toBe('Text');
  });

  it('多行的 top 依次增大（从上到下）', () => {
    const content: TextContentLike = {
      items: [item('Top', 72, 700, { hasEOL: true }), item('Bottom', 72, 600, { hasEOL: true })],
    };

    const lines = layoutTextContent(content, viewport());

    expect(lines[0]?.top).toBeLessThan(lines[1]?.top ?? 0);
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
