import { describe, expect, it } from 'vitest';
import { highlightsToPdfAnnots, highlightToPdfAnnots } from './annotations';

describe('highlightToPdfAnnots', () => {
  const page = { width: 595, height: 842 };

  /**
   * 归一化矩形：采集时的视口是 595×842（= 1 点/像素）→ 换算比例是 1。
   */
  const highlight = {
    id: 'h1',
    color: 'label-6',
    selectedText: '选中的文字',
    position: {
      boundingRect: { x1: 100, y1: 200, x2: 300, y2: 220, width: 595, height: 842, pageNumber: 1 },
      rects: [{ x1: 100, y1: 200, x2: 300, y2: 220, width: 595, height: 842, pageNumber: 1 }],
      pageNumber: 1,
    },
  };

  it('归一化坐标 → PDF 点坐标（**y 轴翻转**）', () => {
    const annots = highlightToPdfAnnots(highlight, [page]);

    expect(annots).toHaveLength(1);
    const [x1, y1, x2, y2] = annots[0]?.rect ?? [];
    // x 不变
    expect(x1).toBeCloseTo(100);
    expect(x2).toBeCloseTo(300);
    // y 翻转：PDF 原点在左下（y1 = 下边，y2 = 上边）
    expect(y1).toBeCloseTo(842 - 220);
    expect(y2).toBeCloseTo(842 - 200);
  });

  it('保留页码 / 文字 / 颜色 key', () => {
    const annots = highlightToPdfAnnots(highlight, [page]);

    expect(annots[0]?.pageNumber).toBe(1);
    expect(annots[0]?.text).toBe('选中的文字');
    expect(annots[0]?.color).toBe('label-6');
  });

  it('页码超出范围 → 空数组（不抛异常）', () => {
    const bad = {
      ...highlight,
      position: { ...highlight.position, pageNumber: 99 },
    };

    expect(highlightToPdfAnnots(bad, [page])).toEqual([]);
  });

  it('页尺寸非法 → 空数组', () => {
    expect(highlightToPdfAnnots(highlight, [{ width: 0, height: 0 }])).toEqual([]);
    expect(highlightToPdfAnnots(highlight, [])).toEqual([]);
  });

  it('多行高亮 → 多个批注', () => {
    const multi = {
      ...highlight,
      position: {
        ...highlight.position,
        rects: [
          { x1: 100, y1: 200, x2: 300, y2: 220, width: 595, height: 842, pageNumber: 1 },
          { x1: 100, y1: 240, x2: 250, y2: 260, width: 595, height: 842, pageNumber: 1 },
        ],
      },
    };

    expect(highlightToPdfAnnots(multi, [page])).toHaveLength(2);
  });

  /*
   * ⚠️ **缩放无关**：同一份归一化数据，
   *    在不同的采集视口下应该落到**同一个 PDF 点位置**。
   */
  it('缩放无关：换采集视口 → PDF 点位置不变', () => {
    // 采集时视口是 1190×1684（2 倍缩放）→ 归一化坐标也大 2 倍
    const at2x = {
      ...highlight,
      position: {
        ...highlight.position,
        rects: [{ x1: 200, y1: 400, x2: 600, y2: 440, width: 1190, height: 1684, pageNumber: 1 }],
      },
    };

    const a = highlightToPdfAnnots(highlight, [page])[0]?.rect;
    const b = highlightToPdfAnnots(at2x, [page])[0]?.rect;

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b?.[0]).toBeCloseTo(a?.[0] ?? 0);
    expect(b?.[1]).toBeCloseTo(a?.[1] ?? 0);
  });
});

describe('highlightsToPdfAnnots', () => {
  it('多条高亮 → 汇总所有批注', () => {
    const page = { width: 595, height: 842 };
    const make = (id: string) => ({
      id,
      color: 'label-6',
      selectedText: id,
      position: {
        boundingRect: { x1: 0, y1: 0, x2: 10, y2: 10, width: 595, height: 842, pageNumber: 1 },
        rects: [{ x1: 0, y1: 0, x2: 10, y2: 10, width: 595, height: 842, pageNumber: 1 }],
        pageNumber: 1,
      },
    });

    expect(highlightsToPdfAnnots([make('a'), make('b')], [page])).toHaveLength(2);
    expect(highlightsToPdfAnnots([], [page])).toHaveLength(0);
  });
});
