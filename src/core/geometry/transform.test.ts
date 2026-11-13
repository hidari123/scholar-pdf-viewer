import { describe, expect, it } from 'vitest';
import type { BboxCoord, PdfViewportLike } from '../types';
import { normToPdf, normToView, pdfToNorm, pdfToView, viewToNorm, viewToPdf } from './transform';

/** 固定页面尺寸（Letter，PDF 点） */
const PAGE = { width: 612, height: 792, rotation: 0 };

/** 取 4 个数字（viewport API 的签名是 number[]，测试替身与实现同口径收窄） */
const quad = (rect: number[]): [number, number, number, number] => {
  const [x1, y1, x2, y2] = rect;
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new Error(`bad rect: ${rect.length}`);
  }
  return [x1, y1, x2, y2];
};

/** 完整 API形态的 viewport（pdf.js PageViewport 的最小替身） */
const apiViewport = (scale: number): PdfViewportLike => ({
  width: PAGE.width * scale,
  height: PAGE.height * scale,
  scale,
  convertToViewportRectangle: (rect) => {
    const [x1, y1, x2, y2] = quad(rect);
    return [x1 * scale, (PAGE.height - y2) * scale, x2 * scale, (PAGE.height - y1) * scale];
  },
  convertToPdfPoint: (x, y) => [x / scale, PAGE.height - y / scale],
});

/** 只有尺寸的 viewport（走纯数学回退路径） */
const plainViewport = (scale: number): PdfViewportLike => ({
  width: PAGE.width * scale,
  height: PAGE.height * scale,
  scale,
});

describe('view ↔ norm（wire 语义）', () => {
  it('viewToNorm：x1=left, y1=top, x2=left+width, y2=top+height，参考尺寸=采集时视口', () => {
    const rect = { left: 100, top: 200, width: 300, height: 60, pageNumber: 2 };
    expect(viewToNorm(rect, { width: 800, height: 1000 })).toEqual({
      x1: 100,
      y1: 200,
      x2: 400,
      y2: 260,
      width: 800,
      height: 1000,
      pageNumber: 2,
    });
  });

  it('normToView：按 当前视口/采集时视口 线性映射', () => {
    const norm = {
      x1: 100,
      y1: 200,
      x2: 400,
      y2: 260,
      width: 800,
      height: 1000,
      pageNumber: 2,
    };
    expect(normToView(norm, { width: 400, height: 500 })).toEqual({
      left: 50,
      top: 100,
      width: 150,
      height: 30,
      pageNumber: 2,
    });
  });

  it('缩放无关：同一份 wire 数据在 1x 与 0.5x 下落在同一比例位置', () => {
    const capture = { width: 800, height: 1000 };
    const rect = { left: 100, top: 200, width: 300, height: 60, pageNumber: 1 };
    const norm = viewToNorm(rect, capture);

    const at1x = normToView(norm, capture);
    const atHalf = normToView(norm, { width: 400, height: 500 });

    expect(at1x.left / capture.width).toBeCloseTo(atHalf.left / 400);
    expect(atHalf.left).toBeCloseTo(50);
    expect(atHalf.top).toBeCloseTo(100);
    expect(atHalf.width).toBeCloseTo(150);
    expect(atHalf.height).toBeCloseTo(30);
  });
});

describe('pdf 点 ↔ 视口 px', () => {
  const BBOX: BboxCoord = [72, 720, 144, 756];

  it('pdfToView：优先走 viewport API', () => {
    expect(pdfToView(BBOX, apiViewport(2), PAGE, 3)).toEqual({
      left: 144,
      top: 72,
      width: 144,
      height: 72,
      pageNumber: 3,
    });
  });

  it('pdfToView：无 API 时按 rotation=0 纯数学回退', () => {
    expect(pdfToView(BBOX, plainViewport(2), PAGE, 1)).toEqual({
      left: 144,
      top: 72,
      width: 144,
      height: 72,
      pageNumber: 1,
    });
  });

  it('同数据：API 路径与回退路径结果一致（rotation=0）', () => {
    expect(pdfToView(BBOX, apiViewport(2), PAGE, 1)).toEqual(
      pdfToView(BBOX, plainViewport(2), PAGE, 1),
    );
  });

  it('rotation≠0 且无 API 时抛错（不做不可信回退）', () => {
    expect(() => pdfToView(BBOX, plainViewport(1), { ...PAGE, rotation: 90 }, 1)).toThrow();
  });

  it('viewToPdf：与 pdfToView 往返一致（回退路径）', () => {
    const view = { left: 144, top: 72, width: 144, height: 72, pageNumber: 1 };
    const [x1, y1, x2, y2] = viewToPdf(view, plainViewport(2), PAGE);
    expect(x1).toBeCloseTo(72);
    expect(y1).toBeCloseTo(720);
    expect(x2).toBeCloseTo(144);
    expect(y2).toBeCloseTo(756);
  });

  it('bbox 输出规范化为 [minX, minY, maxX, maxY]', () => {
    const [x1, y1, x2, y2] = viewToPdf(
      { left: 144, top: 72, width: 144, height: 72, pageNumber: 1 },
      apiViewport(1),
      PAGE,
    );
    expect(x1).toBeLessThan(x2);
    expect(y1).toBeLessThan(y2);
  });
});

describe('组合路径', () => {
  it('pdfToNorm / normToPdf 往返还原原 bbox', () => {
    const viewport = apiViewport(1);
    const bbox: BboxCoord = [72, 720, 144, 756];
    const norm = pdfToNorm(bbox, viewport, PAGE, 1);

    expect(norm.width).toBe(viewport.width);
    expect(norm.height).toBe(viewport.height);

    const [rx1, ry1, rx2, ry2] = normToPdf(norm, viewport, PAGE);
    const [bx1, by1, bx2, by2] = bbox;
    expect(rx1).toBeCloseTo(bx1);
    expect(ry1).toBeCloseTo(by1);
    expect(rx2).toBeCloseTo(bx2);
    expect(ry2).toBeCloseTo(by2);
  });
});
