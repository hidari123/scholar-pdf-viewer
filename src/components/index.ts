/**
 * components —— UI 层（React）
 *
 * ⚠️ **便利贴面板 / 富文本编辑器不在这里导出**（实测踩过的坑：体积超预算）。
 *
 * → 它们约 **1.5 kB**（brotli 后）
 * → 静态导出 → **每个宿主都要背**（哪怕从来不用批注）❌
 * → `PdfViewer` 内部用 **`lazy(() => import(...))`** 加载 → 不打开批注就不加载 ✅
 *
 * → 宿主如果想单独用 → 从深路径 import：
 *   `import { AnnotationPanel } from '@scholar-club/pdf-viewer/dist/components/AnnotationPanel'`
 *   （不推荐；用 `PdfViewer` 的 `onAnnotationSave` / `annotationToolbar` 等 props 就够了）
 */
export * from './AnnotationLayer';
export * from './Icon';
export * from './LinkLayer';
export * from './OutlinePanel';
export * from './Page';
export * from './PageCanvas';
export * from './PasswordDialog';
export * from './PdfViewer';
export * from './RichTextPreview';
export * from './SearchPanel';
export * from './SelectionActionIcons';
export * from './SelectionLayer';
export * from './SelectionPopover';
export * from './StickyNoteLayer';
export * from './TextLayer';
export * from './ThumbnailPanel';
export * from './Toolbar';
