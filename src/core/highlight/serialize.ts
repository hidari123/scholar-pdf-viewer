/**
 * 高亮的**序列化格式**（导出 / 导入）。
 *
 * ## 为什么放在包里
 *
 * 宿主要"导出 / 导入高亮"，但格式如果各写各的 → **互不兼容**
 * （A 后端存 JSON、B 后端存 Blob、C 端存 localStorage → 换后端就废）。
 *
 * → 包提供**一套标准格式 + 纯函数** → 任何后端都能用。
 *
 * ## 包的边界（重要）
 *
 * 包**只管格式**，不碰存储：
 * - ❌ 不碰 localStorage / IndexedDB / HTTP / fetch
 * - ✅ 只提供纯函数（输入 → 输出）
 *
 * → **换后端不用改包**（这正是"和后端解耦"的含义）。
 *
 * ## 格式
 *
 * ```json
 * {
 *   "version": 1,
 *   "documentId": "doc-123",
 *   "exportedAt": 1732000000000,
 *   "highlights": [
 *     {
 *       "id": "h-1",
 *       "color": "label-6",
 *       "selectedText": "选中的文字",
 *       "position": { "boundingRect": {...}, "rects": [...], "pageNumber": 1 },
 *       "source": "my",
 *       "createdAt": 1732000000000
 *     }
 *   ]
 * }
 * ```
 *
 * `position` 是**归一化坐标**（缩放无关）→ 任何缩放下读回来落点相同。
 */

import type { HighlightRecord } from '../types';

/** 格式版本（以后改格式时靠它做迁移） */
export const HIGHLIGHT_DOC_VERSION = 1;

/** 一份文档的高亮集合（可序列化） */
export interface HighlightDoc {
  /** 格式版本 */
  version: number;
  /** 文档标识（宿主给，比如文件 hash / 业务 id） */
  documentId: string;
  /**
   * 高亮列表。
   *
   * ⚠️ 类型是 `HighlightRecord[]`（不是 `unknown[]`）→ **宿主拿得到类型安全**
   *    → 不用再写 `doc.highlights as HighlightRecord[]`。
   *
   * ⚠️ 但**运行时仍然逐条校验**（数据可能来自用户上传的文件）
   *    → 不合法的条目会被**丢掉**，而不是让包内部崩掉。
   */
  highlights: HighlightRecord[];
  /** 导出时间（ms） */
  exportedAt: number;
}

/**
 * 导出一份文档的高亮。
 *
 * @param documentId 文档标识（宿主给）
 * @param highlights 高亮列表
 * @returns 可序列化的文档对象
 */
export function exportHighlights(
  documentId: string,
  highlights: readonly HighlightRecord[],
): HighlightDoc {
  return {
    version: HIGHLIGHT_DOC_VERSION,
    documentId,
    highlights: highlights.map((h) => JSON.parse(JSON.stringify(h)) as HighlightRecord),
    exportedAt: Date.now(),
  };
}

/**
 * 导入一份文档的高亮（**带校验 + 兜底**）。
 *
 * ⚠️ 为什么必须校验：数据可能来自**用户上传的文件** → 字段可能缺失/类型不对
 * → 不校验就会让包内部崩掉。
 *
 * @param raw 原始数据（通常是 `JSON.parse` 的结果）
 * @returns 解析成功返回文档；失败返回 null
 */
export function importHighlights(raw: unknown): HighlightDoc | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  const documentId = typeof obj.documentId === 'string' ? obj.documentId : '';
  const highlights = Array.isArray(obj.highlights) ? obj.highlights : null;
  if (!highlights) {
    return null;
  }

  /*
   * ⚠️ **逐条过滤掉不合法的高亮**。
   *
   * 数据可能来自外部（用户上传）→ 某一条坏了不能让整份文档都废掉。
   *
   * ⚠️ 过滤后**断言成 `HighlightRecord[]`**：
   *    - 运行时只校验了 `id` 和 `position`（够画出来）
   *    - 其余字段（`color` / `selectedText` …）由**渲染层**兜底
   */
  const valid = highlights.filter((h): h is Record<string, unknown> => {
    if (!h || typeof h !== 'object') {
      return false;
    }
    const record = h as Record<string, unknown>;
    // 至少要有 id 和 position（没有位置就没法画）
    return (
      typeof record.id === 'string' && !!record.position && typeof record.position === 'object'
    );
  }) as unknown as HighlightRecord[];

  const version = typeof obj.version === 'number' ? obj.version : HIGHLIGHT_DOC_VERSION;

  return {
    version,
    documentId,
    highlights: valid,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : Date.now(),
  };
}

/**
 * 转成 JSON 字符串（可直接存 / 传）。
 *
 * @param doc 高亮文档
 * @returns JSON 字符串
 */
export function stringifyHighlightDoc(doc: HighlightDoc): string {
  return JSON.stringify(doc, null, 2);
}

/**
 * 从 JSON 字符串解析（**永不抛异常**）。
 *
 * @param text JSON 字符串
 * @returns 解析成功返回文档；失败返回 null
 */
export function parseHighlightDoc(text: string): HighlightDoc | null {
  try {
    return importHighlights(JSON.parse(text));
  } catch {
    return null;
  }
}
