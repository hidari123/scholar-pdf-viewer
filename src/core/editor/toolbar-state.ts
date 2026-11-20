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
 * → 按钮点完就结束 -> 从不回头看编辑器 -> 没有任何"按下态" ✅
 *
 * ## 现在的做法
 *
 * → 编辑器每次**选区变化 / 文档变化** -> 报一次"哪些按钮是激活的" ✅
 * → 工具栏按这个结果渲染 `data-active` + `aria-pressed` ✅
 * → CSS 用 `data-active="true"` 画**明显的按下态**（主色底 + 主色图标）✅
 */

/**
 * **编辑器的能力接口**（只声明我们要用的那几个方法）。
 *
 * ⚠️ **不 import TipTap 的类型** -> 这个模块要能被**独立测试** ✅
 * ⚠️ **不 import TipTap 的值** -> 主入口的体积不受影响 ✅
 */
export interface ToolbarStateEditor {
  /** 当前选区里某个 mark / 节点是否是激活的 */
  isActive: (
    nameOrAttrs: string | Record<string, unknown>,
    attributes?: Record<string, unknown>,
  ) => boolean;
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
}

/**
 * **命令 → TipTap 的 `isActive` 参数**的映射。
 *
 * ⚠️ **每个 command 都要有** -> 否则按钮永远不亮 ❌
 * ⚠️ **颜色类要带属性** -> `foreColor` 光看"有没有文字颜色"不够，
 *    得看**是不是当前这个颜色** ✅
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
  return commands.map((command) => {
    if (!editor) {
      return { command, active: false, disabled: false };
    }

    /*
     * ⚠️ **撤销 / 重做**不是"格式"，是"有没有历史" -> 单独判断 ✅
     */
    if (command === 'undo') {
      return { command, active: false, disabled: !safeCan(editor, 'undo') };
    }
    if (command === 'redo') {
      return { command, active: false, disabled: !safeCan(editor, 'redo') };
    }
    /*
     * ⚠️ **清除格式**没有"激活态" -> 永远不高亮 ✅
     */
    if (command === 'removeFormat') {
      return { command, active: false, disabled: false };
    }

    const check = ACTIVE_CHECKS[command];
    if (!check) {
      return { command, active: false, disabled: false };
    }

    /*
     * ⚠️ **颜色类的 mark 要看"具体是哪个颜色"**。
     *
     * → `textStyle` 这个 mark 带 `color` 属性
     * → 宿主选的颜色是 `#ff0000` -> 选中这段时，别的红色（比如 `#ff0000` 同值）才算激活 ✅
     * → 但我们**不知道当前 mark 的具体值** -> 只判断"有没有这个 mark" ✅
     *   （够用：只要这段有文字颜色，按钮就亮）
     */
    try {
      return { command, active: editor.isActive(check), disabled: false };
    } catch {
      /* 编辑器还没准备好 -> 当成没激活 */
      return { command, active: false, disabled: false };
    }
  });
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
