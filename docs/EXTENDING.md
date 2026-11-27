# 扩展开发 / Extending

> 怎么在包的基础上加自己的东西。**中英双语**。
>
> [← 返回 README](../README.md) · [API 参考](./API.md) · [使用指南](./GUIDE.md)

---

## 目录 / Table of Contents

- [1. 扩展地图](#1-扩展地图)
- [2. 加一个工具栏按钮](#2-加一个工具栏按钮)
- [3. 加一个选区动作](#3-加一个选区动作)
- [4. 覆盖内置动作](#4-覆盖内置动作)
- [5. 加一种语言](#5-加一种语言)
- [6. 换图标](#6-换图标)
- [7. 换主题 / 做品牌色](#7-换主题--做品牌色)
- [8. 换富文本编辑器](#8-换富文本编辑器)
- [9. 自定义批注渲染](#9-自定义批注渲染)
- [10. 给"不可撤销"的操作加确认](#10-给不可撤销的操作加确认)
- [11. 接管 Toast](#11-接管-toast)
- [12. 接管密码输入](#12-接管密码输入)
- [13. 注入自己的 pdf.js](#13-注入自己的-pdfjs)
- [14. 覆盖 pdf.js 的静态资源](#14-覆盖-pdfjs-的静态资源)
- [15. 用 core 层的纯逻辑](#15-用-core-层的纯逻辑)
- [16. 包的边界（什么不要往里塞）](#16-包的边界什么不要往里塞)

---

## 1. 扩展地图

| 想做什么                 | 用什么                                   | 难度   |
| ------------------------ | ---------------------------------------- | ------ |
| 工具栏**加**按钮         | `toolbar.leftSlot` / `toolbar.rightSlot` | ⭐     |
| 工具栏**整个换**         | `slots.toolbar` + `viewerRef`            | ⭐⭐   |
| 选区浮层**加**动作       | `selectionActions`                       | ⭐     |
| 选区浮层**覆盖**内置动作 | `selectionActions`（同 key）             | ⭐     |
| 侧栏**整个换**           | `slots.panel`                            | ⭐     |
| 页面上**加**东西         | `slots.pageOverlay`                      | ⭐     |
| 加**一种语言**           | `locales`                                | ⭐     |
| 覆盖**一两句**文案       | `messages`                               | ⭐     |
| 换**图标**               | `icons`                                  | ⭐     |
| 做**品牌主题**           | `theme` + CSS 变量                       | ⭐⭐   |
| 换**高亮色板**           | `highlightPalette`                       | ⭐     |
| 换**富文本编辑器**       | `annotationEditor`                       | ⭐⭐⭐ |
| 自定义**批注样式**       | CSS 变量 + `slots`                       | ⭐⭐   |
| 给"不可撤销"操作加确认   | `ConfirmDialog`                          | ⭐     |
| 接管 **Toast**           | `onToast`                                | ⭐     |
| 接管**密码输入**         | `onRequestPassword`                      | ⭐     |
| 自带 **pdf.js**          | `getPage` / `getDocInfo` …               | ⭐⭐   |
| 换 **pdf.js 资源**       | `pdfJsResourcePaths`                     | ⭐     |

---

## 2. 加一个工具栏按钮

### 方式 A：插槽（**推荐** —— 不动内置逻辑）

```tsx
function MyToolbarExtras() {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button onClick={saveAll}>保存</button>
      <button onClick={share}>分享</button>
    </div>
  );
}

<PdfViewer
  file={url}
  toolbar={{
    leftSlot: <MyToolbarExtras />,
    rightSlot: <button onClick={openSettings}>⚙</button>,
  }}
/>;
```

> ⚠️ `leftSlot` / `rightSlot` 在 **`toolbar` 对象里** ✅
> （`slots` 对象里是 `toolbar` / `panel` / `pageOverlay` ✅）

### 方式 B：整个替换（要完全控制布局时）

```tsx
<PdfViewer file={url} slots={{ toolbar: <MyToolbar /> }} />;
```

**替换后这些都要自己接**（用 `viewerRef`）：

```tsx
const viewerRef = useRef<PdfViewerHandle>(null);

<MyToolbar
  onPrev={() => viewerRef.current?.goToPage(page - 1)}
  onNext={() => viewerRef.current?.goToPage(page + 1)}
  onZoomIn={() => viewerRef.current?.zoomIn()}
  onZoomOut={() => viewerRef.current?.zoomOut()}
  onFitWidth={() => viewerRef.current?.fitWidth()}
  onSearch={() => setSearchOpen(true)}
/>;
```

---

## 3. 加一个选区动作

```tsx
<PdfViewer
  file={url}
  selectionActions={[
    {
      key: 'summarize',
      icon: 'copy',
      label: '总结',
      group: 'primary',
      order: 30,
      onSelect: ({ text }) => void summarize(text),
    },
  ]}
/>;
```

### 带条件显示（只在选中英文时出现）

```tsx
{
  key: 'translate',
  icon: 'translate',
  label: '翻译',
  group: 'secondary',
  order: 40,
  // ⚠️ 不传 `when` -> 一直显示 ✅
  when: ({ text }) => /[a-zA-Z]/.test(text),
  onSelect: ({ text }) => void translate(text),
}
```

### ⚠️ `label` 建议走 i18n

`label` 是**字符串**，不是 key。要走 i18n 就自己翻译：

```tsx
const { locale } = useViewerLocale();   // 宿主自己的 i18n
label: locale === 'zh' ? '总结' : 'Summarize',
```

---

## 4. 覆盖内置动作

**同一个 `key`** 就能覆盖内置的动作：

```tsx
import { mergeSelectionActions } from '@scholar-space/pdf-viewer';

<PdfViewer
  file={url}
  selectionActions={mergeSelectionActions(
    // ⚠️ **内置的** ✅
    undefined,
    // ⚠️ **同 key 覆盖** ✅
    [
      {
        key: 'copy',
        icon: 'copy',
        label: '复制原文',
        group: 'primary',
        order: 20,
        onSelect: ({ text }) => void copyRaw(text),
      },
    ],
  )}
/>;
```

内置的 key 见 `BUILTIN_ACTION_KEYS`。

---

## 5. 加一种语言

### ⚠️ `locales` vs `messages`

| prop       | 干什么                   | 用在哪     |
| ---------- | ------------------------ | ---------- |
| `messages` | **覆盖**内置语言的一两句 | 改文案     |
| `locales`  | **新增**一种语言         | 加西班牙语 |

```tsx
import { buildLocaleTable } from '@scholar-space/pdf-viewer';

<PdfViewer
  file={url}
  locale="es"
  locales={buildLocaleTable({
    es: {
      'selection.actionHighlight': 'Resaltar',
      'selection.actionCopy': 'Copiar',
      'toast.copied': 'Copiado al portapapeles',
    },
  })}
/>;
```

### 覆盖一两句

```tsx
<PdfViewer
  file={url}
  messages={{
    zh: { 'selection.actionHighlight': '标记' },
    en: { 'selection.actionHighlight': 'Mark' },
  }}
/>;
```

---

## 6. 换图标

### 逐个覆盖

```tsx
<PdfViewer
  file={url}
  icons={{
    highlight: <MyHighlightIcon />,
    download: <MyDownloadIcon />,
  }}
/>;
```

### 用包自带的图标集（不引第三方库）

```tsx
import { getIconShape, type IconName } from '@scholar-space/pdf-viewer/icons';

const shape = getIconShape('highlight');
// { paths, fills, circles, rects, lines, polylines }
```

### 自己加一个新图标

图标的几何数据是**纯数据**（坐标系统一 24×24，描边 `currentColor`）：

```tsx
const myIcon = {
  paths: ['M12 3v18', 'M5 10l7-7 7 7'],
};

<PdfViewer file={url} icons={{ sparkle: <MySvg paths={myIcon.paths} /> }} />;
```

---

## 7. 换主题 / 做品牌色

### 用内置主题

```tsx
<PdfViewer file={url} theme="dark" />;
```

### 做自己的品牌主题（CSS 变量）

```css
.scpdf-root {
  --scpdf-color-accent: #7c3aed;
  --scpdf-color-accent-soft: #ede9fe;
  --scpdf-color-border: #e5e7eb;
  --scpdf-color-bg: #ffffff;
  --scpdf-color-bg-subtle: #f9fafb;
  --scpdf-color-text: #1f2329;
  --scpdf-color-text-subtle: #6b7280;
}
```

### 高亮色板（品牌色）

```tsx
<PdfViewer
  file={url}
  highlightPalette={{
    yellow: '#fef08a',
    green: '#bbf7d0',
    brand: '#7c3aed', // ⚠️ 自定义 key ✅
  }}
/>;
```

> ⚠️ **key 是语义名**，包只认 key 不认含义 ✅
> 不传就用内置的 8 色（`BUILTIN_HIGHLIGHT_PALETTE`）✅

---

## 8. 换富文本编辑器

### 用 TipTap（包自带集成）

```tsx
import { TipTapEditor } from '@scholar-space/pdf-viewer/editor';

<TipTapEditor value={html} onChange={setHtml} palette={myPalette} />;
```

### 用自己的编辑器

⚠️ `annotationEditor` 收的是**组件**，不是配置对象 ✅

```tsx
function MyEditor(props: {
  value?: string;
  onChange?: (html: string, plain: string) => void;
  onCancel?: () => void;
  onSave?: (html: string) => void;
}) {
  return (
    <textarea
      value={props.value}
      onChange={(e) => props.onChange?.(e.target.value, e.target.value)}
    />
  );
}

<PdfViewer file={url} annotationEditor={MyEditor} />;
```

> ⚠️ `onChange` 的第二个参数是**纯文本** ✅ -> 存的时候可以用它做搜索/复制 ✅

### ⚠️ 自定义编辑器要支持这三个颜色命令

包会调这三个命令名：

| 命令            | 作用             |
| --------------- | ---------------- |
| `textColor`     | 改文字颜色       |
| `textHighlight` | 给文字加背景高亮 |
| `clearFormat`   | 清除格式         |

```tsx
import { execRichTextCommand } from '@scholar-space/pdf-viewer';

execRichTextCommand('textColor', { color: '#ff0000' });
execRichTextCommand('textHighlight', { color: '#ffff00' });
execRichTextCommand('removeFormat');
```

### ⚠️ 图标要能区分开

- `textColor` = A + **色条**
- `textHighlight` = **粗色带**
- `clearFormat` = A + **斜杠**
- `eraser` = **橡皮擦**（清除全部高亮 ✅）

四个都**不能画成一样** ✅

---

## 9. 自定义批注渲染

### CSS 定制小便签

```css
.scpdf-sticky-note__icon {
  --scpdf-note-color: #7c3aed;
  border-radius: 6px;
}
```

### 用 `slots.pageOverlay` 在页上加东西

```tsx
<PdfViewer
  file={url}
  slots={{
    pageOverlay: (pageNumber: number) => <div className="my-page-badge">第 {pageNumber} 页</div>,
  }}
/>;
```

> ⚠️ `pageOverlay` **可以传函数** ✅ -> 按页号调用 ✅

---

## 10. 给"不可撤销"的操作加确认

包**自研**了确认框 ✅（不用 `window.confirm` ✅ —— 那个**没法定制** ✅）。

```tsx
import { ConfirmDialog } from '@scholar-space/pdf-viewer/dialog';

function MyDeleteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>删除</button>
      <ConfirmDialog
        open={open}
        title="删除这份笔记？"
        message="删除后无法恢复。"
        confirmText="删除"
        danger
        onConfirm={() => {
          setOpen(false);
          void doDelete();
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
```

| 想要的行为                      | 怎么配                       |
| ------------------------------- | ---------------------------- |
| 确定按钮**红色**（不可撤销 ✅） | `danger`                     |
| 自定义按钮文字                  | `confirmText` / `cancelText` |
| **Esc** 关闭                    | 默认就有 ✅                  |
| 点遮罩关闭                      | 默认就有 ✅                  |

---

## 11. 接管 Toast

```tsx
<PdfViewer
  file={url}
  onToast={(toast) => {
    toast.success('已保存');
    void toast.loadingPromise('正在导出…', async () => {
      const bytes = await exportPdf();
      downloadFile(bytes, 'a.pdf');
    });
  }}
/>;
```

传了 `onToast` → **完全接管** ✅ -> 包不渲染自己的 toast 容器 ✅

---

## 12. 接管密码输入

```tsx
<PdfViewer
  file={url}
  showPasswordDialog={false}
  onRequestPassword={({ retry, cancel }) => {
    showMyDialog((pwd) => {
      if (pwd) retry(pwd);
      else cancel();
    });
  }}
/>;
```

---

## 13. 注入自己的 pdf.js

### 最小接线

```tsx
import * as pdfjs from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

<PdfViewer
  file={url}
  getDocInfo={async (data) => {
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
    return { numPages: doc.numPages, metadata: await doc.getMetadata() };
  }}
  getPage={async (pageNumber) => {
    const doc = myDocRef.current!;
    const page = await doc.getPage(pageNumber);
    return {
      pageNumber: page.pageNumber,
      getViewport: ({ scale }) => page.getViewport({ scale }),
      getTextContent: () => page.getTextContent(),
      render: (params) => page.render(params),
    };
  }}
/>;
```

### ⚠️ 接了自己的 pdf.js 就要自己配资源路径

见下一节 —— **不配的话会乱码** ⚠️

---

## 14. 覆盖 pdf.js 的静态资源

### 为什么需要

pdf.js 给文档里的每种字体建 `@font-face`。
PDF 里**内嵌了**的字体它能直接拿到字节；
**没内嵌的**要去 `standardFontDataUrl` 指的目录下载 `.pfb`。

不配 → 请求不到 → 那些字体 fallback 到系统字体 → **字宽度不对** →
canvas 上按字宽度排的文字**位置全错** → **页面上的字挤成一团**（像乱码）。

### 包已经内置了 ✅

`dist/standard_fonts/` 已经在包里 → **用默认接线的话不用管** ✅

### 自己接 pdf.js 的话

```tsx
import { resolvePdfJsResourcePaths } from '@scholar-space/pdf-viewer';

const resources = resolvePdfJsResourcePaths();
const doc = await pdfjs.getDocument({
  data: data.slice(),
  standardFontDataUrl: resources.standardFontDataUrl,
}).promise;
```

### 覆盖成自己的

```tsx
const resources = resolvePdfJsResourcePaths({
  standardFontDataUrl: '/my-fonts/', // 覆盖内置的 ✅
  cMapUrl: '/pdfjs/cmaps/', // 中日韩竖排 PDF 才需要
  wasmUrl: '/pdfjs/wasm/', // JBIG2 / JPEG2000 图片才需要
});
```

> ⚠️ **必须是浅覆盖** ✅ -> 只写要改的那几个 ✅ -> 其他的还用内置的 ✅
> ⚠️ **URL 必须带尾部斜杠** ✅ -> pdf.js 是**直接拼文件名**的 ✅
> （`new URL('./x/', base)` 会**吃掉**尾斜杠 ✅ -> 要自己补回去 ✅）

---

## 15. 用 core 层的纯逻辑

`@scholar-space/pdf-viewer/core` 是**零 React** 的 ✅ —— 可以单独拿去用。

```tsx
import {
  exportHighlightedPdf,
  parseHighlightDoc,
  groupAnnotations,
  computePrintScale,
} from '@scholar-space/pdf-viewer/core';
```

### core 层有哪些

| 目录              | 内容                  |
| ----------------- | --------------------- |
| `annotation/`     | 批注分组、便签定位    |
| `cache/`          | 字节缓存接口          |
| `config/`         | 配置合并、类型        |
| `document/`       | 文档加载、pdf.js 接线 |
| `editor/`         | 富文本命令、HTML 消毒 |
| `errors/`         | 错误码                |
| `export/`         | 导出带高亮的 PDF      |
| `geometry/`       | 坐标换算              |
| `highlight/`      | 高亮 → PDF 注解       |
| `icons/`          | 图标几何数据          |
| `outline/`        | 目录                  |
| `print/`          | 打印尺寸计算          |
| `render/`         | **渲染队列**          |
| `search/`         | 搜索引擎              |
| `selection/`      | 选区几何、动作        |
| `store/`          | 文档缓存              |
| `text-layer/`     | 文本层排版            |
| `theme/`          | 主题、外观            |
| `thumbnail/`      | 缩略图规划            |
| `virtualization/` | 可视页计算            |

---

## 16. 包的边界（什么不要往里塞）

包是**通用组件**。下面这些**不该**进包：

| 东西                         | 为什么                      | 该放哪 |
| ---------------------------- | --------------------------- | ------ |
| 后端调用 / 持久化            | 包不该知道你的业务          | 宿主   |
| 认证 / 权限                  | 同上                        | 宿主   |
| 用户的笔记 / 标签            | 高亮数据在宿主手里          | 宿主   |
| 特定领域的按钮（"生成摘要"） | 用 `selectionActions` ✅    | 宿主   |
| 自己的 UI 组件库             | 包只认 `ReactNode` ✅       | 宿主   |
| 特定字体                     | 用 `pdfJsResourcePaths` ✅  | 宿主   |
| 特定打印模板                 | 用 `printMode` + `slots` ✅ | 宿主   |

### 判断标准

> **"这个功能换个宿主还有用吗？"**
>
> 有 → 可以考虑进包
> 没有 → 宿主自己做

---

[← 返回 README](../README.md) · [API 参考](./API.md) · [使用指南](./GUIDE.md)
