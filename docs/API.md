# API 参考 / API Reference

> 完整的接口清单。**中英双语**（中文在上，英文在下）。
>
> [← 返回 README](../README.md) · [使用指南](./GUIDE.md) · [扩展开发](./EXTENDING.md)

---

## 目录 / Table of Contents

- [1. 包入口 / Package entry points](#1-包入口-package-entry-points)
- [2. `<PdfViewer />` props](#2-pdfviewer-props)
- [3. `PdfViewerHandle`（命令式句柄）](#3-pdfviewerhandle命令式句柄)
- [4. `config`（统一配置对象）](#4-config统一配置对象)
- [5. 功能开关 / 工具栏 / 外观 / 插槽](#5-功能开关-工具栏-外观-插槽)
- [6. 宿主回调契约](#6-宿主回调契约)
- [7. 选区动作（自定义浮层按钮）](#7-选区动作自定义浮层按钮)
- [8. 富文本工具栏](#8-富文本工具栏)
- [9. 图标](#9-图标)
- [10. 多语言 / i18n](#10-多语言-i18n)
- [11. 主题与 CSS 变量](#11-主题与-css-变量)
- [12. 错误码](#12-错误码)
- [13. 数据类型](#13-数据类型)
- [14. 工具函数导出](#14-工具函数导出)

---

## 1. 包入口 / Package entry points

| 子路径 / Subpath                       | 内容 / Contents                        | 说明                               |
| -------------------------------------- | -------------------------------------- | ---------------------------------- |
| `@scholar-space/pdf-viewer`            | `PdfViewer` + 全部公共类型 + 工具函数  | 主入口                             |
| `@scholar-space/pdf-viewer/core`       | **零 React、零 DOM** 的纯逻辑          | 宿主可以单独用（比如服务端算坐标） |
| `@scholar-space/pdf-viewer/editor`     | `TipTapEditor`                         | 可选 peer：`@tiptap/*`             |
| `@scholar-space/pdf-viewer/dialog`     | `AnnotationDialog` / `AnnotationPanel` | 批注弹窗                           |
| `@scholar-space/pdf-viewer/icons`      | 全部图标组件                           | 单独引入图标                       |
| `@scholar-space/pdf-viewer/styles.css` | 基础样式（**必引**）                   |                                    |
| `@scholar-space/pdf-viewer/themes.css` | 7 套主题变量                           | 可选                               |

**必引样式**（否则布局全乱）：

```tsx
import '@scholar-space/pdf-viewer/styles.css';
import '@scholar-space/pdf-viewer/themes.css'; // 可选
```

> ⚠️ **可选 peer 依赖**：`pdf-lib`（导出带高亮的 PDF）、`@tiptap/*`（富文本编辑器）、`react-dom`。
> 不装也不影响使用 —— 包会自动降级。

---

## 2. `<PdfViewer />` props

### 2.1 文档与加载

| Prop           | 类型                     | 默认         | 说明                                                                       |
| -------------- | ------------------------ | ------------ | -------------------------------------------------------------------------- |
| `file`         | `DocumentSource \| null` | —            | **必填**。文档来源：`string`（URL）/ `Blob` / `ArrayBuffer` / `Uint8Array` |
| `documentId`   | `string`                 | —            | 宿主业务 id（缓存键）。**换文档时必须变**，否则不会重新加载                |
| `cache`        | `DocumentCache \| null`  | 内置内存缓存 | 文档缓存实例（`idb` 实现见 `core/cache`）                                  |
| `loadOptions`  | `LoadOptions`            | —            | 加载选项（HTTP 头、超时、Range 预检等）                                    |
| `password`     | `string`                 | —            | 加密文档的密码                                                             |
| `initialPage`  | `number`                 | `1`          | **初始页码**（会真的滚到那一页）                                           |
| `initialScale` | `'width' \| number`      | `'width'`    | 初始缩放。`'width'` = 适配宽度                                             |

### 2.2 数据（受控）

| Prop               | 类型                 | 默认      | 说明                                        |
| ------------------ | -------------------- | --------- | ------------------------------------------- |
| `highlights`       | `HighlightRecord[]`  | `[]`      | 高亮列表（**受控** —— 包不自己存）          |
| `highlightPalette` | `HighlightPalette`   | 内置 8 色 | 高亮色板：`{ [语义key]: CSS颜色 }`          |
| `stickyNotes`      | `AnnotationRecord[]` | `[]`      | 批注列表（**受控**）。不传 → 不渲染任何批注 |

### 2.3 行为 / 事件

| Prop                | 类型                                         | 说明                                 |
| ------------------- | -------------------------------------------- | ------------------------------------ |
| `onDocumentLoad`    | `(doc: PdfDocInfo) => void`                  | 加载成功                             |
| `onError`           | `(error: PdfViewerError) => void`            | 出错（**含 `code` 和 `retryable`**） |
| `onSelectionChange` | `(selection: SelectionData \| null) => void` | 选区变化（**纯几何**）               |
| `onPageChange`      | `(page: number, total: number) => void`      | 当前页变化                           |
| `onZoomChange`      | `(scale: number) => void`                    | 缩放变化                             |

### 2.4 pdf.js 注入回调（宿主提供）

> ⚠️ **包不内置 pdf.js**（体积大 + 许可证）。宿主注入下面几个函数。

| Prop                  | 类型                                                    | 必须？ | 说明                                                       |
| --------------------- | ------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| `getPage`             | `(n: number) => Promise<PageProxyLike \| undefined>`    | **是** | 取第 n 页                                                  |
| `getDocInfo`          | `(data: Uint8Array) => Promise<PdfDocInfo>`             | **是** | 文档信息（页数 / 元数据）                                  |
| `getPageSizes`        | `(n: number) => Promise<{width,height}[]>`              | 建议   | 各页尺寸（pt）。**不传则用 A4** → 跳页会偏                 |
| `getOutline`          | `() => Promise<OutlineItemLike[] \| null>`              | 可选   | 目录                                                       |
| `resolvePageRef`      | `(ref: unknown) => Promise<number \| null>`             | 可选   | **异步**解析页引用 → 页码（推荐）                          |
| `pageRefToNumber`     | `(ref: unknown) => number \| null`                      | 可选   | **同步**解析（比异步快，但拿不到 async 的 `getPageIndex`） |
| `outlineResolveToken` | `number`                                                | 可选   | 宿主解析完 **+1** → 告诉包"重新解析目录"                   |
| `renderThumbnail`     | `(n: number, width: number) => Promise<string \| null>` | 可选   | 缩略图（返回图片 URL）                                     |
| `searchEngine`        | `PdfSearch \| null`                                     | 可选   | 搜索引擎（`core/search` 的实例）                           |

### 2.5 外观 / 结构

| Prop               | 类型                                               | 默认                | 说明                                                             |
| ------------------ | -------------------------------------------------- | ------------------- | ---------------------------------------------------------------- |
| `theme`            | `PdfViewerTheme`                                   | `'light'`           | 主题：`light` `dark` `auto` `paper` `sepia` `contrast` `minimal` |
| `appearance`       | `PdfViewerAppearance`                              | —                   | 外观（密度 / 外壳 / 页阴影…）                                    |
| `config`           | `PdfViewerConfig`                                  | —                   | 统一配置对象（见 §4）                                            |
| `toolbar`          | `ToolbarConfig`                                    | —                   | 工具栏开关 + 左右插槽                                            |
| `features`         | `Partial<Features>`                                | 全开                | 功能开关（**opt-out**：只有显式 `false` 才关）                   |
| `printMode`        | `'with-highlights' \| 'original'`                  | `'with-highlights'` | 打印模式                                                         |
| `printPaper`       | `'A4' \| 'A3' \| 'Letter' \| 'Legal' \| PaperSize` | `'A4'`              | 打印纸张（mm）                                                   |
| `printMargin`      | `Partial<PrintMargin>`                             | 四边 12mm           | 打印边距（mm，部分覆盖）                                         |
| `printOrientation` | `'portrait' \| 'landscape' \| 'auto'`              | `'auto'`            | 打印方向（`landscape` = 横向纸张）                               |
| `dir`              | `'ltr'                                             | 'rtl'`              | 自动                                                             | 文字方向（RTL：界面镜像 + 箭头翻转） |
| `slots`            | `PdfViewerSlots`                                   | —                   | 插槽（完全替换内置 UI）                                          |
| `icons`            | `Partial<Record<IconName, ReactNode>>`             | —                   | 逐个图标覆盖                                                     |
| `children`         | `ReactNode`                                        | —                   | 渲染在工具栏下方                                                 |

### 2.5b 缩放

| Prop              | 类型                      | 默认   | 说明                       |
| ----------------- | ------------------------- | ------ | -------------------------- |
| `initialScale`    | `number`                  | —      | 初始缩放（默认"适合宽度"） |
| `minScale`        | `number`                  | `0.2`  | **最小缩放**（20%）        |
| `maxScale`        | `number`                  | `2.5`  | **最大缩放**（250%）       |
| `allowScaleInput` | `boolean`                 | `true` | 能不能**填写**缩放比例     |
| `onZoomChange`    | `(scale: number) => void` | —      | 缩放变化（宿主可自己存）   |

> ⚠️ **工具栏的比例可以点一下就填**
> -> 填的值会**夹到上下限** + **量化到 10%**（和 +/- 按钮一致）
> -> 上下限**宿主可配**

### 2.5c 主题

| Prop            | 类型                              | 默认      | 说明                           |
| --------------- | --------------------------------- | --------- | ------------------------------ |
| `theme`         | `PdfViewerTheme`                  | —         | 当前主题                       |
| `onThemeChange` | `(theme: PdfViewerTheme) => void` | —         | **传了**才显示工具栏的 🎨 按钮 |
| `themeOptions`  | `readonly PdfViewerTheme[]`       | 内置 7 个 | 主题列表（宿主可自定义）       |

> ⚠️ **不传 `onThemeChange` -> 不显示主题按钮**
> -> 宿主自己已经有主题切换 UI -> 不重复

> ⚠️ 主题是**受控**的
> -> 包**不自己存**主题状态  -> 调 `onThemeChange` -> **宿主**改 `theme` prop

### 2.6 多语言

| Prop       | 类型                | 默认       | 说明                                     |
| ---------- | ------------------- | ---------- | ---------------------------------------- |
| `locale`   | `Locale`            | 浏览器语言 | 当前语言。内置 `zh` / `en` / `ja` / `fr` |
| `messages` | `Partial<Messages>` | —          | **当前语言**的文案覆盖                   |
| `locales`  | `LocaleTable`       | —          | **语言表**（宿主可添加任意语言）         |

> ⚠️ `messages` 和 `locales` 容易混：
> **`messages` = 覆盖当前语言的个别句子**；**`locales` = 加一整个新语言**。

### 2.7 选区浮层

| Prop                 | 类型                                | 说明                                                |
| -------------------- | ----------------------------------- | --------------------------------------------------- |
| `selectionActions`   | `SelectionAction[]`                 | 自定义浮层动作（**覆盖同名内置** + **追加新动作**） |
| `onHighlight`        | `(ctx) => string \| undefined`      | "高亮"被点。**可以返回新建的高亮 id**               |
| `onHighlightCreate`  | `(highlight: NewHighlight) => void` | 宿主自己创建了高亮 → 通知包                         |
| `onHighlightCreated` | `() => void`                        | 宿主自己建完 → 调它 → **包会清选区**                |
| `onHighlightUpdate`  | `(id, highlight) => void`           | 更新高亮                                            |
| `onHighlightRemove`  | `(id) => void`                      | 删除高亮                                            |
| `onHighlightClick`   | `(highlight) => void`               | 点击高亮块                                          |
| `onCopy`             | `(ctx) => void`                     | "复制"。不传 → 用内置剪贴板                         |
| `onTranslate`        | `(ctx) => void`                     | "翻译"。**不传 → 不显示这个按钮**                   |
| `onAsk`              | `(ctx) => void`                     | "提问"。不传 → 不显示                               |
| `onExplain`          | `(ctx) => void`                     | "解释"。不传 → 不显示                               |
| `onNote`             | `(ctx) => void`                     | "笔记"。**不传也会显示** → 打开包自带的富文本弹窗   |

### 2.8 高亮块操作条（点高亮块出现的 4 个按钮）

| Prop                     | 类型                     | 说明                            |
| ------------------------ | ------------------------ | ------------------------------- |
| `onHighlightColorChange` | `(id, color) => void`    | 换色。**不传 → 不渲染这个按钮** |
| `onHighlightCopy`        | `(text: string) => void` | 复制文字                        |
| `onHighlightComment`     | `(id: string) => void`   | 批注                            |
| `onHighlightMore`        | `(id: string) => void`   | 更多（宿主自定义）              |

### 2.9 批注

| Prop                    | 类型                                           | 说明                                          |
| ----------------------- | ---------------------------------------------- | --------------------------------------------- |
| `onAnnotationClick`     | `(annotation) => void`                         | 点击批注                                      |
| `onAnnotationEdit`      | `(annotation, element?) => void`               | 点"编辑"。**不传 → 不渲染编辑按钮**           |
| `onAnnotationExpand`    | `(annotation) => void`                         | 点"展开"。不传 → 不渲染展开按钮               |
| `onAnnotationChange`    | `(id, html, plain) => void`                    | 内容变化。**不传 → 包只读展示**               |
| `onAnnotationSave`      | `(id, html, plain) => void`                    | 保存。**HTML 已经过 `sanitizeRichText` 清洗** |
| `onAnnotationCreate`    | `(id, html, plain, highlightId, text) => void` | 新建                                          |
| `onAnnotationDelete`    | `(id) => void`                                 | 删除                                          |
| `annotationToolbar`     | `RichTextToolbarItem[]`                        | 批注编辑器的工具栏                            |
| `annotationPalette`     | `RichTextPalette`                              | 批注编辑器的**高亮底色**色板（**浅色**）      |
| `annotationTextPalette` | `RichTextPalette`                              | 批注编辑器的**文字颜色**色板（**深色**）      |
| `annotationEditor`      | `ComponentType`                                | 换掉批注编辑器（比如用 `TipTapEditor`）       |

#### 批注的三个入口（**宿主必须知道的差异**）

| 入口                          | 触发                    | 需要传的 prop                               | 效果                                       |
| ----------------------------- | ----------------------- | ------------------------------------------- | ------------------------------------------ |
| **写新批注**（选中 → 加批注） | 选区浮层的"加批注"按钮  | `onAnnotationCreate`                        | 弹出**编辑弹窗** → 保存后回调              |
| **看详情**（便签 → 展开）     | 便签 hover → "展开"按钮 | `onAnnotationExpand` + `onAnnotationChange` | 打开**详情面板**（只读）→ 点"编辑"进编辑器 |
| **改已有批注**（便签 → 编辑） | 便签 hover → "编辑"按钮 | `onAnnotationEdit`                          | 弹出**锚点编辑弹窗**（贴着便签）           |

> ⚠️ **`onAnnotationExpand` 不传 → 便签上不渲染"展开"按钮**（用户会以为"按钮坏了"）。
> ⚠️ **`onAnnotationChange` 不传 → 详情面板**永远是只读**（"编辑"按钮点不动）。

#### 详情面板的"只读 → 编辑"流程

```
hover 便签 → 点"展开"
   ↓
【详情面板】只读（富文本渲染）
   ├─ 点"编辑" → **就地变成编辑器**（按钮变"完成"）→ `onAnnotationChange` 实时回调
   ├─ 点"删除" → `onAnnotationDelete`
   └─ 点"✕"    → 关闭
```

- 详情面板**贴在便签旁边**（不是页面最右）
- **打印时所有浮层都藏起来**（便签 / 详情面板 / 弹窗 / 颜色面板）
  -> 否则**批注正文会被打印出去**（隐私泄露）❌✅
- 合并组（同一行多条批注）的**选择列表**里点某项 → **打开那一条的详情**
- 列表**自动翻边**（右边放不下就往左开）

### 2.9b 工具栏的"高亮"按钮（第 28 轮新增）

| Prop                    | 类型                      | 默认       | 说明                               |
| ----------------------- | ------------------------- | ---------- | ---------------------------------- |
| `onToolbarHighlight`    | `(color: string) => void` | —          | **传了**才显示工具栏的"高亮"按钮   |
| `highlightPalette`      | `HighlightPalette`        | 内置       | 高亮色板（语义 key -> CSS 颜色）   |
| `defaultHighlightColor` | `string`                  | 色板第一个 | **默认色**的 key（没选过颜色时用） |

> ⚠️ **默认【隐藏】**
> -> 宿主自己已经有"加高亮"按钮 -> 不重复
> -> 用户确认："默认隐藏吧"

> ⚠️ 传了之后工具栏出现 **🖍 + ▾** 的**分裂按钮**
> -> 点**主按钮** -> 直接用"当前色"高亮
> -> 点 **▾** -> 展开颜色下拉
> -> 和**选区浮层**的分裂按钮**完全一致**（飞书 / WPS）

```tsx
<PdfViewer
  onToolbarHighlight={(color) => {
    // color 是**语义 key**（'yellow' / 'green' / …）
    // -> 宿主用 key 存"用户选的颜色"
  }}
  defaultHighlightColor="green"
/>;
```

### 2.10 链接 / 密码 / Toast

| Prop                 | 类型                                      | 说明                                  |
| -------------------- | ----------------------------------------- | ------------------------------------- |
| `onExternalLink`     | `(url: string) => void`                   | 外部链接点击（宿主决定怎么开）        |
| `onInternalLink`     | `(ctx: InternalLinkContext) => void`      | 内部链接（**包自己跳** + 宿主可拦截） |
| `onRequestPassword`  | `(info: { retry(pw), cancel() }) => void` | **宿主接管**密码输入                  |
| `showPasswordDialog` | `boolean`                                 | 用包内置密码框                        |
| `onToast`            | `(toast: ToastController) => void`        | **宿主完全接管** toast                |

#### `onInternalLink` 的契约（**重要**）

> ⚠️ **语义变更**：之前是 `onInternalLink(dest, pageNumber)`，其中 `pageNumber`
> 是**链接所在的页**（没用）。现在是**一个上下文对象**。

```ts
export interface InternalLinkContext {
  /** 原始 dest（数组 `[ref, '/XYZ', left, top, zoom]` 或命名目标字符串） */
  dest: string | unknown[];
  /** **目标页**（包解析出来的；解析不出时 `null`） */
  targetPage: number | null;
  /** 链接**所在**的页 */
  currentPage: number;
  /** 目标在这一页内的 y 坐标（PDF 点坐标） */
  targetY: number | null;
  /** **取消这次跳转**（宿主调用它 -> 包就不跳了） */
  cancel: () => void;
}
```

**跳转只有一个执行者（不会跳两次）**：

```
点内部链接
  → 包解析 dest -> targetPage
  → 调 onInternalLink(ctx)
      → 宿主不调 cancel() -> **包跳**
      → 宿主调 cancel()     -> **包不跳**
```

> ⚠️ **宿主在回调里**不要**再调 `goToPage`**（包已经跳了 -> 会跳两次）。
> 想自己接管（比如弹确认框）-> 调 `ctx.cancel()`。

**鲁棒性**：

| 情况                                          | 处理                                           |
| --------------------------------------------- | ---------------------------------------------- |
| 宿主没给 `resolvePageRef` / `pageRefToNumber` | 解析不出 -> **toast 提示**（不静默）           |
| dest 是**数组** `[ref, ...]`                  | `resolveDestPageAsync` 支持                    |
| dest 是**字符串**（具名目标 `"section.1"`）   | 走宿主的 `resolvePageRef`（异步展开）          |
| **目标页 == 当前页**                          | **照样跳**，而且滚到**那一行**（用 `targetY`） |
| 同一目标页 200ms 内重复触发                   | **幂等锁** -> 只跳一次                         |

---

## 3. `PdfViewerHandle`（命令式句柄）

```tsx
const viewerRef = useRef<PdfViewerHandle>(null);
<PdfViewer ref={viewerRef} ... />
```

| 方法              | 签名                         | 说明                                    |
| ----------------- | ---------------------------- | --------------------------------------- |
| `clearSelection`  | `() => void`                 | 清掉选区（宿主自己"消费"完选区后调）    |
| `createHighlight` | `(hl: NewHighlight) => void` | 宿主自己建了高亮 → 通知包（包会清选区） |
| `getCurrentPage`  | `() => number`               | 当前页码（1 起）                        |
| `getNumPages`     | `() => number`               | 总页数                                  |
| `getPageSizesPt`  | `() => {width,height}[]`     | 每页点尺寸（导出 PDF 时要用）           |
| `goToPage`        | `(page: number) => void`     | 跳页                                    |
| `zoomIn`          | `() => void`                 | 放大                                    |
| `zoomOut`         | `() => void`                 | 缩小                                    |
| `fitWidth`        | `() => void`                 | 适应宽度                                |
| `fitPage`         | `() => void`                 | 适应整页                                |
| `print`           | `() => void`                 | 打印                                    |

> 💡 宿主**替换了内置工具栏**（`slots.toolbar`）时，靠这些方法驱动缩放 / 打印。

---

## 4. `config`（统一配置对象）

**目的**：宿主想做一套"预设"（比如暗色模式）时，一次配好。

```tsx
<PdfViewer config={{ theme: 'dark', appearance: { density: 'compact' } }} />;
```

### 优先级规则

```
单独的 prop（不是 undefined）  ←  最高
config[key]
undefined                      ←  用内置默认值
```

> ⚠️ **单独 prop 优先**，这样 `<PdfViewer theme="paper" />` 的老代码行为不变。
>
> ⚠️ **`false` / `0` / `''` 都算"有值"**（不是 `undefined`）→ 单独 prop 里的 `false` 能覆盖 `config` 里的 `true`。

### `PdfViewerConfig` 的字段

| 字段                    | 类型                                    | 说明                         |
| ----------------------- | --------------------------------------- | ---------------------------- |
| `theme`                 | `PdfViewerTheme`                        | 主题                         |
| `appearance`            | `PdfViewerAppearance`                   | 外观                         |
| `highlightPalette`      | `HighlightPalette`                      | 高亮色板                     |
| `locale`                | `Locale`                                | 语言                         |
| `locales`               | `LocaleTable`                           | 语言表                       |
| `messages`              | `Partial<Messages>`                     | 文案覆盖                     |
| `selectionActions`      | `SelectionAction[]`                     | 选区动作                     |
| `annotationToolbar`     | `RichTextToolbarItem[]`                 | 批注工具栏                   |
| `annotationPalette`     | `RichTextPalette`                       | 批注**高亮底色**色板（浅色） |
| `annotationTextPalette` | `RichTextPalette`                       | 批注**文字颜色**色板（深色） |
| `toolbar`               | `ToolbarConfig`                         | 工具栏                       |
| `features`              | `Partial<Features>`                     | 功能开关                     |
| `printPaper`            | `keyof typeof PAPER_SIZES \| PaperSize` | 打印纸张                     |
| `printMargin`           | `Partial<PrintMargin>`                  | 打印边距                     |

> ⚠️ `config` **不覆盖** `file` / `highlights` / `stickyNotes` / `slots` / `printMode` / 所有 `onXxx` —— 那些只能单独传。

---

## 5. 功能开关 / 工具栏 / 外观 / 插槽

### `Features`

```ts
interface Features {
  search?: boolean; // 搜索
  thumbnails?: boolean; // 缩略图
  outline?: boolean; // 目录
  keyboard?: boolean; // 键盘快捷键
  print?: boolean; // 打印
}
```

> ⚠️ **默认全开**（opt-out）。只有显式写 `false` 才关。
> ⚠️ 目录按钮还需要 `getOutline`；缩略图按钮还需要 `renderThumbnail`。

### `ToolbarConfig`

```ts
interface ToolbarConfig {
  showPageNav?: boolean;
  showZoom?: boolean;
  showSearch?: boolean;
  showThumbnails?: boolean;
  showOutline?: boolean;
  leftSlot?: ReactNode; // 左侧插槽
  rightSlot?: ReactNode; // 右侧插槽
}
```

### `PdfViewerSlots`

```ts
interface PdfViewerSlots {
  toolbar?: ReactNode; // 整个替换内置工具栏
  panel?: ReactNode; // 整个替换内置侧栏
  pageOverlay?: (pageNumber: number) => ReactNode; // 每页都渲染
}
```

> 给了 slot → 包**不再负责**那一块的功能。

### `PdfViewerAppearance`

见 [GUIDE §主题](./GUIDE.md#主题与外观)。

---

## 6. 宿主回调契约

### 6.1 高亮的三种回调（**最容易搞混**）

| 回调                    | 什么时候用                 | 包会做什么                                                |
| ----------------------- | -------------------------- | --------------------------------------------------------- |
| `onHighlight(ctx)`      | 浮层里点"高亮"按钮         | 调它；**可以返回新建的高亮 id**（批注要挂在同一个 id 上） |
| `onHighlightCreate(hl)` | 宿主**自己**实现了高亮按钮 | 调它，然后**清选区**                                      |
| `onHighlightCreated()`  | 宿主自己建完高亮后         | 调它，然后**清选区**                                      |

> ⚠️ **`onHighlight` 和 `onHighlightCreate` 别都调** → 宿主会保存两次（实测：点一次生成 3 条）。
>
> 💡 宿主自己实现按钮时的标准写法：
>
> ```tsx
> onHighlightCreate={(hl) => save(hl)}
> onHighlightCreated={() => setState(null)}  // 包会清选区
> ```
> 或者更简单：用 `viewerRef.current.createHighlight(hl)`。

### 6.2 选区动作上下文 `SelectionActionContext`

```ts
interface SelectionActionContext {
  text: string; // 选中的文字
  position: NormPosition; // 归一化几何（宿主存高亮用）
  event?: PointerEventLike; // 触发事件（**可能没有** —— 点高亮块打开浮层时）
  color?: string; // 高亮颜色 key（只有"高亮"动作有）
  done?: () => void; // "高亮已创建" -> 告诉包清选区
}
```

### 6.3 密码（三种模式）

| 宿主配置                    | 行为                                   |
| --------------------------- | -------------------------------------- |
| `onRequestPassword`         | **宿主接管**。收到 `{ retry, cancel }` |
| `showPasswordDialog={true}` | 用包内置密码框                         |
| 都不传                      | 报错（`E_PDF_ENCRYPTED`）              |

```tsx
onRequestPassword={({ retry, cancel }) => {
  const pw = window.prompt('密码');
  if (pw) retry(pw); else cancel();
}}
```

### 6.4 Toast

```tsx
onToast={(toast) => {
  toast.success('已保存');
  toast.error('保存失败');
}}
```

不传 → 用包内置的 antd 风格 toast。

---

## 7. 选区动作（自定义浮层按钮）

```ts
interface SelectionAction {
  key: string; // 唯一 key（覆盖内置用同一个）
  icon?: SelectionActionIcon | ReactNode;
  label?: string; // 提示文案（也是 aria-label）
  group?: 'primary' | 'secondary';
  order?: number; // 排序
  when?: (ctx: SelectionActionContext) => boolean; // 返回 false -> 不渲染
  onSelect?: (ctx: SelectionActionContext) => void;
}
```

**内置 action key**（覆盖时用同样的 key）：

```
highlight  copy  translate  note  ask  explain  delete
```

**内置 label**（`BUILTIN_ACTION_LABELS`）：高亮 / 复制 / 翻译 / 笔记 / 提问 / 解释 / 删除

> 💡 `onTranslate` / `onAsk` / `onExplain` **传了才显示对应按钮** —— 这是"宿主没配就不渲染"的实现。

---

## 8. 富文本工具栏

```ts
interface RichTextToolbarItem {
  command: RichTextCommand; // 命令
  label: string; // 文案（支持 i18n 占位符）
  icon?: IconName; // 图标
  palette?: RichTextPalette; // 颜色面板
  group?: string; // 分组
  order?: number; // 排序
}
```

**全部命令**：

```
bold  italic  underline  strikeThrough
hiliteColor  textHighlight  foreColor  createLink
insertUnorderedList  insertOrderedList  formatBlock
removeFormat  undo  redo
```

### 三个颜色命令的区别（**别搞混**）

| 命令            | 作用         | 用哪个色板                      | 图标           |
| --------------- | ------------ | ------------------------------- | -------------- |
| `hiliteColor`   | **高亮底色** | `annotationPalette`（浅色）     | 笔 + 底部色条  |
| `textHighlight` | **文字高亮** | `annotationPalette`（浅色）     | "A" + 背景方块 |
| `foreColor`     | **文字颜色** | `annotationTextPalette`（深色） | "A" + 下方色条 |

> ⚠️ **`textHighlight` 只加背景色，**字色不变**（WPS 的"突出显示"）。
> ⚠️ **`foreColor` 必须用深色板** —— 浅色当字色会**看不见**。

### `removeFormat`（清除格式）会清什么

| 编辑器       | 清除的内容                         |
| ------------ | ---------------------------------- |
| TipTap       | 全部标记 + **字色** + **高亮底色** |
| 包内置编辑器 | 全部格式 + **字色** + **高亮底色** |

> ⚠️ **`removeFormat` 不弹颜色面板** —— 它是**直接执行**的。
> （`hiliteColor` / `textHighlight` / `foreColor` 才弹面板。）

**i18n 占位符**：`label` 写 `'{richtext.bold}'` → 由包解析成当前语言的文案。
**自定义按钮**也能翻译 —— 宿主加一个新的 key 到 `messages` 即可：

```tsx
const toolbar: RichTextToolbarItem[] = [{ command: 'bold', label: '{my.bold}', icon: 'bold' }];
// messages={{ 'my.bold': '加粗' }}
```

---

## 9. 图标

**全部 `IconName`（54 个）**：

```
chevronLeft  chevronRight  chevronUp  chevronDown
arrowLeft  arrowRight  zoomIn  zoomOut  fitWidth  fitPage  rotate
search  thumbnails  outline  print  upload  download
file  fileText  exportJson  exportPdf
highlight  highlightColor  textHighlight  comment  copy  trash  more
note  stickyNote  translate  ask  explain
plus  minus  close  check  alert  info  edit  link
bold  italic  underline  strike  quote  clearFormat  undo  redo
textColor  list  listOrdered  menu  settings
```

> 💡 **三个颜色图标刻意画得不一样**（用户反馈："图标还是跟文字颜色相同 需要区分开"）：
>
> | 图标             | 画法               |
> | ---------------- | ------------------ |
> | `highlightColor` | 笔 + **底部**色条  |
> | `textHighlight`  | "A" + **背景方块** |
> | `textColor`      | "A" + **下方色条** |
> | `clearFormat`    | "A" + **斜杠**划掉 |

**逐个覆盖**：

```tsx
import { Download } from 'lucide-react';

<PdfViewer icons={{ download: <Download size={16} />, upload: <Upload size={16} /> }} />;
```

---

## 10. 多语言 / i18n

### 回退链

```
messages[key]  →  locales[locale][key]  →  内置语言表  →  英文  →  key 本身
```

> 💡 找不到时回退到**英文**（不是中文）—— 避免中英混排。

### 加一个新语言

```tsx
const locales = {
  ja: {
    'load.loading': '読み込み中…',
    'page.of': '{page} / {total} ページ',
    // 不用写全 -> 缺的自动回退到内置
  },
};

<PdfViewer locale="ja" locales={locales} />;
```

### 覆盖个别句子

```tsx
<PdfViewer locale="zh" messages={{ 'load.loading': '正在打开文档…' }} />;
```

### 内置语言

`zh`（中文）/ `en`（英文）/ `ja`（日文）/ `fr`（法文）—— 共 **95** 条文案。

**完整 key 清单**见 [i18n/messages.ts](../src/i18n/messages.ts)。

---

## 11. 主题与 CSS 变量

### 主题

`light` · `dark` · `auto` · `paper` · `sepia` · `contrast` · `minimal`

```tsx
<PdfViewer theme="sepia" />;
```

### CSS 变量（第三层：像素微调）

覆盖即融入自家设计系统：

```css
:root {
  --scpdf-color-primary: #fa541c;
  --scpdf-highlight-my: #fff3bf;
}
```

**完整清单（19 个）**：

| 变量                        | 默认值                       | 用途                                           |
| --------------------------- | ---------------------------- | ---------------------------------------------- |
| `--scpdf-color-surface`     | `#ffffff`                    | 表面                                           |
| `--scpdf-color-surface-alt` | `#f5f6f8`                    | 次级表面                                       |
| `--scpdf-color-text`        | `#1f2329`                    | 文字                                           |
| `--scpdf-color-border`      | `#e5e6eb`                    | 边框                                           |
| `--scpdf-color-primary`     | `#2f54eb`                    | 主色                                           |
| `--scpdf-highlight-my`      | `#fff3bf`                    | 我的高亮                                       |
| `--scpdf-highlight-others`  | `#d6e4ff`                    | 他人的高亮                                     |
| `--scpdf-highlight-active`  | `#2f54eb`                    | 激活的高亮                                     |
| `--scpdf-selection-color`   | `rgba(13,104,189,0.24)`      | 选区（**要半透明**，正片叠底靠它决定浓淡）     |
| `--scpdf-bbox-color`        | `#2f54eb`                    | 选区边框                                       |
| `--scpdf-shadow-page`       | `0 2px 8px rgba(0,0,0,0.12)` | 页阴影                                         |
| `--scpdf-radius-page`       | `2px`                        | 页圆角                                         |
| `--scpdf-motion-fast`       | `120ms`                      | 快动画                                         |
| `--scpdf-motion-base`       | `200ms`                      | 常规动画                                       |
| `--scpdf-motion-slow`       | `320ms`                      | 慢动画                                         |
| `--scpdf-font-reading`      | 系统字体栈                   | **阅读字体**（`appearance.fontFamily` 覆盖它） |
| `--scpdf-font-size`         | `13px`                       | 基准字号（`appearance.fontSize` 覆盖它）       |
| `--scpdf-toolbar-height`    | `40px`                       | 工具栏高度（密度会改）                         |
| `--scpdf-panel-width`       | `220px`                      | 侧栏宽度（密度会改）                           |
| `--scpdf-gap`               | `12px`                       | 间距（密度会改）                               |

**密度预设**：

| density       | toolbar-height | panel-width | gap  |
| ------------- | -------------- | ----------- | ---- |
| `compact`     | 32px           | 180px       | 8px  |
| `cozy`        | 40px           | 220px       | 12px |
| `comfortable` | 48px           | 260px       | 16px |

> 💡 高亮色板会生成 `--scpdf-hl-<key>` 变量。

---

## 12. 错误码

12 个，统一 `PdfViewerError`：

```ts
interface PdfViewerError {
  code: PdfViewerErrorCode;
  message: string; // 可直接展示
  cause?: unknown; // 原始异常
  pageNumber?: number; // 出错页码
  retryable: boolean; // **能不能重试**
}
```

| 分类   | code                   | retryable |
| ------ | ---------------------- | --------- |
| 加载 7 | `E_LOAD_HTTP`          |           |
|        | `E_LOAD_NETWORK`       |           |
|        | `E_LOAD_TIMEOUT`       |           |
|        | `E_PDF_INVALID`        | ❌        |
|        | `E_EMPTY`              | ❌        |
|        | `E_PDF_ENCRYPTED`      | ❌        |
|        | `E_PDF_PASSWORD_WRONG` | ❌        |
| 渲染 2 | `E_RENDER_PAGE`        | ❌        |
|        | `E_FONT_MISSING`       | ❌        |
| 缓存 2 | `E_CACHE_QUOTA`        | ❌        |
|        | `E_CACHE_UNAVAILABLE`  | ❌        |
| 交互 1 | `E_LINK_INVALID`       | ❌        |

> 💡 `retryable` = 重试**有可能成功**。文件坏了 / 密码错 → 重试没用。

---

## 13. 数据类型

### 三个坐标空间（**最重要**）

| 空间       | 类型           | 用在哪                 | 说明                                |
| ---------- | -------------- | ---------------------- | ----------------------------------- |
| **PDF 点** | pt（72dpi）    | 导出 PDF               | A4 = 595 × 842                      |
| **归一化** | `NormPosition` | **持久化**（存数据库） | 0~1 的相对位置 → 任何缩放下落点一致 |
| **视口**   | `ViewRect`     | 渲染                   | 屏幕像素                            |

> 💡 **存高亮一定要用归一化坐标** —— 换个缩放、换个设备，落点才对。

### `HighlightRecord`

```ts
interface HighlightRecord {
  id: string; // 宿主 id（包不解释语义）
  color: string; // 语义色 key（如 'label-6'）-> 映射到自己的色板
  selectedText: string; // 选中的文字
  position: NormPosition; // 归一化（缩放无关）
  source?: 'my' | 'others'; // 来源（**只影响视觉**：我的 / 他人的高亮底色不同）
  createdAt?: number;
  updatedAt?: number;
}
```

> ⚠️ 字段叫 **`selectedText`** 不是 `text` —— 容易搞混。

### `NewHighlight`

```ts
interface NewHighlight {
  color: string;
  selectedText: string;
  position: NormPosition;
}
```

### `AnnotationRecord`

```ts
interface AnnotationRecord {
  id: string;
  highlightId: string; // 锚定的高亮 id（批注跟着高亮走）
  content: string; // 富文本 HTML
  text?: string; // 批注锚定的那段原文（选中的文字）
  position?: { x: number; y: number }; // 便签图标位置（**归一化** 0~1）
  createdAt?: number;
}
```

> 💡 `position` 不传 -> 用默认位置（高亮的右上角）。

---

## 14. 工具函数导出

| 函数                   | 说明                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `exportHighlightedPdf` | 把高亮导出成**真正的 PDF 批注**（Acrobat / Preview 都能看） |

> ⚠️ **导出的高亮【默认不带批注文字】**
> -> 选项：`includeAnnotationText`（默认 `false`）
> -> **为什么**：Chrome 的 PDF 阅读器里，**hover 到高亮上会弹出黄色便签框** ❌
>    -> 那个框显示的就是批注的 `/Contents`（弹出文字）
>    -> A/B 对照实验证明：**真凶是 `/Contents`**（不是 `/F` 标志位）
> -> 高亮本身**不需要**文字  -> 默认不写
> -> 宿主确实要（给 Acrobat / WPS 看）-> `includeAnnotationText: true`
> | `sanitizeRichText`                                    | 清洗富文本 HTML（**XSS 防线**）                             |
> | `richTextToPlain`                                     | HTML → 纯文本                                               |
> | `defaultRichTextToolbar`                              | 默认工具栏                                                  |
> | `execRichTextCommand`                                 | 执行一个富文本命令                                          |
> | `pdfViewerError`                                      | 构造标准错误对象                                            |
> | `isRetryable`                                         | 判断错误可不可重试                                          |
> | `resolveMessage`                                      | 解析一条文案（走完整回退链）                                |
> | `detectDefaultLocale`                                 | 按浏览器语言推断                                            |
> | `mergeLocales`                                        | 合并语言表（宿主覆盖内置）                                  |
> | `isLocaleSupported` / `buildLocaleTable`              | 语言表工具                                                  |
> | `layoutTextItems` / `layoutTextItemsWithIndexOffsets` | pdf.js 文本项排版                                           |
> | `buildSelectionShapes` / `extractSelection`           | 选区几何                                                    |
> | `searchDocument` / `alignSearchRects`                 | 搜索与命中高亮定位                                          |
> | `planThumbnails`                                      | 缩略图排布                                                  |
> | `anchoredScrollTop`                                   | 缩放时的锚点保持                                            |

---

**← 返回 [README](../README.md) · [使用指南](./GUIDE.md) · [扩展开发](./EXTENDING.md)**
