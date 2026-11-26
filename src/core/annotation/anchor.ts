/**
 * **批注详情的锚点查找**（便签在哪 -> 面板贴哪）。
 *
 * ## 为什么需要这个模块（实测踩到的坑，用户反馈）
 *
 * > "如果同一位置两个批注 那么第一个批注点击之后展示位置正常
 * >  第二个批注详情点击之后还是会出现在pdf的首页位置
 * >  而且滚动的时候 定位也跑来跑去的"
 *
 * ### 真因
 *
 * -> 同一位置的多个批注会被**合并成一个图标**
 * -> DOM 上那个图标只有 `data-note-id={first.id}`（**第一条**的 id）❌
 * -> 之前按 `activeAnnotationId` **精确匹配** ❌
 *    -> 选**第二条**批注 -> **找不到元素** ❌
 *    -> -> 锚点**保持上一次的旧值** ❌
 *    -> -> 面板停在上次的位置（第一次打开时是**首页**）❌
 *
 * ### 修法
 *
 * -> 图标上带**整组**的 id（`data-note-ids="a,b"`）
 * -> 查找时找**"包含这个 id"**的图标
 * -> -> 任何一条批注都能定位到**同一个图标**
 */

/** 便签图标的 class（锚点查找用） */
export const STICKY_NOTE_ICON_CLASS = 'scpdf-sticky-note__icon';

/**
 * 在容器里找**某个批注**对应的便签图标。
 *
 * ⚠️ **合并组**：多个批注共用**一个**图标
 * -> 优先用 `data-note-ids`（整组）匹配
 * -> 再退回 `data-note-id`（单条）
 *
 * @param container 容器元素
 * @param noteId 批注 id
 * @returns 找到的图标元素；找不到返回 null
 */
export function findStickyNoteIcon(
  container: HTMLElement | null,
  noteId: string | null,
): HTMLElement | null {
  if (!container || !noteId) {
    return null;
  }

  const escaped = CSS.escape(noteId);

  /*
   * ⚠️ **先按【整组】找**（合并组的图标）
   *
   * -> \`data-note-ids="a,b"\` -> 用 \`[data-note-ids~="b"]\` 匹配
   *
   * ⚠️⚠️ **但 \`~=\` 只按【空格】分隔**（不是逗号）❌
   * -> \`[data-note-ids~="b"]\` 对 \`"a,b"\` **不匹配** ❌
   *    -> 实测：合并组的第二条**找不到** ❌
   *
   * -> 两个办法：
   *    1. 属性里用**空格**分隔 -> \`~=\` 直接能用
   *    2. 自己**遍历**比对
   * -> 选 2：**不依赖 CSS 选择器的分隔符语义**  -> 更稳
   */
  const icons = container.querySelectorAll<HTMLElement>(`.${STICKY_NOTE_ICON_CLASS}`);
  for (const icon of icons) {
    const group = icon.getAttribute('data-note-ids');
    if (!group) {
      continue;
    }
    // ⚠️ **逗号分隔**（和写进去的格式一致）
    if (group.split(',').some((id) => id.trim() === noteId)) {
      return icon;
    }
  }

  /*
   * -> 退回**单条**匹配（非合并的便签）
   */
  return container.querySelector<HTMLElement>(
    `.${STICKY_NOTE_ICON_CLASS}[data-note-id="${escaped}"]`,
  );
}
