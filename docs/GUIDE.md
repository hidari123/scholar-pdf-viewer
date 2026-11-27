# 使用指南 / Getting Started

> 怎么把包接进你的项目。**中英双语**。
>
> [← 返回 README](../README.md) · [API 参考](./API.md) · [扩展开发](./EXTENDING.md)

---

## 目录 / Table of Contents

- [1. 30 秒接入](#1-30-秒接入)
- [2. 完整接线示例](#2-完整接线示例)
- [3. 三条消费契约](#3-三条消费契约)
- [4. 加载文档](#4-加载文档)
- [5. 高亮：从选区到持久化](#5-高亮从选区到持久化)
- [6. 批注](#6-批注)
- [7. 工具栏的六个开关](#7-工具栏的六个开关)
- [8. 自定义工具栏](#8-自定义工具栏)
- [9. RTL（从右往左）](#9-rtl从右往左)
- [10. 多语言](#10-多语言)
- [11. 富文本的两个色板](#11-富文本的两个色板)
- [12. 主题与外观](#12-主题与外观)
- [13. 打印](#13-打印)
- [14. 缩放](#14-缩放)
- [15. 导出带高亮的 PDF](#15-导出带高亮的-pdf)
- [16. 加密文档](#16-加密文档)
- [17. 错误处理](#17-错误处理)
- [18. 性能与缓存](#18-性能与缓存)
- [19. 常见问题](#19-常见问题)

---

## 1. 30 秒接入

**1. 装依赖**

```bash
pnpm add @scholar-space/pdf-viewer
# 可选：导出带高亮的 PDF
pnpm add pdf-lib
```

**2. 引样式**（**必做**，否则布局全乱）

```tsx
import '@scholar-space/pdf-viewer/styles.css';
import '@scholar-space/pdf-viewer/themes.css'; // 可选
```

**3. 用起来**

```tsx
import { PdfViewer } from '@scholar-space/pdf-viewer';

export function Reader({ url }: { url: string }) {
  return (
    <div style={{ height: '100vh' }}>
      <PdfViewer file={url} />
    </div>
  );
}
```

> ⚠️ **容器必须有高度**。包会填满父容器；父容器高度是 0 → 什么都看不见。

**只有 `<PdfViewer file={url} />` 这一行也是能跑的** —— 包内置了 pdf.js 的默认接线，
不用宿主再 import pdf.js、不用设 worker、不用注入 `getPage`。

---

## 2. 完整接线示例

一个真实的"论文阅读器"宿主：

```tsx
import { useCallback, useRef, useState } from 'react';
import {
  PdfViewer,
  exportHighlights,
  importHighlights,
  type PdfViewerHandle,
  type SelectionData,
} from '@scholar-space/pdf-viewer';
import '@scholar-space/pdf-viewer/styles.css';

export function Reader({ url }: { url: string }) {
  const viewerRef = useRef<PdfViewerHandle>(null);
  const [selection, setSelection] = useState<SelectionData | null>(null);

  /** 高亮是**受控**的：包只负责画，数据在宿主手里 */
  const [highlights, setHighlights] = useState<MyHighlight[]>([]);

  /** 存到后端 */
  const handleHighlight = useCallback((h: MyHighlight) => {
    setHighlights((prev) => [...prev, h]);
  }, []);

  return (
    <div style={{ height: '100vh' }}>
      <PdfViewer
        ref={viewerRef}
        file={url}
        documentId="paper-2024-05"
        highlights={highlights}
        onHighlight={handleHighlight}
        onSelectionChange={setSelection}
      />
    </div>
  );
}
```

---

## 3. 三条消费契约

包是**渲染层**，不碰业务数据。三条契约：

| 契约     | 包给什么                                 | 宿主负责什么                 |
| -------- | ---------------------------------------- | ---------------------------- |
| **高亮** | `onHighlight({ text, position, color })` | 存起来，回传给 `highlights`  |
| **批注** | `onAnnotationCreate / onAnnotationSave`  | 存起来，回传给 `stickyNotes` |
| **选区** | `onSelectionChange(selection \| null)`   | 自己决定弹什么（也可以不要） |

**位置必须存归一化坐标** —— 见第 5 节。

---

## 4. 加载文档

### pdf.js 的接线（**内置的**）

不传 `getPage` / `getDocInfo` 时，包用**内置的默认接线**：

- 自动 `import('pdfjs-dist')`（**动态导入** → 不拖慢没用 PDF 的页面）
- 自动设 `GlobalWorkerOptions.workerSrc`（打包器能静态分析 → 产物里带上 worker）
- 自动配 `standardFontDataUrl`（**标准字体** → 详见 4.3）

### `file` 支持什么

| 类型          | 说明                  |
| ------------- | --------------------- |
| `string`      | URL → 包用 `fetch` 拉 |
| `ArrayBuffer` | 内存里的字节          |
| `Uint8Array`  | 同上                  |
| `Blob`        | 同上                  |

### 4.1 ⚠️ `documentId` 必须变

```tsx
// ❌ 换文档但 documentId 没变 -> 不会重新加载
<PdfViewer file={urlA} documentId="local" />
<PdfViewer file={urlB} documentId="local" />

// ✅ 每份文档独立的 id
<PdfViewer file={urlA} documentId="paper-a" />
<PdfViewer file={urlB} documentId="paper-b" />
```

`documentId` 还是**缓存键的一部分** —— 同 id 的文档会命中缓存。

### 4.2 HTTP 请求带认证

```tsx
<PdfViewer
  file="/api/docs/123"
  loadOptions={{
    headers: { Authorization: `Bearer ${token}` },
    fetchImpl: (input, init) => fetch(input, init),
  }}
/>;
```

### 4.3 ⚠️ 标准字体（**乱码的根因**）

PDF 里**没有内嵌**的字体，pdf.js 要去 `standardFontDataUrl` 指的目录下载 `.pfb`。
不配的话 → 请求不到 → 那些字体 fallback 到系统字体 → **字宽度不对** → canvas 上
按字宽度排的文字**位置全错** → 页面上的字**挤成一团**（看着像乱码）。

**包已经内置**（`dist/standard_fonts/`）✅ —— 宿主不用管。

**要覆盖**（比如自己的字体子集）：

```tsx
import { resolvePdfJsResourcePaths } from '@scholar-space/pdf-viewer';

<PdfViewer
  file={url}
  pdfJsResourcePaths={{
    standardFontDataUrl: '/my-fonts/', // 覆盖内置的
    cMapUrl: '/pdfjs/cmaps/', // 中日韩竖排 PDF 才需要
    wasmUrl: '/pdfjs/wasm/', // JBIG2 / JPEG2000 图片才需要
  }}
/>;
```

> `cMapUrl` 和 `wasmUrl` **默认不内置**（体积大：1.1 MB / 1.5 MB）→
> 只有中日韩竖排 PDF、JBIG2 图片的文档才需要传。

---

## 5. 高亮：从选区到持久化

### 完整链路

```
用户选字
  → 包算出几何（SelectionData）
  → 包调 onHighlight({ text, position, color })
  → 宿主存起来
  → 宿主把 highlights 回传给包
  → 包把高亮画出来
```

### ⚠️ `defaultHighlightColor` 走 `config`

```tsx
// ❌ 不是 prop ❌
<PdfViewer file={url} defaultHighlightColor="green" />

// ✅ 在 config 里 ✅
<PdfViewer file={url} config={{ defaultHighlightColor: 'green' }} />
```

### ⚠️ 必须存归一化坐标

`position` 是**归一化**的（0~1，相对于页面）：

```ts
{
  pageNumber: 1,
  boundingRect: { x1: 0.12, y1: 0.34, x2: 0.48, y2: 0.37 },
  rects: [{ x1: 0.12, y1: 0.34, x2: 0.48, y2: 0.37 }],
}
```

**为什么**：换缩放、换窗口大小、换设备 → 像素坐标全变了 → 归一化坐标不变 ✅

### ⚠️ `onHighlight` 和 `onHighlightCreate` 别都调

| 回调                 | 什么时候调                                                         | 宿主要做什么   |
| -------------------- | ------------------------------------------------------------------ | -------------- |
| `onHighlight`        | 包**自己**创建了高亮（浮层按钮 / 工具栏按钮）                      | **存起来**     |
| `onHighlightCreate`  | **宿主自己**创建了高亮（调 `viewerRef.current.createHighlight()`） | **存起来**     |
| `onHighlightCreated` | 上面两个**之后**都会调                                             | 一般**不用管** |

两个都存 → 宿主会保存两次（实测：点一次高亮 → 生成了 3 条）。

### ⚠️ 工具栏的"高亮"按钮

包内置的工具栏「🖍 高亮」按钮：

- **有选区** → 调 `onToolbarHighlight(color)` ✅
- **没有选区** → **弹 toast 提示**「请先选中文字」，**不调**回调 ✅

（这个判断在**包内部**做的 —— 选区是包的状态，只有包知道有没有选中。）

---

## 6. 批注

### 三个入口，三个回调（**别漏传**）

| 入口                 | 回调                          |
| -------------------- | ----------------------------- |
| 选区浮层的「加批注」 | `onAnnotationCreate`          |
| 点已有批注的「编辑」 | `onAnnotationSave`（带 `id`） |
| 任意批注的「删除」   | `onAnnotationDelete`          |

### 便签详情的流程

```
点便签图标
  → 包的便利贴面板在便签**旁边**打开（不是页面中间）
  → 面板跟着滚动走（rAF 实时跟随）
  → 点「展开」→ 打开完整的富文本弹窗（贴在批注旁边）
```

### ⚠️ 打印时不会泄露批注内容

- `printMode="original"` → 只打原 PDF，**不含**高亮和批注
- `printMode="with-highlights"` → 打印 DOM，**含**高亮
- 两种模式都**不会**打印便签的**富文本内容**（那是 UI，不是文档内容）

### ⚠️ HTML 已经消毒过

批注内容存的是 HTML。包在渲染前会 `sanitizeRichText()` 过一遍，
所以宿主存进去的东西**不会**变成 XSS。

---

### 6.1 清除全部高亮会先问一句

点工具栏的「清除全部高亮」→ **弹确认框** ✅ → 点「清除」才真的清 ✅。

- 不用浏览器的 `window.confirm` ✅（那个**没法定制** ✅）
- 文案走 i18n ✅ · 确定按钮**红色** ✅ · **Esc** 也能关 ✅

---

## 7. 工具栏的六个开关

`toolbar` 对象可以逐个关掉内置按钮：

```tsx
<PdfViewer
  file={url}
  toolbar={{
    showDownloadPdf: false, // 隐藏「下载 PDF」
    showExportAnnotatedPdf: false, // 隐藏「导出带高亮的 PDF」
    showExportHighlights: false, // 隐藏「导出高亮」
    showImportHighlights: false, // 隐藏「导入高亮」
    showClearHighlights: false, // 隐藏「清除全部高亮」
    showHighlight: false, // 隐藏「🖍 高亮」
  }}
/>;
```

**语义**：不传 = 保持默认；`true` = 强制显示；`false` = 强制隐藏。

> 「下载 PDF」「导出带高亮的 PDF」「导出高亮」「导入高亮」「清除全部高亮」
> 这几个按钮**没有对应回调就不渲染** —— 包不知道数据存在哪。

---

## 8. 自定义工具栏

### 8.1 只想加两个按钮（**用 `toolbar.leftSlot` / `toolbar.rightSlot`**）

```tsx
<PdfViewer
  file={url}
  toolbar={{
    rightSlot: (
      <>
        <button onClick={() => void doSomething()}>我的按钮</button>
      </>
    ),
  }}
/>;
```

> ⚠️ `leftSlot` / `rightSlot` 在 **`toolbar` 对象里** ✅
> （`slots` 对象里是 `toolbar` / `panel` / `pageOverlay` ✅）

### 8.2 整个替换（`slots.toolbar`）

```tsx
<PdfViewer
  file={url}
  slots={{
    toolbar: <MyToolbar />,
  }}
/>;
```

> ⚠️ 替换了整个工具栏 → 缩放、翻页、搜索**都要自己接** →
> 用 `viewerRef.current` 的命令式句柄（见 API 文档第 3 节）。

### 8.3 关掉某些功能

```tsx
<PdfViewer
  file={url}
  features={{
    search: false, // 关掉搜索
    thumbnails: false, // 关掉缩略图
    outline: false, // 关掉目录
    print: false, // 关掉打印
    themePicker: false, // 关掉主题切换
  }}
/>;
```

`features` 是 **opt-out**：只有显式 `false` 才关。

---

## 9. RTL（从右往左）

### 自动判断顺序

1. 显式的 `dir` prop
2. `locale`（阿拉伯语 / 希伯来语等）
3. 宿主的 `document.dir`
4. 兜底 `ltr`

### 镜像了什么

- 翻页按钮的左右
- 侧栏的位置
- 文本对齐

---

## 10. 多语言

### 切换语言

```tsx
<PdfViewer file={url} locale="ja" />;
```

内置 **zh / en / ja / fr** 四种。

### 加一个新语言（西班牙语）

```tsx
import { buildLocaleTable } from '@scholar-space/pdf-viewer';

<PdfViewer
  file={url}
  locale="es"
  locales={buildLocaleTable({
    es: { 'selection.actionHighlight': 'Resaltar' },
  })}
/>;
```

### 覆盖一两个句子

```tsx
<PdfViewer
  file={url}
  messages={{
    zh: { 'selection.actionHighlight': '标记' },
  }}
/>;
```

### 自定义按钮也要能翻译

```tsx
<PdfViewer
  file={url}
  slots={{
    rightSlot: <button>{t('my.save')}</button>,
  }}
/>;
```

---

## 11. 富文本的两个色板

### 为什么分成两个

| 色板                    | 管什么                   | 默认         |
| ----------------------- | ------------------------ | ------------ |
| `annotationPalette`     | 批注工具栏的**按钮图标** | 内置         |
| `annotationTextPalette` | 文字的**颜色 / 高亮**    | 内置         |
| `highlightPalette`      | **选区高亮**的颜色       | 内置（8 色） |

### 工具栏里的三个颜色命令

| 命令            | 作用                     |
| --------------- | ------------------------ |
| `textColor`     | 改文字颜色               |
| `textHighlight` | 给文字加背景高亮         |
| `clearFormat`   | 清除格式（**A + 斜杠**） |

> ⚠️ `clearFormat`（清格式）和 `eraser`（清除全部高亮）是**两个不同的图标** ✅

### 换掉色板

```tsx
<PdfViewer file={url} highlightPalette={{ yellow: '#fff3a3', green: '#c8f7c5' }} />;
```

---

## 12. 主题与外观

### 四层定制（从粗到细）

```
1. theme="light" | "dark" | "auto"        ← 整套主题
2. appearance={{ density, fontSize, ... }}  ← 密度 / 字号
3. toolbar / features                        ← 按钮
4. icons / slots                             ← 图标 / 插槽
```

### 常用 `appearance` 字段

```tsx
appearance={{
  density: 'cozy',      // 'compact' | 'cozy' | 'comfortable'
  fontSize: 16,
  accentColor: '#2f54eb',
  fontFamily: 'system-ui',
  pageRadius: 8,
}}
```

### CSS 变量

所有主题变量都是 CSS 变量，宿主可以直接覆盖：

```css
.scpdf-root {
  --scpdf-color-primary: #2f54eb;
  --scpdf-color-border: #e5e7eb;
}
```

> ⚠️ **变量挂在 `.scpdf-root` 上** ✅ —— **不是** `:root` ✅
> → 宿主的 `<html>` 上**一个包的变量都没有** ✅ → **零全局污染** ✅
> → 想覆盖 ✅ → **在 `.scpdf-root` 上重定义** ✅

---

## 13. 打印

### 两种模式

```tsx
<PdfViewer file={url} printMode="original" />        // 只打原 PDF
<PdfViewer file={url} printMode="with-highlights" />  // 打印 DOM（含高亮）
```

### 打印按钮

```tsx
<PdfViewer file={url} onPrint={() => window.print()} />;
```

### 打印纸张

```tsx
<PdfViewer
  file={url}
  printPaper="A4"
  printOrientation="landscape"
  printMargin={{ top: 20, right: 15, bottom: 20, left: 15 }}
/>;
```

---

## 14. 缩放

### 三种方式

```tsx
// 1. 受控
<PdfViewer file={url} initialScale={1.5} onZoomChange={(s) => setScale(s)} />;

// 2. 命令式
viewerRef.current?.zoomIn();
viewerRef.current?.zoomOut();
viewerRef.current?.fitWidth();
viewerRef.current?.fitPage();

// 3. 用户交互（工具栏 / Ctrl + 滚轮）
```

### ⚠️ 手动缩放会解除"自适应"

调了 `zoomIn` / `zoomOut` 之后，"适应宽度 / 适应整页"的自动模式会**退出**。

---

## 15. 导出带高亮的 PDF

需要 `pdf-lib`：

```bash
pnpm add pdf-lib
```

```tsx
import { exportHighlightedPdf, downloadFile } from '@scholar-space/pdf-viewer';

const bytes = await exportHighlightedPdf({
  pdfBytes, // 原始 PDF 的字节
  highlights, // 高亮数组
  pageSizesPt: viewerRef.current?.getPageSizesPt(), // ⚠️ 必须传
  includeAnnotationText: false, // 要不要带上批注文字
});
downloadFile(bytes, 'paper-annotated.pdf');
```

> ⚠️ **`pageSizesPt` 必须传** —— 归一化坐标 → PDF 点坐标要按页尺寸换算。

### 高亮的导入 / 导出

```tsx
import { exportHighlights, importHighlights, parseHighlightDoc } from '@scholar-space/pdf-viewer';

// 导出成 JSON
const json = exportHighlights(highlights);

// 从 JSON 导入（**带校验，永不抛异常** ✅）
const doc = parseHighlightDoc(text);
if (doc) {
  setHighlights((prev) => [...prev, ...doc.highlights]);
}
```

---

## 16. 加密文档

### 用包内置的密码框（最简单）

```tsx
<PdfViewer file={url} showPasswordDialog />;
```

### 宿主自己接管

```tsx
<PdfViewer
  file={url}
  showPasswordDialog={false}
  onRequestPassword={({ retry, cancel }) => {
    const pwd = window.prompt('请输入密码');
    if (pwd) retry(pwd);
    else cancel();
  }}
/>;
```

---

## 17. 错误处理

```tsx
<PdfViewer
  file={url}
  onError={(err) => {
    console.error(err.code, err.message);
    // err.code 见 API 文档第 6 节
  }}
/>;
```

---

## 18. 性能与缓存

### 内存缓存（默认）

同 `documentId` 的文档会命中内存缓存，换回去不用重新拉。

### 用 IndexedDB 缓存（`idb`）

```bash
pnpm add idb
```

```tsx
import { openDB } from 'idb';

const db = await openDB('pdf-cache', 1, {
  upgrade(d) {
    d.createObjectStore('docs');
  },
});

<PdfViewer
  file={url}
  cache={{
    async get(key) {
      const buf = await db.get('docs', key);
      return buf ? new Uint8Array(buf) : null;
    },
    async set(key, data) {
      await db.put('docs', data, key);
    },
  }}
/>;
```

### 性能建议

- **别在 `onHighlight` 里做重活** —— 每次选区变化都会调
- **用 `documentId` 隔离缓存** —— 换文档时一定要换 id
- **长文档用 `initialScale` 固定缩放** —— "适应宽度"每次都要重排
- **侧栏面板是懒加载的** ✅ —— 点开才加载

---

## 19. 常见问题

<details>
<summary><b>页面一片空白</b></summary>

父容器**没有高度**。包会填满父容器 → 父容器高度是 0 → 什么都看不见。

```tsx
<div style={{ height: '100vh' }}>   {/* ✅ */}
```

</details>

<details>
<summary><b>样式全乱 / 按钮没样式</b></summary>

**没引样式**。必做：

```tsx
import '@scholar-space/pdf-viewer/styles.css';
```

</details>

<details>
<summary><b>页面上的字挤成一团（像乱码）</b></summary>

PDF 里**没内嵌字体** + 没配 `standardFontDataUrl` → 见 4.3。

包默认已经配好了；如果是**自己接的 pdf.js**（传了 `getDocInfo`），
要自己给 `pdfjs.getDocument()` 传 `standardFontDataUrl`：

```tsx
import { resolvePdfJsResourcePaths } from '@scholar-space/pdf-viewer';

const resources = resolvePdfJsResourcePaths();
const doc = await pdfjs.getDocument({
  data: data.slice(),
  standardFontDataUrl: resources.standardFontDataUrl,
}).promise;
```

</details>

<details>
<summary><b>换了文档但没重新加载</b></summary>

`documentId` 没变 → 命中缓存 → 不重新拉。见 4.1。

</details>

<details>
<summary><b>点了高亮，宿主存了两次</b></summary>

`onHighlight` 和 `onHighlightCreate` 都调了。见第 5 节。

</details>

<details>
<summary><b>工具栏的「高亮」按钮点了没反应</b></summary>

1. 没选字 → 包会弹 toast 提示 ✅（这是**预期行为**）
2. 传了 `onToolbarHighlight` 吗？→ 不传**按钮不渲染**

</details>

<details>
<summary><b>高亮的颜色不是我要的</b></summary>

```tsx
<PdfViewer file={url} highlightPalette={{ yellow: '#fff3a3' }} />;
```

</details>

<details>
<summary><b>批注面板离批注太远</b></summary>

不是配置问题 —— 包默认就**贴在批注旁边**并跟着滚动走。
如果很远，检查是不是**自己替换了**便签图标。

</details>

<details>
<summary><b>打印出来没有高亮</b></summary>

`printMode` 默认是 `original`（只打原 PDF）。
要打高亮用 `printMode="with-highlights"`。

</details>

<details>
<summary><b>中日韩竖排 PDF 显示不对</b></summary>

需要 `cMapUrl`：

```tsx
pdfJsResourcePaths={{ cMapUrl: '/pdfjs/cmaps/' }}
```

</details>

---

[← 返回 README](../README.md) · [API 参考](./API.md) · [扩展开发](./EXTENDING.md)
