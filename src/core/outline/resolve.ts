/**
 * outline —— **目录页码的异步解析**。
 *
 * ## 用户反馈
 *
 * > "目录还是无法点击跳转"
 *
 * ### 之前的问题
 *
 * 目录的页码来自宿主的 `pageRefToNumber`（**同步**回调）。
 * 但 pdf.js 的 `getPageIndex(ref)` 是**异步**的 → 宿主必须：
 *
 * 1. 先把目录里的所有页引用收集出来
 * 2. **异步**逐个 `getPageIndex` 解析
 * 3. 建一张 `Map`
 * 4. 再把 `resolveToken` +1 通知包
 *
 * → **宿主要写 50+ 行**（demo 就是这么写的）❌
 * → 宿主漏了第 4 步 → **目录点了没反应**（用户看到的现象）❌
 *
 * ### 现在的做法
 *
 * → 包**自己**接受一个**异步**解析器：`resolvePageRef?: (ref) => Promise<number | null>`
 * → 包在拿到目录后**自动**解析所有页引用 → **建好映射** → 目录立刻可跳转 ✅
 * → 宿主的 `pageRefToNumber` **仍然支持**（优先用它，因为它可能是同步的）✅
 */

import type { OutlineItemLike } from './outline';
import { collectOutlineRefs } from './outline';

/**
 * **异步解析器**（宿主注入）。
 *
 * → 形状和 pdf.js 的 `doc.getPageIndex(ref)` 一致（返回 0-based，要 +1）✅
 */
export type ResolvePageRef = (ref: unknown) => Promise<number | null>;

/**
 * **异步解析目录里的所有页引用 → 页码**。
 *
 * → 结果是**同步**的映射函数（和 `pageRefToNumber` 一个形状）✅
 * → 解析不出来就跳过（不抛）✅
 *
 * @param outline 目录树
 * @param resolvePageRef 异步解析器（pdf.js 的 `getPageIndex` 就这个形状）
 * @returns 页引用 → 页码的映射
 */
export async function resolveOutlinePageNumbers(
  outline: OutlineItemLike[] | null,
  resolvePageRef: (ref: unknown) => Promise<number | null>,
): Promise<(ref: unknown) => number | null> {
  const refs = collectOutlineRefs(outline);
  const map = new Map<string, number>();

  const keyOf = (ref: unknown): string => {
    if (typeof ref === 'string') {
      return `s:${ref}`;
    }
    if (ref && typeof ref === 'object') {
      const target = ref as { num?: number; gen?: number };
      if (typeof target.num === 'number') {
        return `r:${target.num}R${target.gen ?? 0}`;
      }
    }
    return `o:${String(ref)}`;
  };

  await Promise.all(
    refs.map(async (ref) => {
      try {
        const pageNumber = await resolvePageRef(ref);
        if (pageNumber !== null && pageNumber >= 1) {
          map.set(keyOf(ref), pageNumber);
        }
      } catch {
        // 解析失败 → 跳过（这一项就跳不了）
      }
    }),
  );

  return (ref: unknown): number | null => {
    if (typeof ref === 'string') {
      return map.get(`s:${ref}`) ?? null;
    }
    if (ref && typeof ref === 'object') {
      const target = ref as { num?: number; gen?: number };
      if (typeof target.num === 'number') {
        return map.get(`r:${target.num}R${target.gen ?? 0}`) ?? null;
      }
    }
    return map.get(`o:${String(ref)}`) ?? null;
  };
}
