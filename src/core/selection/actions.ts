/**
 * 选区浮层的**动作注册表**。
 *
 * **设计目标**（对比原 scholar-club）：
 * - 原项目是**硬编码 JSX**（Explain/Note/Ask/Translate/Delete/Highlight 各自一个闭包）
 * - 我们改成**配置驱动**：宿主传 `selectionActions` 数组，覆盖/追加内置动作
 *
 * **包的边界（重要）**：
 * 包**只提供 UI + 事件**，**不做**翻译/提问/笔记的业务。
 * 宿主没传 `onTranslate` → "翻译"按钮**不显示**（符合"没配就不展示"的要求）。
 */

import type { IconName } from '../icons/icons';
import type { NormPosition } from '../types';

/**
 * **一个"像鼠标事件"的东西**（结构化类型）。
 *
 * ⚠️ **为什么不用 `React.MouseEvent`**（审计发现的 bug）：
 * -> \`core\` 的铁律是**零 React 依赖** ❌
 * -> 但 \`SelectionActionContext.event\` 引用了 \`React.MouseEvent\` ❌
 *   -> 只靠 React 的 **UMD 全局命名空间**才能编译 ❌
 *   -> 在 \`isolatedModules\` / 非 UMD 消费者下**会炸** ❌
 * -> 现在：**自己定义一个结构化类型** -> core 彻底不碰 React ✅
 */
export interface PointerEventLike {
  preventDefault: () => void;
  stopPropagation: () => void;
}

/**
 * 内置图标名（纯 SVG，无第三方依赖）。
 *
 * ⚠️ 和 `core/icons` 的 `IconName` **同一套规范**（24×24 / stroke 1.75）。
 *
 * → 用户反馈"按钮不好看" → 工具栏和选区浮层统一风格 ✅
 */
/**
 * ⚠️ **必须是 `IconName` 的子集**（审计发现的 bug）。
 *
 * -> 之前这里有 `'delete'` -> 但 `IconName` 里叫 `'trash'` ❌
 *   -> 两套图标词汇 -> 宿主写 `icons={{ delete: <X/> }}` **类型报错** ❌
 *   -> 运行时靠 `SelectionActionIcons.tsx` 里的 `delete: 'trash'` 映射兜底 ❌
 * -> 现在：**用 `IconName` 的真名** -> 两边永远一致 ✅
 */
export type SelectionActionIcon = Extract<
  IconName,
  | 'highlight'
  | 'highlightColor'
  | 'copy'
  | 'translate'
  | 'note'
  | 'stickyNote'
  | 'ask'
  | 'explain'
  | 'trash'
  | 'comment'
  | 'more'
>;

/** 动作回调的上下文 */
export interface SelectionActionContext {
  /** 选中的文本 */
  text: string;
  /**
   * 选区的归一化几何（宿主存高亮用）。
   *
   * ⚠️ **之前是 `unknown`**（审计发现的 bug）：
   * -> 宿主每次用都要写 \`ctx.position as NormPosition\` -> **到处是强制转换** ❌
   * -> 拼错了字段名**编译不报错**（因为是 `unknown`）❌
   * -> 现在：**具体类型** -> 拼错**直接报错** ✅
   */
  position: NormPosition;
  /**
   * 触发动作的 DOM 事件。
   *
   * ⚠️ **之前是必填**（审计发现的 bug）：
   * -> 但"点高亮块打开浮层"那条路径**根本没有事件** ❌
   *   -> 调用处写的是 \`event: undefined as never\` ❌
   *   -> 宿主写 \`ctx.event.preventDefault()\` -> **运行时崩** ❌
   * -> 现在：**可选** -> 宿主要用就判断一下 ✅
   */
  event?: PointerEventLike;
  /**
   * 高亮的颜色 key（语义 key，对应 `highlightPalette`）。
   *
   * 只有"高亮"动作会有；宿主用它决定存哪个颜色。
   */
  color?: string;
  /**
   * **"高亮已创建"的回调**（宿主自己实现高亮按钮时用）。
   *
   * ⚠️ **为什么需要**（实测踩过的坑）：
   * 宿主可能自己实现"高亮"按钮（不走包的浮层动作）
   * → 包的浮层动作不会触发 → **选区不会被清掉**
   * → 选区的蓝色块一直浮在高亮上（用户反馈"无法取消选中状态"）。
   *
   * → 宿主做完"存高亮"后调它 → 包负责清选区。
   *
   * ```tsx
   * onHighlight={(ctx) => {
   *   save({ text: ctx.text, position: ctx.position });
   *   ctx.done?.();          // ← 告诉包"高亮好了，清选区"
   * }}
   * ```
   */
  done?: () => void;
}

/** 一个可选区动作 */
export interface SelectionAction {
  /** 唯一 key（覆盖内置动作用同一个 key） */
  key: string;
  /** 图标：内置图标名，或自定义 ReactNode */
  icon?: SelectionActionIcon | React.ReactNode;
  /** 提示文案（也用作 aria-label） */
  label?: string;
  /** 点击回调 */
  onSelect?: (ctx: SelectionActionContext) => void;
  /**
   * 显示条件。
   *
   * ⚠️ **内置动作的"翻译/提问/笔记"默认就是靠它隐藏的**：
   * 宿主没传 `onTranslate` → 内置动作的 `when` 返回 false → 不显示。
   */
  when?: (ctx: SelectionActionContext) => boolean;
  /** 分组（同组的动作相邻，组间有分隔线） */
  group?: string;
  /** 排序（小的在前；未指定按注册顺序） */
  order?: number;
  /** 是否禁用（显示但不可点） */
  disabled?: boolean;
}

/** 内置动作的 key */
export const BUILTIN_ACTION_KEYS = {
  highlight: 'highlight',
  copy: 'copy',
  translate: 'translate',
  note: 'note',
  ask: 'ask',
  explain: 'explain',
  delete: 'delete',
} as const;

/**
 * 内置动作的默认标签（i18n 由宿主覆盖时可自行传 label）。
 */
export const BUILTIN_ACTION_LABELS: Record<string, string> = {
  highlight: '高亮',
  copy: '复制',
  translate: '翻译',
  note: '笔记',
  ask: '提问',
  explain: '解释',
  delete: '删除',
};

/**
 * 内置图标名集合（用于判断某个 icon 是不是内置的）。
 */
const BUILTIN_ICONS: ReadonlySet<string> = new Set<SelectionActionIcon>([
  'highlight',
  'highlightColor',
  'copy',
  'translate',
  'note',
  'stickyNote',
  'ask',
  'explain',
  'trash',
  'comment',
  'more',
]);

/**
 * 判断一个图标名是不是内置图标。
 *
 * @param name 图标名
 * @returns 是内置图标则 true
 */
export function isBuiltinIcon(name: string): name is SelectionActionIcon {
  return BUILTIN_ICONS.has(name);
}

/**
 * 合并内置动作与宿主传入的动作。
 *
 * 规则：
 * 1. 宿主的动作**覆盖**同 key 的内置动作
 * 2. 宿主新增的动作**追加**到后面
 * 3. 按 `order` 排序（未指定保持注册顺序）
 *
 * @param builtin 内置动作
 * @param custom 宿主传入的动作
 * @returns 合并后的动作列表
 */
export function mergeSelectionActions(
  builtin: readonly SelectionAction[],
  custom: readonly SelectionAction[] | undefined,
): SelectionAction[] {
  if (!custom || custom.length === 0) {
    return [...builtin];
  }

  const map = new Map<string, SelectionAction>();
  for (const action of builtin) {
    map.set(action.key, action);
  }
  for (const action of custom) {
    map.set(action.key, action);
  }

  return [...map.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}
