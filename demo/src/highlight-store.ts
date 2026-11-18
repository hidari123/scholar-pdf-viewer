/**
 * **高亮的持久化**（宿主侧示例）。
 *
 * ## 为什么在宿主而不是包里
 *
 * 包的边界（v2 原则）：**包只给"格式 + 纯函数"，不碰存储**。
 * → 换后端（localStorage → IndexedDB → 自己的接口）**不用改包**。
 *
 * 这里用 **localStorage**（方案 A）：
 * - 单机使用、小数据量
 * - 换别的方案只需要改这个文件
 *
 * ⚠️ **每次改动都保存**（用户要求）→ 用**防抖**合并连续操作。
 */

import type { HighlightRecord } from '@scholar-club/pdf-viewer';
import { exportHighlights, importHighlights } from '@scholar-club/pdf-viewer';

/** localStorage 的 key 前缀 */
const KEY_PREFIX = 'scholar-pdf-viewer:highlights:';

/** 读一份文档的高亮 */
export function loadHighlights(documentId: string): HighlightRecord[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY_PREFIX + documentId);
    if (!raw) {
      return [];
    }
    const doc = importHighlights(JSON.parse(raw));
    return doc?.highlights ?? [];
  } catch {
    // 数据坏了 → 当成没有（不要让宿主整个崩掉）
    return [];
  }
}

/** 写一份文档的高亮 */
export function saveHighlights(documentId: string, highlights: readonly HighlightRecord[]): void {
  try {
    const doc = exportHighlights(documentId, highlights);
    globalThis.localStorage?.setItem(KEY_PREFIX + documentId, JSON.stringify(doc));
  } catch {
    // 配额满了 / 隐私模式禁用了存储 → 忽略（不影响使用）
  }
}

/** 防抖的保存器（500ms） */
export function createDebouncedSaver(delay = 500): {
  schedule: (documentId: string, highlights: readonly HighlightRecord[]) => void;
  flush: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { documentId: string; highlights: readonly HighlightRecord[] } | null = null;

  const flush = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending) {
      saveHighlights(pending.documentId, pending.highlights);
      pending = null;
    }
  };

  return {
    schedule(documentId, highlights) {
      pending = { documentId, highlights };
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(flush, delay);
    },
    flush,
  };
}
