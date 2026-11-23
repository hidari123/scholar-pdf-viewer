/**
 * **内部链接的上下文**（`onInternalLink` 的参数）。
 *
 * ## ⚠️⚠️ **语义变更**（用户明确要求：
 * "包都自动跳 但是提供取消回调给宿主 宿主可以自己控制不让他跳
 *  目标页=当前页 如果定位行数不一样也是要跳转的"）
 *
 * -> 之前是 `onInternalLink(dest, pageNumber)` ❌
 *   -> `pageNumber` 是**链接所在页**，**不是目标页** ❌
 *   -> 宿主拿到它没法用 ❌
 * -> 现在：**一个对象**，字段都明确 ✅
 */
export interface InternalLinkContext {
  /**
   * **原始 dest**。
   *
   * - 数组形态：`[pageRef, '/XYZ', left, top, zoom]` ✅
   * - 字符串形态：命名目标（如 `"section.1"`）✅
   */
  dest: string | unknown[];
  /**
   * **目标页**（包解析出来的）。
   *
   * -> 解析不出时是 `null`（比如宿主没给 `resolvePageRef`）✅
   * -> 宿主可以自己兜底（比如用 `dest` 里的信息）✅
   */
  targetPage: number | null;
  /** **链接所在的页**（不是目标页） */
  currentPage: number;
  /**
   * **目标在这一页内的 y 坐标**（PDF 点坐标）。
   *
   * -> dest 数组的第 4 个元素（`dest[3]`）✅
   * -> **目标页 == 当前页**时靠它滚到**那一行** ✅
   *   -> 只跳页顶的话**看不到目标** ❌
   */
  targetY: number | null;
  /**
   * **取消这次跳转**（宿主调用它 -> 包就不跳了）。
   *
   * -> 宿主想自己接管（比如弹一个自己的确认框）✅
   * -> **不调用** -> 包**自动跳** ✅（默认行为）
   */
  cancel: () => void;
}
