/**
 * **工具栏的"选中态"**（纯逻辑，零 React、零 DOM）。
 *
 * ## 用户需求
 *
 * > "点了加粗之后 加粗按钮没加深颜色 别的按钮也一样 看不出点击了"
 *
 * ## 根因
 *
 * → 之前的工具栏**只知道"点了哪个命令"**，**不知道"当前选区是什么格式"** ❌
 * → 按钮点完就结束 -> 从不回头看编辑器 -> 没有任何"按下态"
 *
 * ## 现在的做法
 *
 * → 编辑器每次**选区变化 / 文档变化** -> 报一次"哪些按钮是激活的"
 * → 工具栏按这个结果渲染 `data-active` + `aria-pressed`
 * → CSS 用 `data-active="true"` 画**明显的按下态**（主色底 + 主色图标）
 */

/**
 * **编辑器的能力接口**（只声明我们要用的那几个方法）。
 *
 * ⚠️ **不 import TipTap 的类型** -> 这个模块要能被**独立测试**
 * ⚠️ **不 import TipTap 的值** -> 主入口的体积不受影响
 */
export interface ToolbarStateEditor {
  /** 当前选区里某个 mark / 节点是否是激活的 */
  isActive: (
    nameOrAttrs: string | Record<string, unknown>,
    attributes?: Record<string, unknown>,
  ) => boolean;
  /**
   * **当前有没有选中文字**（没选 -> 格式按钮应该置灰）。
   *
   * ⚠️ 用户需求："清除格式按钮如果没有选择文字 应该置灰"
   */
  hasSelection?: () => boolean;
  /** 编辑器能不能撤销 / 重做 */
  can: () => boolean;
  /** 撤销命令（配合 `can()` 用） */
  canUndo?: () => boolean;
  /** 重做命令（配合 `can()` 用） */
  canRedo?: () => boolean;
}

/**
 * **一个工具栏按钮的"激活状态"**。
 */
export interface ToolbarActiveState {
  /** 按钮的 command（用于做 key） */
  command: string;
  /** 是否激活（当前选区就是这个格式） */
  active: boolean;
  /** 是否**不可用**（比如没有可撤销的历史） */
  disabled: boolean;
  /**
   * **当前有没有选中文字**。
   *
   * ⚠️ 用户需求："清除格式按钮如果没有选择文字 应该置灰"
   * -> 没选文字 -> 格式类命令（清除格式 / 文字颜色 / 高亮）**置灰**
   * -> 选中了 -> 正常
   */
  hasSelection: boolean;
}

/**
 * **命令 → TipTap 的 `isActive` 参数**的映射。
 *
 * ⚠️ **每个 command 都要有** -> 否则按钮永远不亮 ❌
 * ⚠️ **颜色类要带属性** -> `foreColor` 光看"有没有文字颜色"不够，
 *    得看**是不是当前这个颜色**
 */
const ACTIVE_CHECKS: Record<string, string | Record<string, unknown>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strikeThrough: 'strike',
  hiliteColor: 'highlight',
  foreColor: 'textStyle',
  createLink: 'link',
  insertUnorderedList: 'bulletList',
  insertOrderedList: 'orderedList',
  formatBlock: 'blockquote',
};

/**
 * **算一组工具栏按钮的激活状态**。
 *
 * @param commands 按钮的 command 列表（保持顺序）
 * @param editor 编辑器实例（可能是 `null` —— 还没挂载）
 * @returns 每个按钮的状态（和 `commands` **一一对应**、顺序一致）
 */
export function computeToolbarActiveState(
  commands: readonly string[],
  editor: ToolbarStateEditor | null,
): ToolbarActiveState[] {
  /*
   * ⚠️⚠️ **"当前有没有选中文字"**（用户需求：
   * "清除格式按钮如果没有选择文字 应该置灰"）。
   *
   * -> 编辑器不提供这个能力 -> **默认当成"有选区"**
   *    -> 不影响老宿主（不知道有没有选区）
   */
  const hasSelection = safeHasSelection(editor);

  return commands.map((command) => {
    if (!editor) {
      return { command, active: false, disabled: false, hasSelection };
    }

    /*
     * ⚠️ **撤销 / 重做**不是"格式"，是"有没有历史" -> 单独判断
     *
     * ⚠️⚠️ **不受"有没有选区"影响** ❌
     * -> 没选文字时**撤销依然可用**  （用户想撤销的是上一步操作，不是格式）
     */
    if (command === 'undo') {
      return {
        command,
        active: false,
        disabled: !safeCan(editor, 'undo'),
        hasSelection,
      };
    }
    if (command === 'redo') {
      return {
        command,
        active: false,
        disabled: !safeCan(editor, 'redo'),
        hasSelection,
      };
    }

    const check = ACTIVE_CHECKS[command];

    /*
     * ⚠️⚠️ **格式类命令：没选文字 -> 置灰**
     *
     * -> 用户需求："清除格式按钮如果没有选择文字 应该置灰"
     * -> **清除格式** / **文字颜色** / **高亮底色** / **文字高亮** 都算"格式类"
     * -> **加粗/斜体/下划线** 也一样（没选字就没法加粗）
     *
     * ⚠️ **"清除格式"没有激活态** -> 永远不高亮
     *    -> 它不在 `ACTIVE_CHECKS` 里 -> `check` 是 undefined
     */
    if (FORMAT_COMMANDS.has(command)) {
      return {
        command,
        // ⚠️ **有检查的格式命令**（加粗等）-> **激活态照常算**
        //    -> 没选文字时**只是置灰**，不是"取消高亮"
        active: check ? safeIsActive(editor, check) : false,
        disabled: !hasSelection,
        hasSelection,
      };
    }

    if (!check) {
      return { command, active: false, disabled: false, hasSelection };
    }

    /*
     * ⚠️ **颜色类的 mark 要看"具体是哪个颜色"**。
     *
     * → `textStyle` 这个 mark 带 `color` 属性
     * → 宿主选的颜色是 `#ff0000` -> 选中这段时，别的红色（比如 `#ff0000` 同值）才算激活
     * → 但我们**不知道当前 mark 的具体值** -> 只判断"有没有这个 mark"
     *   （够用：只要这段有文字颜色，按钮就亮）
     */
    return {
      command,
      active: safeIsActive(editor, check),
      disabled: false,
      hasSelection,
    };
  });
}

/**
 * **安全地问"这个 mark 是不是激活的"**（编辑器没准备好时当成 false）。
 */
function safeIsActive(
  editor: ToolbarStateEditor,
  check: string | Record<string, unknown>,
): boolean {
  try {
    return editor.isActive(check);
  } catch {
    /* 编辑器还没准备好 -> 当成没激活 */
    return false;
  }
}

/**
 * **"没选文字时置灰"的命令**。
 *
 * ⚠️⚠️ **只有"清除格式"**
 *
 * ### 用户需求（第 27 轮的更正）
 *
 * > "没选字时格式按钮置灰这个你修错了 应该是没选字的时候清除格式按钮置灰
 * >  其他的还是可以用的"
 * >
 * > "在刚进去的时候没有修改历史记录的时候，撤销和重做还有清除格式按钮都是置灰的；
 * >  如果选择了文字 清除按钮就恢复；其他的方面撤销和重做按照现有逻辑是可以的；
 * >  其余按钮都是可以点击的。"
 *
 * ### 逻辑（**严格按用户说的**）
 *
 * | 场景 | 撤销 | 重做 | 清除格式 | 其余按钮 |
 * |---|---|---|---|---|
 * | 刚进去（没有历史） | **置灰** | **置灰** | **置灰** | **全部可用**  |
 * | 选了文字 | 按现有逻辑 | 按现有逻辑 | **恢复可用**  | **全部可用**  |
 *
 * ### 之前（❌）
 *
 * -> 把 **加粗 / 斜体 / 下划线 / 删除线 / 文字颜色 / 高亮** 全置灰了 ❌
 * -> 用户反馈："你修错了"
 * -> -> 这些按钮**永远可用**
 *    -> 它们只是"对当前选区生效"，没选区时点了也不出错
 *
 * ⚠️ **不包含 `undo` / `redo`**
 * -> 撤销是"撤销上一步操作"，和选区无关
 * -> 它们**按现有的 `canUndo` / `canRedo` 逻辑**判断
 */
export const FORMAT_COMMANDS = new Set(['removeFormat']);

/**
 * **安全地判断"当前有没有选中文字"**（编辑器没提供 / 没准备好时当成"有"）。
 *
 * ⚠️ **默认 `true`**
 * -> 不认识这个能力的宿主 -> **行为不变**（不会突然全部置灰）
 */
function safeHasSelection(editor: ToolbarStateEditor | null): boolean {
  if (!editor?.hasSelection) {
    return true;
  }
  try {
    return editor.hasSelection();
  } catch {
    return true;
  }
}

/**
 * **安全地判断"能不能撤销 / 重做"**（编辑器没准备好时不炸）。
 */
function safeCan(editor: ToolbarStateEditor, action: 'undo' | 'redo'): boolean {
  try {
    if (action === 'undo') {
      return editor.canUndo ? editor.canUndo() : editor.can();
    }
    return editor.canRedo ? editor.canRedo() : editor.can();
  } catch {
    return false;
  }
}
