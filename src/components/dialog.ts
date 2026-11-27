/**
 * `./dialog` 入口 —— 弹窗组件。
 *
 * ## 为什么独立成入口
 *
 * -> 弹窗**不是每个宿主都要** ✅
 * -> 静态打进主入口 ✅ -> 每个宿主都要背 ✅
 *    -> 主入口超了 size-limit 的预算 ✅
 * -> 独立入口 ✅ -> **不用就不加载** ✅
 *
 * ## 里面有什么
 *
 * - `AnnotationDialog` —— 写批注的富文本弹窗 ✅
 * - `ConfirmDialog` —— 通用确认框 ✅（"清除全部高亮"用它 ✅）
 *
 * @example
 * ```ts
 * import { ConfirmDialog } from '@scholar-space/pdf-viewer/dialog';
 * ```
 */

export * from './AnnotationDialog';
export * from './ConfirmDialog';
