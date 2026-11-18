/**
 * 高亮块操作条的**内置动作**。
 *
 * ## 为什么单独一个文件
 *
 * 选区浮层和**高亮浮层**用的是**同一套 UI**（`SelectionPopover`），
 * 但动作不同：
 *
 * | 场景       | 动作                                        |
 * | ---------- | ------------------------------------------- |
 * | 选中文字   | 高亮 / 复制 / 翻译 / 提问 / 笔记 / 删除选区  |
 * | 点中高亮块 | 换色 / 复制 / 删除 / 更多                   |
 *
 * → 动作的构造逻辑分开，但**渲染**复用。
 *
 * ## 包的边界
 *
 * 包**只提供 UI + 事件**，不做业务：
 * - 换色 → 抛 `onHighlightUpdate(id, { color })`，宿主决定怎么存
 * - 删除 → 抛 `onHighlightRemove(id)`，宿主决定怎么删
 * - 复制 → 内置实现（写剪贴板），也可由宿主接管
 *
 * **宿主没传回调 ⇒ 对应按钮不渲染**（和选区浮层一致）。
 */

import type { SelectionAction } from './actions';

/** 高亮动作的 key */
export const HIGHLIGHT_ACTION_KEYS = {
  /** 换色 */
  color: 'highlight-color',
  /** 复制文字 */
  copy: 'highlight-copy',
  /** 删除高亮 */
  remove: 'highlight-remove',
  /** 更多（宿主自定义） */
  more: 'highlight-more',
} as const;

/** 高亮动作的默认标签 */
export const HIGHLIGHT_ACTION_LABELS: Record<string, string> = {
  [HIGHLIGHT_ACTION_KEYS.color]: '换色',
  [HIGHLIGHT_ACTION_KEYS.copy]: '复制',
  [HIGHLIGHT_ACTION_KEYS.remove]: '删除',
  [HIGHLIGHT_ACTION_KEYS.more]: '更多',
};

/** 高亮动作的参数 */
export interface HighlightActionOptions {
  /** 换色（宿主实现：更新高亮的颜色） */
  onHighlightUpdate?: (id: string, patch: { color?: string }) => void;
  /** 删除高亮（宿主实现：删掉这条高亮） */
  onHighlightRemove?: (id: string) => void;
  /** 复制（宿主接管；不传则用内置的剪贴板实现） */
  onHighlightCopy?: (text: string) => void;
  /** 更多（宿主自定义动作） */
  onHighlightMore?: (id: string) => void;
}

/**
 * 构造高亮块操作条的动作列表。
 *
 * ⚠️ **规则和选区浮层一致**：宿主没传回调 ⇒ 按钮不渲染。
 *
 * @param highlightId 当前高亮的 id
 * @param text 高亮的文字（复制用）
 * @param options 宿主的回调
 * @returns 动作列表
 */
export function buildHighlightActions(
  highlightId: string,
  text: string,
  options: HighlightActionOptions,
): SelectionAction[] {
  const actions: SelectionAction[] = [];

  // 换色（**必须有宿主实现**才有意义 → 没传就不显示）
  if (options.onHighlightUpdate) {
    actions.push({
      key: HIGHLIGHT_ACTION_KEYS.color,
      icon: 'highlight',
      label: HIGHLIGHT_ACTION_LABELS[HIGHLIGHT_ACTION_KEYS.color],
      group: 'primary',
      order: 10,
      onSelect: (ctx) => {
        /*
         * ⚠️ 颜色下拉由浮层组件负责（`highlightPalette` + `onPickColor`），
         *    这里只在"换色"动作被直接触发时兜底。
         */
        options.onHighlightUpdate?.(highlightId, { color: ctx.color });
      },
    });
  }

  // 复制（内置实现，宿主可接管）
  actions.push({
    key: HIGHLIGHT_ACTION_KEYS.copy,
    icon: 'copy',
    label: HIGHLIGHT_ACTION_LABELS[HIGHLIGHT_ACTION_KEYS.copy],
    group: 'primary',
    order: 20,
    onSelect: () => {
      if (options.onHighlightCopy) {
        options.onHighlightCopy(text);
        return;
      }
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    },
  });

  // 删除（**宿主没传 `onHighlightRemove` → 不显示**）
  if (options.onHighlightRemove) {
    actions.push({
      key: HIGHLIGHT_ACTION_KEYS.remove,
      icon: 'delete',
      label: HIGHLIGHT_ACTION_LABELS[HIGHLIGHT_ACTION_KEYS.remove],
      group: 'primary',
      order: 30,
      onSelect: () => {
        options.onHighlightRemove?.(highlightId);
      },
    });
  }

  // 更多（宿主自定义）
  if (options.onHighlightMore) {
    actions.push({
      key: HIGHLIGHT_ACTION_KEYS.more,
      icon: 'explain',
      label: HIGHLIGHT_ACTION_LABELS[HIGHLIGHT_ACTION_KEYS.more],
      group: 'primary',
      order: 40,
      onSelect: () => {
        options.onHighlightMore?.(highlightId);
      },
    });
  }

  return actions;
}
