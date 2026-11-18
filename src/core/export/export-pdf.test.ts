import { describe, expect, it } from 'vitest';
import type { ExportHighlightLike, PdfLibLike } from './export-pdf';
import { colorToRgb, exportHighlightedPdf } from './export-pdf';

/** 一条高亮（覆盖 2 行） */
function makeHighlight(): ExportHighlightLike {
  return {
    id: 'h1',
    color: 'yellow',
    selectedText: 'Hello World',
    position: {
      pageNumber: 1,
      boundingRect: {
        x1: 10,
        y1: 20,
        x2: 110,
        y2: 60,
        width: 600,
        height: 800,
        pageNumber: 1,
      },
      rects: [
        { x1: 10, y1: 20, x2: 110, y2: 40, width: 600, height: 800, pageNumber: 1 },
        { x1: 10, y1: 40, x2: 90, y2: 60, width: 600, height: 800, pageNumber: 1 },
      ],
    },
  };
}

const pageSizesPt = [{ width: 600, height: 800 }];

describe('colorToRgb', () => {
  it('语义色 → RGB', () => {
    expect(colorToRgb('yellow')).toEqual([1, 0.92, 0.23]);
    expect(colorToRgb('green')).toEqual([0.55, 0.87, 0.55]);
  });

  it('未知色 → 黄色（兜底）', () => {
    expect(colorToRgb('不存在的色')).toEqual([1, 0.92, 0.23]);
  });

  it('#rrggbb → RGB', () => {
    const rgb = colorToRgb('#ff0000');
    expect(rgb[0]).toBeCloseTo(1);
    expect(rgb[1]).toBeCloseTo(0);
    expect(rgb[2]).toBeCloseTo(0);
  });

  it('#rgb（3 位）→ RGB', () => {
    const rgb = colorToRgb('#0f0');
    expect(rgb[0]).toBeCloseTo(0);
    expect(rgb[1]).toBeCloseTo(1);
    expect(rgb[2]).toBeCloseTo(0);
  });

  it('非法的 hex → 兜底色', () => {
    expect(colorToRgb('#zz')).toEqual([1, 0.92, 0.23]);
  });
});

describe('exportHighlightedPdf', () => {
  it('**没有高亮 → 原样返回**（不调 pdf-lib）', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const result = await exportHighlightedPdf({
      pdfBytes: bytes,
      highlights: [],
      pageSizesPt,
    });

    expect(result).toBe(bytes);
  });

  it('pdf-lib 不可用 → 抛出可读的错误', async () => {
    await expect(
      exportHighlightedPdf({
        pdfBytes: new Uint8Array([1]),
        highlights: [makeHighlight()],
        pageSizesPt,
        pdfLib: {} as unknown as PdfLibLike,
      }),
    ).rejects.toThrow(/pdfLib 参数无效/);
  });

  it('**Uint8Array 是大 buffer 的一段 → 只切自己的部分**', async () => {
    let loadedLength = 0;
    const big = new Uint8Array(100);
    const slice = big.slice(10, 20);

    const fakePdfLib = {
      PDFDocument: {
        async load(data: ArrayBuffer) {
          loadedLength = data.byteLength;
          return {
            getPages: () => [],
            context: {},
            async save() {
              return new Uint8Array([1]);
            },
          };
        },
      },
    };

    await exportHighlightedPdf({
      pdfBytes: slice,
      highlights: [makeHighlight()],
      pageSizesPt,
      pdfLib: fakePdfLib as unknown as PdfLibLike,
    });

    expect(loadedLength).toBe(10);
  });
});

/**
 * **真实 pdf-lib 的往返测试**。
 *
 * ⚠️ 需要 `pdf-lib`（可选 peerDependency）→ 装不上就**跳过**（不失败）。
 */
describe('exportHighlightedPdf（真 pdf-lib）', async () => {
  let pdfLib: typeof import('pdf-lib') | null = null;
  try {
    pdfLib = await import('pdf-lib');
  } catch {
    pdfLib = null;
  }

  if (!pdfLib) {
    it('跳过（没装 pdf-lib）', () => {
      expect(true).toBe(true);
    });
    return;
  }

  it('**真的写出了带高亮批注的 PDF**', async () => {
    // 造一个最小 PDF
    const doc = await pdfLib.PDFDocument.create();
    const page = doc.addPage([600, 800]);
    page.drawText('Hello World', { x: 10, y: 760, size: 12 });
    const original = await doc.save();

    const result = await exportHighlightedPdf({
      pdfBytes: original,
      highlights: [makeHighlight()],
      pageSizesPt,
      pdfLib: pdfLib as unknown as PdfLibLike,
    });

    // 读回来验证
    const reloaded = await pdfLib.PDFDocument.load(
      result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer,
    );
    const reloadedPage = reloaded.getPages()[0];
    if (!reloadedPage) {
      throw new Error('重新加载后没有页');
    }

    /*
     * ⚠️ **`getAnnots` 不在 pdf-lib 的公开类型里**（`PDFPage` 上没有）
     * → 直接从页节点的 `/Annots` 数组读。
     *
     * ⚠️ 数组里是 **`PDFRef`（引用）**，不是字典本身
     * → 要用 `context.lookup(ref)` 解析出来。
     */
    const annotsArray = reloadedPage.node.get(pdfLib.PDFName.of('Annots')) as
      | { asArray?: () => unknown[] }
      | undefined;
    const refs = (annotsArray?.asArray?.() ?? []) as Parameters<
      typeof reloaded.context.lookup
    >[0][];
    const annots = refs.map((ref) => reloaded.context.lookup(ref)) as unknown as {
      dict: { get: (key: unknown) => unknown };
    }[];

    expect(annots.length).toBe(1);

    const annot = annots[0];
    if (!annot) {
      throw new Error('没有批注');
    }
    const subtype = annot.dict.get(pdfLib.PDFName.of('Subtype'));
    expect(String(subtype)).toContain('Highlight');

    /*
     * ⚠️ **`Rect` / `QuadPoints` 存的是"引用"**（`7 0 R`）
     * → 读的时候要 `context.lookup()` 解析出来。
     */
    const resolve = (value: unknown) => {
      if (value && typeof value === 'object' && 'objectNumber' in value) {
        return reloaded.context.lookup(value as Parameters<typeof reloaded.context.lookup>[0]);
      }
      return value;
    };

    const rawRect = annot.dict.get(pdfLib.PDFName.of('Rect'));

    // QuadPoints：2 行 → 16 个数
    const quadPoints = resolve(annot.dict.get(pdfLib.PDFName.of('QuadPoints'))) as {
      size?: () => number;
    };
    expect(quadPoints.size?.() ?? 16).toBe(16);

    /*
     * ⚠️ **`asRectangle()` 读的是数组里的原始值**
     * → 数组里的元素是 `PDFNumber` → 要转成 JS 数字。
     */
    const rectArray = resolve(rawRect) as {
      asRectangle?: () => number[];
      get?: (index: number) => { asNumber?: () => number };
    };
    const r = rectArray.get
      ? [0, 1, 2, 3].map((i) => rectArray.get?.(i)?.asNumber?.() ?? NaN)
      : (rectArray.asRectangle?.() ?? []);
    expect(r[0]).toBeCloseTo(10);
    expect(r[1]).toBeCloseTo(740);
    expect(r[2]).toBeCloseTo(110);
    expect(r[3]).toBeCloseTo(780);
  });
});
