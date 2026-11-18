/**
 * 主题与外观配置（**纯类型 + 纯函数**，零 DOM）。
 *
 * ## 分层
 *
 * | 层 | 控制什么 | 手段 |
 * |---|---|---|
 * | 1 | 整体风格 | `theme="paper"` |
 * | 2 | 结构开关 | `appearance={{ density: 'compact' }}` |
 * | 3 | 像素微调 | 宿主覆盖 CSS 变量 |
 *
 * 三层**不冲突** —— 2 和 3 都能覆盖 1。
 */

/**
 * 内置主题。
 *
 * - `light` 亮色（默认）
 * - `dark` 暗色
 * - `auto` 跟随系统
 * - `paper` 纸张（米黄护眼）
 * - `sepia` 深色护眼（棕褐）
 * - `contrast` 高对比度（无障碍）
 * - `minimal` 极简黑白（打印友好）
 */
export type PdfViewerTheme = 'light' | 'dark' | 'auto' | 'paper' | 'sepia' | 'contrast' | 'minimal';

/** 全部内置主题（宿主做切换 UI 时用） */
export const THEMES: readonly PdfViewerTheme[] = [
  'light',
  'dark',
  'auto',
  'paper',
  'sepia',
  'contrast',
  'minimal',
] as const;

/** 主题的中文名（宿主做切换 UI 时用） */
export const THEME_LABELS: Record<PdfViewerTheme, string> = {
  light: '亮色',
  dark: '暗色',
  auto: '跟随系统',
  paper: '纸张',
  sepia: '护眼',
  contrast: '高对比度',
  minimal: '极简',
};

/** 密度 */
export type PdfViewerDensity = 'compact' | 'cozy' | 'comfortable';

/** 外壳的显示程度 */
export type PdfViewerChrome = 'full' | 'minimal' | 'hidden';

/**
 * 外观配置（**结构**，不是颜色）。
 *
 * ⚠️ **这些是"结构开关"，用 JS 配**（CSS 变量做不到）：
 * - 显示哪些按钮
 * - 工具栏 / 面板的密度
 * - 页阴影 / 圆角
 */
export interface PdfViewerAppearance {
  /** 密度（工具栏 / 面板） */
  density?: PdfViewerDensity;
  /** 外壳的显示程度 */
  chrome?: PdfViewerChrome;
  /** 页阴影 */
  pageShadow?: boolean;
  /** 页圆角（px）；不传 = 跟随主题 */
  pageRadius?: number;
  /** 显示页码 */
  showPageNumber?: boolean;
  /** 显示目录按钮 */
  showOutline?: boolean;
  /** 显示缩略图按钮 */
  showThumbnails?: boolean;
  /** 显示搜索按钮 */
  showSearch?: boolean;
}

/**
 * 把主题 + 外观配置翻译成**根节点的 class 名**。
 *
 * @param theme 主题
 * @param appearance 外观配置
 * @returns class 名列表（不含 `scpdf-root`）
 *
 * @example
 * ```ts
 * themeClasses('paper', { density: 'compact', pageShadow: false });
 * // → ['scpdf-root--paper', 'scpdf-root--density-compact', 'scpdf-root--no-page-shadow']
 * ```
 */
export function themeClasses(
  theme: PdfViewerTheme | undefined,
  appearance?: PdfViewerAppearance,
): string[] {
  const classes: string[] = [];

  if (theme) {
    classes.push(`scpdf-root--${theme}`);
  }

  if (appearance?.density) {
    classes.push(`scpdf-root--density-${appearance.density}`);
  }
  if (appearance?.chrome) {
    classes.push(`scpdf-root--chrome-${appearance.chrome}`);
  }
  if (appearance?.pageShadow === false) {
    classes.push('scpdf-root--no-page-shadow');
  }
  if (appearance?.pageRadius === 0) {
    classes.push('scpdf-root--page-radius-0');
  }

  return classes;
}
