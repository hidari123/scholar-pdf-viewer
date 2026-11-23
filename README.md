<!--
 * @Author: hidari
 * @Date: 2026-10-30 16:58:10
 * @LastEditors: hidari
 * @LastEditTime: 2026-11-20 22:30:00
 * Copyright (c) 2026 by hidari, All Rights Reserved.
-->

# @scholar-club/pdf-viewer

<div align="center">

**零 LLM 依赖、后端无关**的 PDF 查看器组件
**Zero-LLM, backend-agnostic** PDF viewer component

</div>

<div align="center">

| 语言 / Language               | 文档 / Docs                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| **[🇨🇳 中文](#中文--chinese)** | [使用指南](./docs/GUIDE.md) · [API 参考](./docs/API.md) · [扩展开发](./docs/EXTENDING.md)              |
| **[🇬🇧 English](#english)**    | [Getting Started](./docs/GUIDE.md) · [API Reference](./docs/API.md) · [Extending](./docs/EXTENDING.md) |

</div>

---

<a name="中文--chinese"></a>

# 中文

**零 LLM 依赖、后端无关**的 PDF 查看器组件。pdfjs-dist 6 直连，React 18/19 兼容，SSR 安全，零 UI 库。

包只做 PDF 的事：**加载 → 渲染 → 缩放 → 定位 → 选中 → 高亮绘制**。
弹窗、AI 对话、笔记、持久化——**全是宿主的事**（包只输出几何数据）。

```
主入口 29.69 kB（tree-shaken） · core 子路径 1.15 kB · CSS 12 kB
```

## 📖 文档

| 文档                                | 内容                                          |
| ----------------------------------- | --------------------------------------------- |
| **[使用指南](./docs/GUIDE.md)**     | 怎么接进来、完整接线示例、常见问题            |
| **[API 参考](./docs/API.md)**       | 全部 67 个 props、11 个 handle 方法、类型定义 |
| **[扩展开发](./docs/EXTENDING.md)** | 加按钮、加语言、换主题、换编辑器              |

## 设计原则（硬约束）

| 原则         | 说明                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| 零 LLM       | 无模型、无 agent、无 AI API                                                   |
| 零业务 API   | 包**永不请求宿主后端**；数据经 props 注入，经回调流出                         |
| 零 UI 库     | 包 / demo 均不使用 antd 等；样式为自制 CSS（`scpdf-` 前缀 + CSS 变量主题）    |
| 后端无关     | 包只认 `file`（URL / Blob / ArrayBuffer）——换后端不影响包内任何一行           |
| 渲染引擎可换 | pdf.js 在**宿主侧**，包只依赖最小接口（`getPage` / `getViewport` / `render`） |
| SSR 安全     | core 层零 React、零顶层 DOM 访问；任何框架可 import（有测试守卫）             |

## 安装

```sh
pnpm add @scholar-club/pdf-viewer
```

Peer：`react >=18 <20`（由宿主提供）。
可选 peer：`pdf-lib`（导出带高亮的 PDF）、`@tiptap/*`（富文本编辑器）、`react-dom`。

## 最小接入

```tsx
import { PdfViewer } from '@scholar-club/pdf-viewer';
import '@scholar-club/pdf-viewer/styles.css';

<PdfViewer file="/docs/paper.pdf" />;
```

**就这样**——没有 provider、没有 store 初始化、没有后端配置。

> ⚠️ **容器必须有高度**（包会填满父容器）。

## 三条消费契约

| 契约     | 包负责             | 宿主负责                                |
| -------- | ------------------ | --------------------------------------- |
| **渲染** | 加载 / 渲染 / 定位 | 提供 pdf.js 的 `getPage` / `getDocInfo` |
| **数据** | 渲染高亮和批注     | **存储**（数据库 / 后端）               |
| **动作** | 抛事件（`onXxx`）  | **执行**（翻译 / 提问 / 保存）          |

> 💡 **包不碰你的后端**。换后端不用改包。

## 宿主接线（完整示例）

```tsx
import { useCallback, useRef, useState } from 'react';
import { PdfViewer, type PdfViewerHandle } from '@scholar-club/pdf-viewer';
import '@scholar-club/pdf-viewer/styles.css';

export function Reader({ url, paperId }: { url: string; paperId: string }) {
  const viewerRef = useRef<PdfViewerHandle>(null);
  const [highlights, setHighlights] = useState<any[]>([]);

  const handleHighlight = useCallback((ctx: any) => {
    const id = `hl_${Date.now()}`;
    setHighlights((prev) => [
      ...prev,
      { id, selectedText: ctx.text, position: ctx.position, color: 'my-1' },
    ]);
    return id; // ← 返回 id，批注可以挂上去
  }, []);

  return (
    <PdfViewer
      ref={viewerRef}
      file={url}
      documentId={paperId} // ⚠️ 换文档时必须变
      highlights={highlights}
      onHighlight={handleHighlight}
      onExternalLink={(u) => window.open(u, '_blank', 'noopener')}
      /*
       * ⚠️ **包自己跳** -> 这里只被"通知"，**不要再调 goToPage**（会跳两次）。
       * -> ctx.targetPage = 目标页（不是链接所在页）
       * -> 想自己接管（比如弹确认框）-> 调 ctx.cancel()
       */
      onInternalLink={(ctx) => {
        console.log('跳到第', ctx.targetPage, '页');
      }}
      onError={(e) => console.error(e.code, e.message)}
    />
  );
}
```

## 能力清单

| 能力                    | 状态 | 说明                                                           |
| ----------------------- | ---- | -------------------------------------------------------------- |
| 渲染（canvas + 文字层） | ✅   | 逐 item 渲染，`scaleX` 精确对齐 pdf.js                         |
| 高亮 / 批注绘制         | ✅   | 正片叠底（`multiply`），和 WPS 一致                            |
| 选区浮层                | ✅   | 自研定位（不用 UI 库）                                         |
| 高亮浮层                | ✅   | 点高亮块出现的 4 个按钮                                        |
| 缩放                    | ✅   | 适应宽度 / 适应整页 / Ctrl+滚轮 / 就近取整到 10%               |
| 跳页                    | ✅   | 精确（靠 `getPageSizes`）                                      |
| 缩略图 / 目录 / 搜索    | ✅   | 宿主注入渲染函数                                               |
| 打印                    | ✅   | 保留高亮 / 只打原 PDF 两种模式；纸张可配（A4/A3/Letter/Legal） |
| 导出带高亮的 PDF        | ✅   | 真 PDF 批注（`/Subtype /Highlight`）                           |
| 多语言                  | ✅   | 内置 zh/en/ja/fr，宿主可加任意语言                             |
| 7 套主题 + CSS 变量     | ✅   |                                                                |
| 加密文档                | ✅   | 内置密码框 or 宿主接管                                         |
| 键盘快捷键              | ✅   | 翻页 / Home / End / 缩放                                       |
| RTL                     | ✅   | `dir="rtl"` / `locale="ar"` 自动判断；界面镜像 + 箭头翻转      |
| 拖放文件                | ❌   | 全在宿主                                                       |

## 坐标三空间（**存数据必看**）

| 空间       | 单位         | 用在哪                   |
| ---------- | ------------ | ------------------------ |
| **PDF 点** | pt（72dpi）  | 导出 PDF                 |
| **归一化** | 0~1 相对位置 | **持久化**（存数据库）✅ |
| **视口**   | 屏幕像素     | 渲染                     |

> 💡 **存高亮一定要用归一化坐标** —— 换缩放、换设备、换 PDF 大小，落点都对。

## 命令式句柄（`ref`）

```tsx
const viewerRef = useRef<PdfViewerHandle>(null);

viewerRef.current?.zoomIn(); // 放大
viewerRef.current?.zoomOut(); // 缩小
viewerRef.current?.fitWidth(); // 适应宽度
viewerRef.current?.fitPage(); // 适应整页
viewerRef.current?.goToPage(5); // 跳页
viewerRef.current?.print(); // 打印
viewerRef.current?.clearSelection();
```

全部 11 个方法见 [API 参考](./docs/API.md#3-pdfviewerhandle命令式句柄)。

## 自定义工具栏

**方式 A（推荐）—— 只加按钮，内置的都还在**：

```tsx
<PdfViewer toolbar={{ leftSlot: <SaveBtn />, rightSlot: <ShareBtn /> }} />;
```

**方式 B —— 整个替换**（靠 `viewerRef` 驱动）：

```tsx
<PdfViewer
  ref={viewerRef}
  slots={{ toolbar: <MyToolbar onZoomIn={() => viewerRef.current?.zoomIn()} /> }}
/>;
```

详见 [扩展开发](./docs/EXTENDING.md#2-加一个工具栏按钮)。

## 打印

```tsx
// 两种模式
<PdfViewer printMode="with-highlights" />  // 默认：打印带高亮
<PdfViewer printMode="original" />         // 只打印原 PDF

// 纸张（A4 / A3 / Letter / Legal，或自定义 mm）
<PdfViewer printPaper="Letter" />
<PdfViewer printPaper={{ width: 210, height: 297 }} />

// 边距（mm，部分覆盖；默认四边 12mm）
<PdfViewer printMargin={{ top: 20, bottom: 20 }} />
```

> ✅ 打印按钮和缩放按钮**互相独立**（`showZoom: false` 不会隐藏打印按钮）。

## RTL（从右往左）

```tsx
// 显式指定
<PdfViewer dir="rtl" locale="ar" />

// 或者**自动判断**（locale 是阿拉伯语 / 希伯来语 -> 自动 rtl）
<PdfViewer locale="ar" />
```

> ✅ **自动判断顺序**：显式 `dir` > `locale` > 宿主页面的 `document.dir` > `ltr`。
> 界面会**镜像**（工具栏、侧栏），**翻页箭头也会翻转**。

## 多语言

```tsx
// 加一个新语言
<PdfViewer locale="de" locales={{ de: { 'load.loading': 'Wird geladen…' } }} />

// 覆盖一两句
<PdfViewer messages={{ zh: { 'load.loading': '正在打开…' } }} />
```

> ⚠️ `locales` = **加一整个语言**；`messages` = **覆盖当前语言的个别句子**。

## 错误码

12 个，统一 `PdfViewerError`（带 `code` / `message` / `cause` / `retryable`）：

| 分类   | code                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| 加载 7 | `E_LOAD_HTTP` `E_LOAD_NETWORK` `E_LOAD_TIMEOUT` `E_PDF_INVALID` `E_EMPTY` `E_PDF_ENCRYPTED` `E_PDF_PASSWORD_WRONG` |
| 渲染 2 | `E_RENDER_PAGE` `E_FONT_MISSING`                                                                                   |
| 缓存 2 | `E_CACHE_QUOTA` `E_CACHE_UNAVAILABLE`                                                                              |
| 交互 1 | `E_LINK_INVALID`                                                                                                   |

> 💡 `retryable` = 重试**有可能成功**。文件坏了 / 密码错 → `false`。

## 开发

```sh
pnpm install
pnpm dev        # demo（固定端口 5180）
pnpm test       # 单元测试
pnpm verify     # 8 个门禁（lint / type / test / build / size / publint / attw…）
pnpm test:coverage   # 覆盖率
node scripts/e2e-all.mjs   # E2E
```

## License

UNLICENSED — 内部使用。

---

<a name="english"></a>

# English

**Zero-LLM, backend-agnostic** PDF viewer component. Direct pdfjs-dist 6 integration, React 18/19 compatible, SSR-safe, zero UI libraries.

The package does **only** PDF: **load → render → zoom → position → select → draw highlights**.
Popovers, AI chat, notes, persistence — **all host responsibilities** (the package only emits geometry).

```
Main entry 29.69 kB (tree-shaken) · core subpath 1.15 kB · CSS 12 kB
```

## 📖 Documentation

| Doc                                    | Contents                                              |
| -------------------------------------- | ----------------------------------------------------- |
| **[Getting Started](./docs/GUIDE.md)** | How to integrate, full wiring example, FAQ            |
| **[API Reference](./docs/API.md)**     | All 67 props, 11 handle methods, type definitions     |
| **[Extending](./docs/EXTENDING.md)**   | Add buttons, add languages, re-theme, swap the editor |

## Design principles (hard constraints)

| Principle         | Description                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Zero LLM          | No models, no agents, no AI APIs                                                               |
| Zero backend APIs | The package **never calls your backend**; data flows in via props and out via callbacks        |
| Zero UI libraries | No antd & co. in the package or demo; hand-rolled CSS (`scpdf-` prefix + CSS-variable theming) |
| Backend-agnostic  | The package only knows `file` (URL / Blob / ArrayBuffer) — swapping backends changes nothing   |
| Swappable engine  | pdf.js lives on the **host** side; the package depends on a minimal interface                  |
| SSR-safe          | The core layer has zero React and zero top-level DOM access; any framework can import it       |

## Install

```sh
pnpm add @scholar-club/pdf-viewer
```

Peer: `react >=18 <20` (provided by the host).
Optional peers: `pdf-lib` (export annotated PDF), `@tiptap/*` (rich-text editor), `react-dom`.

## Minimal integration

```tsx
import { PdfViewer } from '@scholar-club/pdf-viewer';
import '@scholar-club/pdf-viewer/styles.css';

<PdfViewer file="/docs/paper.pdf" />;
```

**That's it** — no provider, no store setup, no backend configuration.

> ⚠️ **The container must have a height** (the package fills its parent).

## Three consumption contracts

| Contract      | Package owns              | Host owns                                 |
| ------------- | ------------------------- | ----------------------------------------- |
| **Rendering** | Load / render / position  | Provide pdf.js `getPage` / `getDocInfo`   |
| **Data**      | Render highlights & notes | **Persist** them (database / backend)     |
| **Actions**   | Emit events (`onXxx`)     | **Execute** them (translate / ask / save) |

> 💡 **The package never touches your backend.** Swapping backends requires no package changes.

## Full wiring example

```tsx
import { useCallback, useRef, useState } from 'react';
import { PdfViewer, type PdfViewerHandle } from '@scholar-club/pdf-viewer';
import '@scholar-club/pdf-viewer/styles.css';

export function Reader({ url, paperId }: { url: string; paperId: string }) {
  const viewerRef = useRef<PdfViewerHandle>(null);
  const [highlights, setHighlights] = useState<any[]>([]);

  const handleHighlight = useCallback((ctx: any) => {
    const id = `hl_${Date.now()}`;
    setHighlights((prev) => [
      ...prev,
      { id, selectedText: ctx.text, position: ctx.position, color: 'my-1' },
    ]);
    return id; // ← returning the id lets notes attach to it
  }, []);

  return (
    <PdfViewer
      ref={viewerRef}
      file={url}
      documentId={paperId} // ⚠️ must change when the document changes
      highlights={highlights}
      onHighlight={handleHighlight}
      onExternalLink={(u) => window.open(u, '_blank', 'noopener')}
      /*
       * ⚠️ **The package jumps by itself** -> this is only a notification,
       *    do NOT call goToPage again (it would jump twice).
       * -> ctx.targetPage = the target page (not the page the link is on)
       * -> To take over (e.g. show your own confirmation) -> call ctx.cancel()
       */
      onInternalLink={(ctx) => {
        console.log('jumping to page', ctx.targetPage);
      }}
      onError={(e) => console.error(e.code, e.message)}
    />
  );
}
```

## Feature matrix

| Feature                          | Status | Notes                                                                               |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| Rendering (canvas + text layer)  | ✅     | Per-item rendering, `scaleX` aligned to pdf.js                                      |
| Highlight / annotation rendering | ✅     | Multiply blend mode, matches WPS                                                    |
| Selection popover                | ✅     | Hand-rolled positioning (no UI library)                                             |
| Highlight popover                | ✅     | The 4 buttons that appear on click                                                  |
| Zoom                             | ✅     | Fit width / fit page / Ctrl+wheel / snapped to 10%                                  |
| Page navigation                  | ✅     | Accurate (needs `getPageSizes`)                                                     |
| Thumbnails / outline / search    | ✅     | Host injects the render functions                                                   |
| Print                            | ✅     | Keep-highlights or original-PDF modes; paper size configurable (A4/A3/Letter/Legal) |
| Export annotated PDF             | ✅     | Real PDF annotations (`/Subtype /Highlight`)                                        |
| i18n                             | ✅     | zh/en/ja/fr built in, hosts can add any language                                    |
| 7 themes + CSS variables         | ✅     |                                                                                     |
| Encrypted documents              | ✅     | Built-in dialog or host-handled                                                     |
| Keyboard shortcuts               | ✅     | Navigate / Home / End / zoom                                                        |
| RTL (right-to-left)              | ✅     | `dir="rtl"` / `locale="ar"` auto-detected; layout mirrored, arrows flipped          |
| Drag & drop files                | ❌     | Entirely the host's job                                                             |

## Three coordinate spaces (read before persisting)

| Space          | Unit          | Used for                      |
| -------------- | ------------- | ----------------------------- |
| **PDF points** | pt (72dpi)    | Exporting PDFs                |
| **Normalized** | 0~1 relative  | **Persistence** (database) ✅ |
| **Viewport**   | screen pixels | Rendering                     |

> 💡 **Always persist normalized coordinates** — highlights stay put across zoom levels, devices and page sizes.

## Imperative handle (`ref`)

```tsx
const viewerRef = useRef<PdfViewerHandle>(null);

viewerRef.current?.zoomIn(); // zoom in
viewerRef.current?.zoomOut(); // zoom out
viewerRef.current?.fitWidth(); // fit width
viewerRef.current?.fitPage(); // fit page
viewerRef.current?.goToPage(5); // jump to page
viewerRef.current?.print(); // print
viewerRef.current?.clearSelection();
```

All 11 methods: [API Reference](./docs/API.md#3-pdfviewerhandle命令式句柄).

## Custom toolbar

**Option A (recommended) — add buttons, keep the built-ins**:

```tsx
<PdfViewer toolbar={{ leftSlot: <SaveBtn />, rightSlot: <ShareBtn /> }} />;
```

**Option B — replace it entirely** (drive it through `viewerRef`):

```tsx
<PdfViewer
  ref={viewerRef}
  slots={{ toolbar: <MyToolbar onZoomIn={() => viewerRef.current?.zoomIn()} /> }}
/>;
```

See [Extending](./docs/EXTENDING.md#2-加一个工具栏按钮).

## Print

```tsx
// two modes
<PdfViewer printMode="with-highlights" />  // default: keep highlights
<PdfViewer printMode="original" />         // print the original PDF only

// paper size (A4 / A3 / Letter / Legal, or custom mm)
<PdfViewer printPaper="Letter" />
<PdfViewer printPaper={{ width: 210, height: 297 }} />

// margins (mm, partial override; default 12mm on all sides)
<PdfViewer printMargin={{ top: 20, bottom: 20 }} />
```

> ✅ The print button and the zoom controls are **independent** (`showZoom: false` does not hide print).

## RTL (right-to-left)

```tsx
// explicit
<PdfViewer dir="rtl" locale="ar" />

// or **auto-detected** (an Arabic / Hebrew locale turns it on)
<PdfViewer locale="ar" />
```

> ✅ **Detection order**: explicit `dir` > `locale` > the host page's `document.dir` > `ltr`.
> The layout is **mirrored** (toolbar, side panels) and the **page arrows are flipped**.

## Multiple languages

```tsx
// add a new language
<PdfViewer locale="de" locales={{ de: { 'load.loading': 'Wird geladen…' } }} />

// override a couple of strings
<PdfViewer messages={{ en: { 'load.loading': 'Loading…' } }} />
```

> ⚠️ `locales` = **add a whole language**; `messages` = **override individual strings** for the current locale.

## Error codes

12 codes, unified `PdfViewerError` (with `code` / `message` / `cause` / `retryable`):

| Category        | code                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| Load × 7        | `E_LOAD_HTTP` `E_LOAD_NETWORK` `E_LOAD_TIMEOUT` `E_PDF_INVALID` `E_EMPTY` `E_PDF_ENCRYPTED` `E_PDF_PASSWORD_WRONG` |
| Render × 2      | `E_RENDER_PAGE` `E_FONT_MISSING`                                                                                   |
| Cache × 2       | `E_CACHE_QUOTA` `E_CACHE_UNAVAILABLE`                                                                              |
| Interaction × 1 | `E_LINK_INVALID`                                                                                                   |

> 💡 `retryable` means **a retry might succeed**. Broken file / wrong password → `false`.

## Development

```sh
pnpm install
pnpm dev        # demo (fixed port 5180)
pnpm test       # unit tests
pnpm verify     # 8 gates (lint / type / test / build / size / publint / attw…)
pnpm test:coverage   # coverage
node scripts/e2e-all.mjs   # E2E
```

## License

UNLICENSED — internal use.
