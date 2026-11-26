/**
 * 高亮块操作条的**内置动作**。
 *
 * ## 为什么单独一个文件
 *
 * 选区浮层和**高亮浮层**用的是**同一套 UI**（`SelectionPopover`），
 * 但动作不同：
 *
 * | 场景       | 动作                                                |
 * | ---------- | --------------------------------------------------- |
 * | 选中文字   | 高亮 / 复制 / 翻译 / 提问 / 笔记 / 删除选区         |
 * | 点中高亮块 | **添加批注 / 选择颜色 / 复制 / 删除**（用户要求的 4 个） |
 *
 * → 动作的构造逻辑分开，但**渲染**复用。
 *
 * ## 包的边界
 *
 * 包**只提供 UI + 事件**，不做业务：
 * - 添加批注 → 抛 `onHighlightComment(id)`，宿主决定怎么存 / 怎么编辑
 * - 换色 → 抛 `onHighlightUpdate(id, { color })`，宿主决定怎么存
 * - 删除 → 抛 `onHighlightRemove(id)`，宿主决定怎么删
 * - 复制 → 内置实现（写剪贴板），也可由宿主接管
 *
 * **宿主没传回调 ⇒ 对应按钮不渲染**（和选区浮层一致）。
 */

import type { MessageKey } from '../../i18n/messages';
import type { SelectionAction } from './actions';

/** 高亮动作的 key */
export const HIGHLIGHT_ACTION_KEYS = {
  /** 添加批注（WPS 式小便签） */
  comment: 'highlight-comment',
  /** 选择高亮颜色 */
  color: 'highlight-color',
  /** 复制文字 */
  copy: 'highlight-copy',
  /** 删除高亮 */
  remove: 'highlight-remove',
  /** 更多（宿主自定义） */
  more: 'highlight-more',
} as const;

/**
 * **高亮动作的文案 key**。
 *
 * ⚠️⚠️ **之前这里是硬编码的中文**（审计发现的**真 bug**）：
 *
 * ```ts
 * export const HIGHLIGHT_ACTION_LABELS = {
 *   [HIGHLIGHT_ACTION_KEYS.comment]: '添加批注',   // ← 永远是中文
 *   ...
 * };
 * ```
 *
 * -> 高亮浮层（点高亮块）**永远是中文** ❌
 * -> 选区浮层（选中文字）走 i18n -> **英文**
 * -> **两个浮层并排 -> "中英文混杂"**
 *   （用户反馈："语言他自己会动来动去的"）
 *
 * -> 现在：**改成 key -> MessageKey 的映射**
 *   -> 标签由**宿主的 `t()`** 解析 -> 跟着语言走
 */
export const HIGHLIGHT_ACTION_MESSAGE_KEYS = {
  [HIGHLIGHT_ACTION_KEYS.comment]: 'highlight.actionComment',
  [HIGHLIGHT_ACTION_KEYS.color]: 'highlight.actionColor',
  [HIGHLIGHT_ACTION_KEYS.copy]: 'highlight.actionCopy',
  [HIGHLIGHT_ACTION_KEYS.remove]: 'highlight.actionRemove',
  [HIGHLIGHT_ACTION_KEYS.more]: 'highlight.actionMore',
} as const satisfies Record<string, MessageKey>;

/** 高亮动作的参数 */
export interface HighlightActionOptions {
  /** 添加批注（宿主实现：打开批注编辑框、存批注） */
  onHighlightComment?: (id: string) => void;
  /** 换色（宿主实现：更新高亮的颜色） */
  onHighlightUpdate?: (id: string, patch: { color?: string }) => void;
  /** 删除高亮（宿主实现：删掉这条高亮） */
  onHighlightRemove?: (id: string) => void;
  /** 复制（宿主接管；不传则用内置的剪贴板实现） */
  onHighlightCopy?: (text: string) => void;
  /** 更多（宿主自定义动作） */
  onHighlightMore?: (id: string) => void;
  /**
   * **文案解析**（`key -> 当前语言的文案`）。
   *
   * ⚠️ **必须传** -> 否则标签会退化成 `key` 本身 ❌
   * -> 宿主传 `t`（包内部已经有了）
   */
  t?: (key: MessageKey) => string;
}

/**
 * 构造高亮块操作条的动作列表。
 *
 * ⚠️ **规则和选区浮层一致**：宿主没传回调 ⇒ 按钮不渲染。
 *
 * ⚠️ **顺序就是用户看到的顺序**（用户要求）：
 * ```
 * 添加批注 / 选择高亮颜色 / 复制 / 删除
 * ```
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

  /*
   * ⚠️ **标签解析**（跟着语言走）。
   *
   * -> 宿主没传 `t` -> 退化成 **`key` 本身**（而不是中文）
   *   -> 宁可显示 `highlight.actionCopy`，也不显示错语言的中文
   */
  const resolveLabel = (actionKey: string): string => {
    const messageKey =
      HIGHLIGHT_ACTION_MESSAGE_KEYS[actionKey as keyof typeof HIGHLIGHT_ACTION_MESSAGE_KEYS];
    if (!messageKey) {
      return actionKey;
    }
    return options.t?.(messageKey) ?? messageKey;
  };

  /*
   * ① 添加批注（**宿主没传 `onHighlightComment` → 不显示**）。
   *
   * → 和 WPS 一致：在高亮旁边贴一个**小便签** → hover 显示内容。
   */
  if (options.onHighlightComment) {
    actions.push({
      key: HIGHLIGHT_ACTION_KEYS.comment,
      icon: 'stickyNote',
      label: resolveLabel(HIGHLIGHT_ACTION_KEYS.comment),
      group: 'primary',
      order: 10,
      onSelect: () => {
        options.onHighlightComment?.(highlightId);
      },
    });
  }

  /*
   * ② 选择高亮颜色（**必须有宿主实现**才有意义 → 没传就不显示）。
   *
   * ⚠️ 这个按钮**本身不换色**，而是**展开颜色下拉**（由浮层组件负责）。
   *    → 浮层组件通过 `highlightPalette` + `onPickColor` 判断要不要显示下拉。
   */
  if (options.onHighlightUpdate) {
    actions.push({
      key: HIGHLIGHT_ACTION_KEYS.color,
      icon: 'highlightColor',
      label: resolveLabel(HIGHLIGHT_ACTION_KEYS.color),
      group: 'primary',
      order: 20,
      onSelect: (ctx) => {
        /*
         * ⚠️ 颜色下拉由浮层组件负责（`highlightPalette` + `onPickColor`），
         *    这里只在"换色"动作被直接触发时兜底。
         */
        options.onHighlightUpdate?.(highlightId, { color: ctx.color });
      },
    });
  }

  // ③ 复制（内置实现，宿主可接管）
  actions.push({
    key: HIGHLIGHT_ACTION_KEYS.copy,
    icon: 'copy',
    label: resolveLabel(HIGHLIGHT_ACTION_KEYS.copy),
    group: 'primary',
    order: 30,
    onSelect: () => {
      if (options.onHighlightCopy) {
        options.onHighlightCopy(text);
        return;
      }
      void navigator.clipboard?.writeText(text).catch(() => undefined);
    },
  });

  // ④ 删除（**宿主没传 `onHighlightRemove` → 不显示**）
  if (options.onHighlightRemove) {
    actions.push({
      key: HIGHLIGHT_ACTION_KEYS.remove,
      icon: 'trash',
      label: resolveLabel(HIGHLIGHT_ACTION_KEYS.remove),
      group: 'primary',
      order: 40,
      onSelect: () => {
        options.onHighlightRemove?.(highlightId);
      },
    });
  }

  // 更多（宿主自定义）
  if (options.onHighlightMore) {
    actions.push({
      key: HIGHLIGHT_ACTION_KEYS.more,
      icon: 'more',
      label: resolveLabel(HIGHLIGHT_ACTION_KEYS.more),
      group: 'primary',
      order: 50,
      onSelect: () => {
        options.onHighlightMore?.(highlightId);
      },
    });
  }

  return actions;
}
