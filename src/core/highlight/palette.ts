/**
 * 高亮色板 —— 纯视觉，无业务语义。
 *
 * **包的边界（重要）**：
 * - 包**只负责**：把"颜色"渲染出来（把语义 key 映射成 CSS 颜色）
 * - 包**不负责**：取色器 UI、语义含义（"我的批注"/"他人批注"）、
 *   颜色持久化 → 这些都是**宿主**的事
 *
 * 为什么色板放包里：色板是**视觉**，不属于业务 → 属于包的职责。
 * 为什么映射由宿主给：宿主可能有额外语义（"我的" vs "他人"）→ 宿主传映射。
 */

/** 高亮色板：语义 key → CSS 颜色值 */
export type HighlightPalette = Record<string, string>;

/**
 * **内置默认色板**（宿主不传也能用）。
 *
 * ## 为什么内置（用户需求）
 *
 * > "语言和高亮色都是包需要内置的 但是有接口宿主可以配置"
 *
 * → 之前宿主**必须**传 `highlightPalette` → 不传就**没有颜色选择器** ❌
 * → 现在内置一套 → **开箱即用** ✅
 * → 宿主传了 → **完全覆盖**（不是合并，见 `mergeConfig`）✅
 *
 * ## 颜色说明
 *
 * 取自常见编辑器（WPS / Word / Notion）的高亮笔配色。
 * 颜色是**中性偏亮**的 → 配合 `mix-blend-mode: multiply`
 * 叠在黑字上时，文字仍然清晰可读 ✅
 *
 * ## 语义 key
 *
 * → key 是**语义名**（`yellow` / `green` / …）→ 宿主可以按 key 存"用户选的颜色" ✅
 * → 宿主想换配色 → 传自己的 `highlightPalette`（key 可以自己定）✅
 */
export const DEFAULT_HIGHLIGHT_PALETTE: HighlightPalette = {
  /** 黄（最常用） */
  yellow: '#ffd54a',
  /** 绿 */
  green: '#a5d6a7',
  /** 蓝 */
  blue: '#90caf9',
  /** 粉 */
  pink: '#f48fb1',
  /** 紫 */
  purple: '#ce93d8',
  /** 橙 */
  orange: '#ffcc80',
  /** 青（蓝绿） */
  cyan: '#80deea',
  /** 红（醒目） */
  red: '#ef9a9a',
};

/**
 * 取色板里某个 key 的颜色。
 *
 * @param palette 色板（宿主传入）
 * @param key 语义 key
 * @param fallback 找不到时的兜底色
 * @returns CSS 颜色值
 */
export function resolveHighlightColor(
  palette: HighlightPalette | undefined,
  key: string | undefined,
  fallback: string,
): string {
  if (!key) {
    return fallback;
  }
  return palette?.[key] ?? fallback;
}

/**
 * 把色板转成 CSS 自定义属性（可直接挂到 style 上）。
 *
 * 为什么要转成 CSS 变量而不是直接写死颜色：
 * - 宿主可以在 CSS 里用 `var(--scpdf-highlight-xxx)` 派生其他样式
 * - 换肤只需改变量，不用重渲染
 *
 * @param palette 色板
 * @returns CSS 变量映射（`--scpdf-hl-<key>` → 颜色）
 */
export function paletteToCssVars(palette: HighlightPalette | undefined): Record<string, string> {
  const vars: Record<string, string> = {};

  if (!palette) {
    return vars;
  }

  for (const [key, color] of Object.entries(palette)) {
    vars[`--scpdf-hl-${key}`] = color;
  }

  return vars;
}
