/**
 * editor —— 富文本相关的核心逻辑（零 React）。
 *
 * - `rich-text.ts` —— 内置的轻量编辑器（命令 + 消毒 + 工具栏）
 * - `label.ts` —— 工具栏文案解析（i18n）
 * - `render-rich-text.ts` —— 富文本的**安全渲染**（HTML → 排版）
 * - `toolbar-state.ts` —— 工具栏的**按下态**（纯逻辑，可独立测试）
 */

export * from './label';
export * from './render-rich-text';
export * from './rich-text';
export * from './toolbar-state';
