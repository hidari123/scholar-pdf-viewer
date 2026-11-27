# API 参考 / API Reference

> 完整的 props / 类型 / 导出清单。**中英双语**。
>
> [← 返回 README](../README.md) · [使用指南](./GUIDE.md) · [扩展开发](./EXTENDING.md)

---

## 目录 / Table of Contents

- [1. 包入口 / Package entry points](#1-包入口--package-entry-points)
- [2. `<PdfViewer />` props](#2-pdfviewer--props)
- [3. `PdfViewerHandle`（命令式句柄）](#3-pdfviewerhandle命令式句柄)
- [4. `config`（统一配置对象）](#4-config统一配置对象)
- [5. 功能开关 / 工具栏 / 外观 / 插槽](#5-功能开关--工具栏--外观--插槽)
- [6. 宿主回调契约](#6-宿主回调契约)
- [7. 选区动作（自定义浮层按钮）](#7-选区动作自定义浮层按钮)
- [8. 富文本工具栏](#8-富文本工具栏)
- [9. 图标](#9-图标)
- [10. 多语言 / i18n](#10-多语言--i18n)
- [11. 主题与 CSS 变量](#11-主题与-css-变量)
- [12. 错误码](#12-错误码)
- [13. 数据类型](#13-数据类型)
- [14. 工具函数导出](#14-工具函数导出)

---

## 1. 包入口 / Package entry points

| 子路径 / Subpath                       | 内容 / Contents                      | 说明 / Notes                    |
| -------------------------------------- | ------------------------------------ | ------------------------------- |
| `@scholar-space/pdf-viewer`            | `PdfViewer` + 全部工具函数 + 类型    | 主入口 / Main entry             |
| `@scholar-space/pdf-viewer/core`       | 框架无关的纯函数                     | 零 React ✅                     |
| `@scholar-space/pdf-viewer/icons`      | `getIconShape`                       | 内置图标集，按需加载            |
| `@scholar-space/pdf-viewer/dialog`     | `AnnotationDialog` + `ConfirmDialog` | 写批注的富文本弹窗 + 通用确认框 |
| `@scholar-space/pdf-viewer/editor`     | `TipTapEditor`                       | TipTap 富文本（可选 peer）      |
| `@scholar-space/pdf-viewer/styles.css` | 组件样式                             | **必引** / Required             |
| `@scholar-space/pdf-viewer/themes.css` | 主题                                 | 可选 / Optional                 |

**peerDependencies**：`react`（仅此一个）。
包**不依赖** `react-dom` → 不用 `createPortal`。

---

## 2. `<PdfViewer />` props

### 2.1 文档与加载

| prop           | 类型                                          | 默认        | 说明                             |
| -------------- | --------------------------------------------- | ----------- | -------------------------------- |
| `file`         | `string \| ArrayBuffer \| Uint8Array \| Blob` | —           | **必填**。文档来源               |
| `documentId`   | `string`                                      | `'default'` | 宿主业务 id。**换文档必须换** ⚠️ |
| `cache`        | `DocumentCache`                               | 内存缓存    | 字节缓存（可换 IndexedDB）       |
| `loadOptions`  | `LoadOptions`                                 | —           | 请求头 / 超时 / 自定义 `fetch`   |
| `password`     | `string`                                      | —           | 加密文档的密码                   |
| `initialPage`  | `number`                                      | `1`         | 初始页                           |
| `initialScale` | `number`                                      | `1`         | 初始缩放                         |
| `documentUrl`  | `string`                                      | —           | **打印"原 PDF"模式**用的原始地址 |

### 2.2 数据（受控）

| prop               | 类型                     | 说明                                        |
| ------------------ | ------------------------ | ------------------------------------------- |
| `highlights`       | `HighlightRecord[]`      | 高亮数组。**包只画，数据在宿主**            |
| `stickyNotes`      | `AnnotationRecord[]`     | 批注（便签）数组                            |
| `highlightPalette` | `Record<string, string>` | 高亮色板（key → CSS 颜色）。不传用内置 8 色 |

> ⚠️ `defaultHighlightColor`（不选颜色时用哪个）**只在 `config` 里** ✅
> —— 它是 `PdfViewerConfig` 的字段 ✅ -> 直接当 prop 传**不生效** ✅

### 2.3 行为 / 事件

| prop                     | 类型                                    | 说明                      |
| ------------------------ | --------------------------------------- | ------------------------- |
| `onHighlight`            | `(h: NewHighlight) => void`             | 包创建了高亮              |
| `onHighlightCreate`      | `(h: NewHighlight) => void`             | **宿主自己**创建了高亮    |
| `onHighlightCreated`     | `(h: NewHighlight) => void`             | 上面两个**之后**都会调    |
| `onHighlightUpdate`      | `(h: HighlightRecord) => void`          | 高亮被改（改色 / 改内容） |
| `onHighlightRemove`      | `(id: string) => void`                  | 高亮被删                  |
| `onHighlightClick`       | `(id: string, el: HTMLElement) => void` | 点高亮块                  |
| `onHighlightComment`     | `(id: string) => void`                  | 高亮的「加批注」          |
| `onHighlightCopy`        | `(text: string) => void`                | 复制高亮文字              |
| `onHighlightMore`        | `(id: string) => void`                  | 高亮的「更多」            |
| `onHighlightColorChange` | `(id: string, color: string) => void`   | 高亮换色                  |
| `onSelectionChange`      | `(s: SelectionData \| null) => void`    | 选区变化                  |
| `onDocumentLoad`         | `(info: PdfDocInfo) => void`            | 文档就绪                  |
| `onError`                | `(err: PdfViewerError) => void`         | 出错                      |
| `onPageChange`           | `(page: number, total: number) => void` | 翻页                      |
| `onZoomChange`           | `(scale: number) => void`               | 缩放                      |
| `onCopy`                 | `(text: string) => void`                | 复制（覆盖内置实现）      |
| `onTranslate`            | `(text: string) => void`                | 翻译                      |
| `onAsk`                  | `(text: string) => void`                | 提问                      |
| `onNote`                 | `(text: string) => void`                | 记笔记                    |
| `onExplain`              | `(text: string) => void`                | 解释                      |
| `onToolbarHighlight`     | `(color: string) => void`               | 工具栏「🖍 高亮」按钮      |
| `onThemeChange`          | `(theme: PdfViewerTheme) => void`       | 主题切换                  |
| `onExternalLink`         | `(url: string) => void`                 | 点外链                    |
| `onInternalLink`         | `(target: unknown) => void`             | 点内链                    |
| `onRequestPassword`      | `(info: PasswordRequest) => void`       | 宿主接管密码输入          |
| `onToast`                | `(toast: ToastController) => void`      | 宿主接管 toast            |

> ⚠️ **工具栏「🖍 高亮」按钮在没有选区时**会弹 toast 提示
> 「请先选中文字」，并且**不调** `onToolbarHighlight` ✅

### 2.4 pdf.js 注入回调（宿主提供）

**不传就用包内置的默认接线** ✅（推荐）。

| prop                  | 类型                                            | 说明                              |
| --------------------- | ----------------------------------------------- | --------------------------------- |
| `getPage`             | `(n: number) => Promise<PageLike \| undefined>` | 取第 n 页                         |
| `getPageSizes`        | `(n: number) => Promise<{width,height}[]>`      | 各页尺寸（pt）                    |
| `getDocInfo`          | `(data: Uint8Array) => Promise<PdfDocInfo>`     | 文档信息                          |
| `getOutline`          | `() => Promise<OutlineItemLike[]>`              | 目录                              |
| `resolvePageRef`      | `(ref: string) => Promise<number>`              | 解析目录里的页引用（异步）        |
| `pageRefToNumber`     | `(ref: string) => number \| null`               | 解析页引用（同步，优先）          |
| `outlineResolveToken` | `number`                                        | 解析 token（变化时重解析）        |
| `renderThumbnail`     | `(n: number, w: number) => Promise<string>`     | 缩略图（data URL）                |
| `searchEngine`        | `PdfSearch`                                     | 自定义搜索引擎                    |
| `pdfJsResourcePaths`  | `PdfJsResourcePaths`                            | pdf.js 静态资源路径（可覆盖内置） |

#### `PdfJsResourcePaths`

```ts
interface PdfJsResourcePaths {
  /** 标准字体目录（14 个标准字体的 .pfb）。**内置了** ✅ */
  standardFontDataUrl?: string;
  /** CMap 目录（.bcmap）。中日韩竖排 PDF 才需要 */
  cMapUrl?: string;
  /** WASM 目录。JBIG2 / JPEG2000 图片才需要 */
  wasmUrl?: string;
}
```

> ⚠️ **不配 `standardFontDataUrl` 的后果**：pdf.js 请求不到标准字体 →
> 文档里**没内嵌字体**的页会**画歪**（字挤成一团，像乱码）。
> 包**默认已经内置** ✅ → 宿主一般不用管。

### 2.5 外观 / 结构

| prop                    | 类型                                   | 说明                                             |
| ----------------------- | -------------------------------------- | ------------------------------------------------ |
| `theme`                 | `PdfViewerTheme`                       | `'light' \| 'dark' \| 'auto'`                    |
| `appearance`            | `PdfViewerAppearance`                  | 密度 / 字号 / 圆角 / 强调色                      |
| `toolbar`               | `ToolbarConfig`                        | 工具栏按钮开关                                   |
| `features`              | `Features`                             | 功能开关（opt-out）                              |
| `slots`                 | `PdfViewerSlots`                       | 插槽                                             |
| `icons`                 | `Partial<Record<IconName, ReactNode>>` | 覆盖图标                                         |
| `dir`                   | `'ltr' \| 'rtl'`                       | 文字方向（不传自动判断）                         |
| `locale`                | `Locale`                               | `'zh' \| 'en' \| 'ja' \| 'fr'`                   |
| `messages`              | `LocaleMessagesMap`                    | 覆盖文案                                         |
| `locales`               | `LocaleTable`                          | 新增语言                                         |
| `config`                | `PdfViewerConfig`                      | 统一配置（会被上面的 prop 覆盖）                 |
| `annotationEditor`      | `React.ComponentType<EditorProps>`     | **替换**批注的富文本编辑器（组件，不是配置对象） |
| `annotationToolbar`     | `RichTextToolbarItem[]`                | 批注工具栏                                       |
| `annotationPalette`     | `RichTextPalette`                      | 批注按钮图标色板                                 |
| `annotationTextPalette` | `RichTextPalette`                      | 文字颜色 / 高亮色板                              |
| `selectionActions`      | `SelectionAction[]`                    | 选区浮层的按钮                                   |
| `children`              | `ReactNode`                            | 插在工具栏和主体之间                             |

### 2.6 缩放

| prop              | 类型      | 默认   | 说明             |
| ----------------- | --------- | ------ | ---------------- |
| `minScale`        | `number`  | `0.2`  | 最小缩放         |
| `maxScale`        | `number`  | `2.5`  | 最大缩放         |
| `allowScaleInput` | `boolean` | `true` | 允许手动输入缩放 |

### 2.7 主题

| prop           | 类型                        | 说明                   |
| -------------- | --------------------------- | ---------------------- |
| `themeOptions` | `readonly PdfViewerTheme[]` | 主题选择器里显示哪几个 |

### 2.8 打印

| prop               | 类型                              | 说明                            |
| ------------------ | --------------------------------- | ------------------------------- |
| `printMode`        | `'original' \| 'with-highlights'` | 只打原 PDF / 打印 DOM（含高亮） |
| `printPaper`       | `PaperSize`                       | `'A4' \| 'Letter' \| ...`       |
| `printOrientation` | `'portrait' \| 'landscape'`       | 方向                            |
| `printMargin`      | `PrintMargin`                     | 页边距（mm）                    |

### 2.9 批注

| prop                 | 类型                            | 说明               |
| -------------------- | ------------------------------- | ------------------ |
| `onAnnotationCreate` | `(a: AnnotationRecord) => void` | 新建批注           |
| `onAnnotationSave`   | `(a: AnnotationRecord) => void` | 保存批注（编辑后） |
| `onAnnotationChange` | `(a: AnnotationRecord) => void` | 批注被改           |
| `onAnnotationDelete` | `(id: string) => void`          | 删除批注           |
| `onAnnotationClick`  | `(a: AnnotationRecord) => void` | 点便签             |
| `onAnnotationEdit`   | `(a: AnnotationRecord) => void` | 点「编辑」         |
| `onAnnotationExpand` | `(a: AnnotationRecord) => void` | 点「展开」         |

### 2.10 工具栏的导入 / 导出 / 清除

| prop                   | 类型         | 说明                     |
| ---------------------- | ------------ | ------------------------ |
| `onDownloadPdf`        | `() => void` | 「下载 PDF」按钮         |
| `onExportAnnotatedPdf` | `() => void` | 「导出带高亮的 PDF」按钮 |
| `onExportHighlights`   | `() => void` | 「导出高亮」按钮         |
| `onImportHighlights`   | `() => void` | 「导入高亮」按钮         |
| `onClearHighlights`    | `() => void` | 「清除全部高亮」按钮     |

> ⚠️ **这五个回调不传，对应的按钮就不渲染** —— 包不知道数据存在哪 ✅
>
> 对应的开关：`toolbar.showDownloadPdf` / `showExportAnnotatedPdf` /
> `showExportHighlights` / `showImportHighlights` / `showClearHighlights`

---

### 2.11 清除全部高亮的确认框

点工具栏的「清除全部高亮」→ **先弹确认框** ✅ → 用户点「清除」才真的清除 ✅。

- **不用 `window.confirm`** ✅ —— 那个**没法定制** ✅
  - 按钮文字跟随浏览器语言 ❌ → 没法走 i18n ❌
  - 样式跟随系统 ❌ → 深色模式下可能看不清 ❌
  - **没法截图** ❌ → E2E 测不了 ❌
  - 阻塞整个页面 ❌ → 渲染线程**卡住** ❌
- 用包**自研**的 `ConfirmDialog` ✅ —— 样式可控 ✅ 文案走 i18n ✅ E2E 可测 ✅
- **Esc** 关闭 ✅ · 点**遮罩**关闭 ✅ · 确定按钮**红色**（危险操作 ✅）
- 只有宿主传了 `onClearHighlights` 才弹 ✅

### 2.12 `ConfirmDialog`（宿主可复用）

```tsx
import { ConfirmDialog } from '@scholar-space/pdf-viewer/dialog';

<ConfirmDialog
  open={open}
  title="删除这份笔记？"
  message="删除后无法恢复。"
  confirmText="删除"
  danger
  onConfirm={() => void doDelete()}
  onCancel={() => setOpen(false)}
/>;
```

| prop                              | 类型         | 说明                                  |
| --------------------------------- | ------------ | ------------------------------------- |
| `open`                            | `boolean`    | 是否打开                              |
| `title`                           | `string`     | 标题                                  |
| `message`                         | `string?`    | 正文                                  |
| `confirmText`                     | `string?`    | 确定按钮文字（默认走 i18n）           |
| `cancelText`                      | `string?`    | 取消按钮文字（默认走 i18n）           |
| `danger`                          | `boolean?`   | 确定按钮**红色**（不可撤销的操作 ✅） |
| `onConfirm`                       | `() => void` | 点确定                                |
| `onCancel`                        | `() => void` | 点取消 / Esc / 点遮罩                 |
| `locale` / `messages` / `locales` | —            | 走 i18n ✅                            |

---

## 3. `PdfViewerHandle`（命令式句柄）

```tsx
const viewerRef = useRef<PdfViewerHandle>(null);
<PdfViewer ref={viewerRef} file={url} />;
```

| 方法              | 签名                                        | 说明                 |
| ----------------- | ------------------------------------------- | -------------------- |
| `clearSelection`  | `() => void`                                | 清掉当前选区         |
| `createHighlight` | `(h: NewHighlight) => void`                 | **宿主自己**创建高亮 |
| `getCurrentPage`  | `() => number`                              | 当前页码（1 起）     |
| `getNumPages`     | `() => number`                              | 总页数               |
| `getPageSizesPt`  | `() => { width: number; height: number }[]` | 各页点尺寸（72dpi）  |
| `goToPage`        | `(page: number) => void`                    | 跳到某页             |
| `zoomIn`          | `() => void`                                | 放大                 |
| `zoomOut`         | `() => void`                                | 缩小                 |
| `fitWidth`        | `() => void`                                | 适配宽度             |
| `fitPage`         | `() => void`                                | 适配整页             |
| `print`           | `() => void`                                | 打印                 |

> ⚠️ **`createHighlight` 不要和 `onHighlight` 一起用** ——
> 包内置的高亮按钮**自己会走** `onHighlight` → 两个都走 → 宿主存两次。

---

## 4. `config`（统一配置对象）

### 优先级规则

```
config  <  单独的 prop
```

`config` 是**兜底**，单独的 prop 永远赢。

### `PdfViewerConfig` 的字段

和 `PdfViewerProps` 同名的那一批（`file` / `theme` / `highlights` / `toolbar` / ...）。
适合**从后端下发一份配置**的场景。

```tsx
<PdfViewer file={url} config={configFromBackend} theme="light" />;
// theme="light" 赢 ✅
```

---

## 5. 功能开关 / 工具栏 / 外观 / 插槽

### `Features`

**opt-out**：只有显式 `false` 才关。

```ts
interface Features {
  search?: boolean;
  thumbnails?: boolean;
  outline?: boolean;
  keyboard?: boolean;
  print?: boolean;
  themePicker?: boolean;
  selectionHighlight?: boolean;
  selectionCopy?: boolean;
  selectionTranslate?: boolean;
  selectionAsk?: boolean;
  selectionExplain?: boolean;
  selectionNote?: boolean;
}
```

### `ToolbarConfig`

**三态**：不传 = 默认；`true` = 强制显示；`false` = 强制隐藏。

```ts
interface ToolbarConfig {
  showPageNav?: boolean;
  showZoom?: boolean;
  showSearch?: boolean;
  showThumbnails?: boolean;
  showOutline?: boolean;
  showPrint?: boolean;
  showDownloadPdf?: boolean;
  showExportAnnotatedPdf?: boolean;
  showExportHighlights?: boolean;
  showImportHighlights?: boolean;
  showClearHighlights?: boolean;
  showHighlight?: boolean;
  showTheme?: boolean;
}
```

### `PdfViewerSlots`

```ts
interface PdfViewerSlots {
  toolbar?: ReactNode; // 整个替换工具栏
  panel?: ReactNode; // 整个替换侧栏
  pageOverlay?: ReactNode | ((pageNumber: number) => ReactNode); // 页内叠加层
}
```

> ⚠️ 替换 `slots.toolbar` → 缩放 / 翻页 / 搜索**都要自己接** ✅

> ⚠️ **工具栏的左右插槽在 `toolbar` 对象里** ✅（不在 `slots` 里 ✅）：
> `toolbar.leftSlot` / `toolbar.rightSlot` ✅

### `PdfViewerAppearance`

```ts
interface PdfViewerAppearance {
  density?: 'compact' | 'cozy' | 'comfortable';
  fontSize?: number;
  fontFamily?: string;
  accentColor?: string;
  pageRadius?: number;
}
```

---

## 6. 宿主回调契约

### 6.1 高亮的三种回调（**最容易搞混**）

| 回调                 | 触发时机                                            | 宿主要做什么   |
| -------------------- | --------------------------------------------------- | -------------- |
| `onHighlight`        | 包自己创建了高亮                                    | **存起来**     |
| `onHighlightCreate`  | 宿主自己创建了高亮（`viewerRef.createHighlight()`） | **存起来**     |
| `onHighlightCreated` | 上面两个**之后**都会调                              | 一般**不用管** |

**只接一个** → 接 `onHighlight` ✅

### 6.2 选区动作上下文 `SelectionActionContext`

```ts
interface SelectionActionContext {
  /** 选中的文字 */
  text: string;
  /** 归一化位置 */
  position: NormalizedPosition;
  /** 触发动作的原始事件 */
  event: Event;
  /** 当前选中的颜色 */
  color?: string;
}
```

### 6.3 密码（三种模式）

| 方式           | 怎么配                                             |
| -------------- | -------------------------------------------------- |
| 包内置的密码框 | `showPasswordDialog`（默认 `true`）                |
| 宿主接管       | `showPasswordDialog={false}` + `onRequestPassword` |
| 密码已知       | `password="xxx"`                                   |

### 6.4 Toast

```ts
interface ToastController {
  show: (options: ToastOptions) => string;
  success: (message: string, options?: Partial<ToastOptions>) => string;
  error: (message: string, options?: Partial<ToastOptions>) => string;
  warning: (message: string, options?: Partial<ToastOptions>) => string;
  info: (message: string, options?: Partial<ToastOptions>) => string;
  loading: (message: string, options?: Partial<ToastOptions>) => string;
  loadingPromise: <T>(
    message: string,
    fn: () => Promise<T>,
    options?: Partial<ToastOptions>,
  ) => Promise<T>;
  close: (key: string) => void;
  clear: () => void;
}
```

传 `onToast` → **完全接管**（包不渲染自己的 toast 容器）。

---

## 7. 选区动作（自定义浮层按钮）

```tsx
<PdfViewer
  file={url}
  selectionActions={[
    {
      key: 'summarize',
      icon: 'sparkle',
      label: '总结',
      group: 'primary',
      order: 30,
      onSelect: ({ text }) => void summarize(text),
    },
  ]}
/>;
```

| 字段         | 说明                                          |
| ------------ | --------------------------------------------- |
| `key`        | 唯一标识。内置的见 `BUILTIN_ACTION_KEYS`      |
| `icon`       | `IconName`                                    |
| `label`      | 按钮文字（**走 i18n** ✅）                    |
| `group`      | `'primary' \| 'secondary'`                    |
| `order`      | 排序（小的在前）                              |
| `when`       | `(ctx) => boolean` —— 返回 false 就**不显示** |
| `disabled`   | `boolean` —— `true` 就**灰掉**                |
| `messageKey` | i18n 的 key（**比 `label` 优先** ✅）         |
| `onSelect`   | 点击时调                                      |

用 `mergeSelectionActions(内置的, 你的)` 可以**保留内置的**再追加 ✅。

---

## 8. 富文本工具栏

```tsx
import { defaultRichTextToolbar, execRichTextCommand } from '@scholar-space/pdf-viewer';
```

### 三个颜色命令的区别（**别搞混**）

| 命令            | 作用                 | 图标     |
| --------------- | -------------------- | -------- |
| `textColor`     | 改**文字颜色**       | A + 色条 |
| `textHighlight` | 给文字加**背景高亮** | 粗色带   |
| `clearFormat`   | **清除格式**         | A + 斜杠 |

> ⚠️ `clearFormat`（清文字格式）和 `eraser`（**清除全部高亮**）是**两个不同的图标** ✅

### `removeFormat`（清除格式）会清什么

文字颜色、背景高亮、粗体、斜体、下划线、删除线。
**不影响**链接。

---

## 9. 图标

```tsx
import { getIconShape, type IconName } from '@scholar-space/pdf-viewer/icons';

const shape = getIconShape('highlight'); // { paths, circles, rects, lines, polylines }
```

### 覆盖某个图标

```tsx
<PdfViewer
  file={url}
  icons={{
    highlight: <MyHighlightIcon />,
    download: <MyDownloadIcon />,
  }}
/>;
```

### 全部图标名

`thumbnails` `outline` `search` `chevronLeft` `chevronRight` `zoomIn` `zoomOut`
`fitWidth` `fitPage` `rotate` `print` `upload` `download` `file` `fileText`
`exportJson` `exportPdf` `importJson` `exportAnnotated` `eraser` `importHighlight`
`highlight` `highlightColor` `comment` `copy` `trash` `more` `note` `stickyNote`
`translate` `ask` `explain` `plus` `minus` `close` `check` `alert` `info` `edit`
`link` `bold` `italic` `underline` `strike` `quote` `clearFormat` `undo` `redo`
`textColor` `textHighlight` `list` `listOrdered` `menu` `settings` `palette`

---

## 10. 多语言 / i18n

### 回退链

```
overrides[locale][key]
  → locales[locale][key]
  → MESSAGES[locale][key]
  → MESSAGES.zh[key]
  → key 本身
```

### 内置语言

`zh`（默认）· `en` · `ja` · `fr`

### 加一个新语言

```tsx
import { buildLocaleTable } from '@scholar-space/pdf-viewer';

locales={buildLocaleTable({ es: { 'selection.actionHighlight': 'Resaltar' } })}
```

### 覆盖个别句子

```tsx
messages={{ zh: { 'selection.actionHighlight': '标记' } }}
```

---

## 11. 主题与 CSS 变量

### 主题

```ts
const THEMES = ['light', 'dark', 'auto'] as const;
type PdfViewerTheme = (typeof THEMES)[number];
```

`themeLabel(theme, locale)` → 显示名。

### CSS 变量（第三层：像素微调）

```css
.scpdf-root {
  --scpdf-color-accent: #2f54eb;
  --scpdf-color-border: #e5e7eb;
  --scpdf-color-bg: #ffffff;
  --scpdf-color-text: #1f2329;
  --scpdf-density: cozy;
}
```

---

## 12. 错误码

| code                   | 含义                         | 可重试         |
| ---------------------- | ---------------------------- | -------------- |
| `E_LOAD_NETWORK`       | 网络错误                     | ✅             |
| `E_LOAD_TIMEOUT`       | 加载超时                     | ✅             |
| `E_LOAD_HTTP`          | HTTP 错误（非 2xx）          | 视情况         |
| `E_EMPTY`              | 文档是空的                   | ❌             |
| `E_PDF_INVALID`        | 不是有效的 PDF               | ❌             |
| `E_PDF_ENCRYPTED`      | 加密文档                     | ❌             |
| `E_PDF_PASSWORD_WRONG` | 密码错误                     | ✅（换个密码） |
| `E_RENDER_PAGE`        | 页面渲染失败                 | ✅             |
| `E_FONT_MISSING`       | 字体缺失                     | ❌             |
| `E_LINK_INVALID`       | 链接目标无效                 | ❌             |
| `E_CACHE_QUOTA`        | 缓存空间不足                 | ❌             |
| `E_CACHE_UNAVAILABLE`  | 缓存不可用（IndexedDB 挂了） | ❌             |

`isRetryable(err)` → 能不能重试。

---

## 13. 数据类型

### 三个坐标空间（**最重要**）

| 空间       | 单位                 | 谁在用      |
| ---------- | -------------------- | ----------- |
| **归一化** | 0~1，相对于页面      | **存储** ✅ |
| **页面内** | pt，相对于页左上角   | PDF 内部    |
| **视口**   | px，相对于浏览器窗口 | 渲染        |

**存储一律用归一化** → 换缩放 / 换窗口 / 换设备都不影响 ✅

### `HighlightRecord`

```ts
interface HighlightRecord {
  id: string;
  text: string;
  /** 归一化位置 */
  position: NormalizedPosition;
  color?: string;
  /** 创建时间（宿主自己写） */
  createdAt?: number;
}
```

### `NewHighlight`

```ts
interface NewHighlight {
  text: string;
  position: NormalizedPosition;
  color?: string;
  event?: Event;
}
```

### `AnnotationRecord`

```ts
interface AnnotationRecord {
  id: string;
  /** 富文本 HTML（**包会消毒** ✅） */
  content: string;
  /** 关联的高亮 id */
  highlightId?: string;
  createdAt?: number;
}
```

---

## 14. 工具函数导出

### 高亮序列化

```ts
exportHighlights(highlights): string        // → JSON
importHighlights(json): HighlightDoc | null  // 从 JSON 读
parseHighlightDoc(text): HighlightDoc | null // **带校验，永不抛异常** ✅
stringifyHighlightDoc(doc): string
HIGHLIGHT_DOC_VERSION: string
```

### 导出带高亮的 PDF

```ts
exportHighlightedPdf(options: ExportHighlightedPdfOptions): Promise<Uint8Array>
colorToRgb(color: string): { r, g, b }
highlightsToPdfAnnots(highlights): PdfAnnot[]
highlightToPdfAnnots(highlight): PdfAnnot[]
```

### 打印

```ts
computePrintPageSize(paper, orientation)
computePrintScale(pageSizePt, paper, orientation, margin)
computePrintScaleForRender(...)
PAPER_SIZES: Record<PaperSize, { width: number; height: number }>
DEFAULT_PRINT_MARGIN: PrintMargin
MM_TO_PX: number
```

### 选区动作

```ts
mergeSelectionActions(base, extra): SelectionAction[]
BUILTIN_ACTION_KEYS: readonly string[]
```

### 批注分组

```ts
groupAnnotations(annotations): AnnotationGroup[]
isSameRow(a, b): boolean
horizontalGap(a, b): number
verticalOverlap(a, b): number
unionAnchor(groups): AnnotationAnchor
ANNOTATION_GROUP_TOLERANCE: number
```

### 其他

```ts
downloadFile(data, filename, mimeType?)   // 下载 Blob ✅
richTextToPlain(html): string
sanitizeRichText(html): string
execRichTextCommand(...)
defaultRichTextToolbar: RichTextToolbarItem[]
resolvePdfJsResourcePaths(overrides?): PdfJsResourcePaths
detectDefaultLocale(): Locale
buildLocaleTable(tables): LocaleTable
mergeLocales(base, overrides): LocaleTable
isLocaleSupported(locale): boolean
themeClasses(theme, appearance): string
appearanceStyles(appearance): CSSProperties
pdfViewerError(code, options?): PdfViewerError
isRetryable(err): boolean
```

---

[← 返回 README](../README.md) · [使用指南](./GUIDE.md) · [扩展开发](./EXTENDING.md)
