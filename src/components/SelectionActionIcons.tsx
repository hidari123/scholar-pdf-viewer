/**
 * 选区浮层的**内置图标**（复用统一的 `Icon` 组件）。
 *
 * ## 为什么统一到 `core/icons`
 *
 * 用户反馈："按钮不好看 上传下载 添加高亮这些 都不好看 再找一些图标插件"
 *
 * → 之前工具栏和选区浮层是**两套**画法（16×16，风格不一致）
 * → 现在统一到 **24×24 / stroke 1.75 / round cap**（Lucide / Feather 的视觉语言）
 * → 一套规范 → 整体观感统一 ✅
 *
 * → 而且**宿主可以逐个覆盖**（`icons` prop）→ 想用 `lucide-react` 随时可以换。
 */

import type { ReactNode } from 'react';
import type { SelectionActionIcon } from '../core/selection/actions';
import type { IconName } from './Icon';
import { Icon } from './Icon';

/** 选区动作图标 → 统一图标集的映射 */
const ICON_MAP: Record<SelectionActionIcon, IconName> = {
  highlight: 'highlight',
  highlightColor: 'highlightColor',
  copy: 'copy',
  translate: 'translate',
  note: 'note',
  stickyNote: 'stickyNote',
  ask: 'ask',
  explain: 'explain',
  trash: 'trash',
  comment: 'comment',
  more: 'more',
};

/** 图标组件参数 */
export interface SelectionActionIconProps {
  /** 图标名 */
  name: SelectionActionIcon;
  /** 尺寸（px，默认 16） */
  size?: number;
  /** 宿主的图标覆盖表 */
  overrides?: Partial<Record<IconName, ReactNode>>;
  /**
   * **提示文案** ✅（用户反馈："选区浮层 title 中英混杂" ✅）
   *
   * -> 之前是 `title={name}` ✅ -> 显示**英文图标名** ✅（`highlight` ✅）
   * -> -> 中文界面里混着英文 ✅ ❌
   * -> -> 现在**由调用方传本地化文案** ✅ ✅
   * -> 不传 ✅ -> 不渲染 `<title>` ✅ ✅
   */
  title?: string;
}

/**
 * 内置图标。
 *
 * @param props 参数
 */
export function SelectionActionIconView({
  name,
  size = 16,
  overrides,
  title,
}: SelectionActionIconProps) {
  const mapped = ICON_MAP[name];
  if (!mapped) {
    return null;
  }
  /*
   * ⚠️ **title 由调用方给** ✅
   *
   * -> 之前是 `title={name}` ✅ -> 显示**英文图标名** ✅ ❌
   * -> -> 中文界面里混着英文 ✅ ❌
   */
  return <Icon name={mapped} size={size} title={title} overrides={overrides} />;
}
