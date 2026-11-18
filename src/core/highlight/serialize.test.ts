import { describe, expect, it } from 'vitest';
import type { HighlightRecord } from '../types';
import {
  exportHighlights,
  HIGHLIGHT_DOC_VERSION,
  importHighlights,
  parseHighlightDoc,
  stringifyHighlightDoc,
} from './serialize';

/** 造一条合法的高亮（字段完整） */
function makeHighlight(overrides: Partial<HighlightRecord> = {}): HighlightRecord {
  return {
    id: 'h1',
    color: 'yellow',
    selectedText: '选中的文字',
    position: {
      pageNumber: 1,
      rects: [],
      boundingRect: {
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 1,
        width: 600,
        height: 800,
        pageNumber: 1,
      },
    },
    ...overrides,
  };
}

describe('exportHighlights', () => {
  it('导出带版本号 / 文档 id / 时间戳', () => {
    const doc = exportHighlights('doc-1', []);

    expect(doc.version).toBe(HIGHLIGHT_DOC_VERSION);
    expect(doc.documentId).toBe('doc-1');
    expect(doc.exportedAt).toBeGreaterThan(0);
    expect(doc.highlights).toEqual([]);
  });

  it('导出的是**深拷贝**（改源不影响导出结果）', () => {
    const source = [makeHighlight()];
    const doc = exportHighlights('doc-1', source);

    // 改源 → 导出结果不变
    const first = source[0];
    if (first) {
      first.color = 'pink';
    }

    expect(doc.highlights[0]?.color).toBe('yellow');
  });
});

describe('importHighlights', () => {
  it('正常导入', () => {
    const raw = {
      version: 1,
      documentId: 'doc-1',
      exportedAt: 100,
      highlights: [{ id: 'h1', position: { pageNumber: 1 } }],
    };

    const doc = importHighlights(raw);

    expect(doc).not.toBeNull();
    expect(doc?.documentId).toBe('doc-1');
    expect(doc?.highlights).toHaveLength(1);
  });

  /*
   * ⚠️ **数据可能来自外部**（用户上传的文件）
   * → 字段可能缺失 / 类型不对 → 不校验就会让包内部崩掉。
   */
  it('非对象 → null', () => {
    expect(importHighlights(null)).toBeNull();
    expect(importHighlights(undefined)).toBeNull();
    expect(importHighlights('abc')).toBeNull();
    expect(importHighlights(123)).toBeNull();
  });

  it('highlights 不是数组 → null', () => {
    expect(importHighlights({ documentId: 'x', highlights: 'nope' })).toBeNull();
    expect(importHighlights({ documentId: 'x' })).toBeNull();
  });

  it('缺失的字段用默认值兜底', () => {
    const doc = importHighlights({ highlights: [] });

    expect(doc).not.toBeNull();
    expect(doc?.version).toBe(HIGHLIGHT_DOC_VERSION);
    expect(doc?.documentId).toBe('');
    expect(doc?.exportedAt).toBeGreaterThan(0);
  });

  /*
   * ⚠️ **逐条过滤**（而不是整份文档都废掉）。
   */
  it('不合法的高亮被过滤掉，合法���保留', () => {
    const doc = importHighlights({
      documentId: 'x',
      highlights: [
        { id: 'ok', position: { pageNumber: 1 } },
        { id: 'no-position' },
        null,
        'string',
        { position: { pageNumber: 1 } },
      ],
    });

    expect(doc?.highlights).toHaveLength(1);
    expect(doc?.highlights[0]?.id).toBe('ok');
  });
});

describe('stringify / parse', () => {
  it('导出 → 字符串 → 导入，round-trip 保持数据', () => {
    // ⚠️ 高亮必须**有 id 和 position**（没位置就没法画）→ 导入时会被过滤
    const highlights = [makeHighlight({ color: 'label-6' })];
    const doc = exportHighlights('doc-1', highlights);

    const text = stringifyHighlightDoc(doc);
    const parsed = parseHighlightDoc(text);

    expect(parsed).not.toBeNull();
    expect(parsed?.documentId).toBe('doc-1');
    expect(parsed?.highlights).toHaveLength(1);
  });

  it('非法 JSON → null（**永不抛异常**）', () => {
    expect(parseHighlightDoc('{ not json')).toBeNull();
    expect(parseHighlightDoc('')).toBeNull();
  });

  it('JSON 合法但结构不对 → null', () => {
    expect(parseHighlightDoc('{"a":1}')).toBeNull();
  });
});
