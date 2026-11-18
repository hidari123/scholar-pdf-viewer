<!--
 * @Author: hidari
 * @Date: 2026-10-30 16:58:10
 * @LastEditors: hidari
 * @LastEditTime: 2026-11-13 18:05:00
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 -->

# @scholar-club/pdf-viewer

**零 LLM 依赖、后端无关**的 PDF 查看器组件。pdfjs-dist 6 直连，React 18/19 兼容，SSR 安全，零 UI 库。

包只做 PDF 的事：**加载 → 渲染 → 缩放 → 定位 → 选中 → 高亮绘制**。
弹窗、AI 对话、笔记、持久化——**全是宿主的事**（包只输出几何数据）。

```
主入口 13.67 kB（tree-shaken） · core 子路径 1.15 kB · CSS 12 kB
```

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

## 最小接入

```tsx
import { PdfViewer } from '@scholar-club/pdf-viewer';
import '@scholar-club/pdf-viewer/styles.css';

<PdfViewer file="/docs/paper.pdf" />;
```

**就这样**——没有 provider、没有 store 初始化、没有后端配置。

## 三条消费契约

```js
// 1. 主入口：组件 + hooks + 类型
import { PdfViewer, usePdfDocument, PdfSearch } from '@scholar-club/pdf-viewer';

// 2. core 子路径：零 React，Node / Worker / SSR 可用
import { findCurrentPage, extractSelection } from '@scholar-club/pdf-viewer/core';

// 3. 样式：包不注入样式，消费者自行 import（或 CDN 直引）
import '@scholar-club/pdf-viewer/styles.css';
```

## 宿主接线（完整示例）

pdf.js 全在宿主侧；包只依赖最小接口。**换渲染引擎也不用改包**。

```tsx
import * as pdfjs from 'pdfjs-dist';
import { useCallback, useRef, useState } from 'react';
import { PdfViewer } from '@scholar-club/pdf-viewer';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export function Reader({ url }: { url: string }) {
  const docRef = useRef<pdfjs.PDFDocumentProxy | null>(null);

  // 高亮是**受控**的：包只负责画，宿主负责存
  const [highlights, setHighlights] = useState([]);

  const getPage = useCallback(async (pageNumber: number) => {
    const doc = docRef.current;
    if (!doc) return undefined;
    const page = await doc.getPage(pageNumber);
    return {
      pageNumber: page.pageNumber,
      getViewport: (p: { scale: number }) => {
        const v = page.getViewport(p);
        return { width: v.width, height: v.height, scale: v.scale };
      },
      getTextContent: () => page.getTextContent(),
      render: (params: { canvasContext: CanvasRenderingContext2D; viewport: any }) => {
        const viewport = page.getViewport({ scale: params.viewport.scale });
        return page.render({
          canvas: params.canvas,
          canvasContext: params.canvasContext,
          viewport,
        });
      },
    };
  }, []);

  const getDocInfo = useCallback(async (data: Uint8Array) => {
    const doc = await pdfjs.getDocument({ data: data.slice() }).promise;
    docRef.current = doc;
    return { numPages: doc.numPages };
  }, []);

  return (
    <PdfViewer
      file={url}
      highlights={highlights}
      getPage={getPage}
      getDocInfo={getDocInfo}
      onSelectionChange={(selection) => {
        // selection 只有几何：宿主决定弹什么窗 / 调不调模型
        console.log(selection?.text, selection?.norm);
      }}
    />
  );
}
```

## `<PdfViewer>` 主要 props

| prop                  | 类型                                       | 说明                                |
| --------------------- | ------------------------------------------ | ----------------------------------- |
| `file`                | `string \| Blob \| ArrayBuffer \| null`    | 文档来源（唯一必填）                |
| `highlights`          | `HighlightRecord[]`                        | 受控高亮                            |
| `highlightPalette`    | `Record<string, string>`                   | 高亮色板（语义 key → CSS 颜色）     |
| `selectionActions`    | `SelectionAction[]`                        | 选区浮层动作（覆盖/追加内置）       |
| `onHighlight`         | `(ctx) => void`                            | 浮层"高亮"被点（带颜色 key）        |
| `onCopy`              | `(ctx) => void`                            | 浮层"复制"（不传则用剪贴板）        |
| `onTranslate`         | `(ctx) => void`                            | 浮层"翻译"（不传**不显示**）        |
| `onAsk`               | `(ctx) => void`                            | 浮层"提问"（不传**不显示**）        |
| `onNote`              | `(ctx) => void`                            | 浮层"笔记"（不传**不显示**）        |
| `onExplain`           | `(ctx) => void`                            | 浮层"解释"（不传**不显示**）        |
| `getPage`             | `(n) => Promise<PageProxyLike>`            | 取页（宿主注入 pdf.js）             |
| `getPageSizes`        | `(n) => Promise<{width,height}[]>`         | 各页尺寸（pt）——影响跳页准确性      |
| `getDocInfo`          | `(data) => Promise<PdfDocInfo>`            | 文档信息（页数/元数据）             |
| `getOutline`          | `() => Promise<OutlineItemLike[] \| null>` | 目录                                |
| `pageRefToNumber`     | `(ref) => number \| null`                  | 页引用 → 页码（解析目录目标）       |
| `renderThumbnail`     | `(n, width) => Promise<string \| null>`    | 渲染缩略图（返回图片 URL）          |
| `searchEngine`        | `PdfSearch \| null`                        | 搜索引擎（core 实例）               |
| `onSelectionChange`   | `(s: SelectionData \| null) => void`       | 选区变化（**纯几何**）              |
| `onHighlightCreate`   | `(h: NewHighlight) => void`                | 新建高亮（宿主决定是否保存）        |
| `onPageChange`        | `(page, total) => void`                    | 当前页变化                          |
| `onZoomChange`        | `(scale) => void`                          | 缩放变化                            |
| `onExternalLink`      | `(url) => void`                            | 外部链接点击（宿主决定怎么开）      |
| `showPasswordDialog`  | `boolean`                                  | 用包内置密码框（加密文档）          |
| `initialScale`        | `'width' \| number`                        | 初始缩放（默认适配宽度）            |
| `locale` / `messages` | `'zh' \| 'en'` / `Partial<Messages>`       | 语言 / 文案覆盖                     |
| `theme`               | `PdfViewerTheme`（见下）                   | 主题（7 套）                        |
| `appearance`          | `PdfViewerAppearance`                      | 外观（密度 / 外壳 / 页阴影…）       |
| `printMode`           | `'with-highlights' \| 'original'`          | 打印模式（保留高亮 / 只打印原 PDF） |
| `toolbar`             | `ToolbarConfig`                            | 工具栏开关 + 左右 slots             |

完整清单见 `src/components/PdfViewer.tsx`。

## 能力清单

| 能力     | 说明                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 渲染     | pdf.js canvas 渲染，DPR 感知（cap 2），viewport 只读                             |
| 文本层   | 透明 DOM 文字层 → **文字可选中、可复制**（浏览器原生）                           |
| 精准选区 | **对齐 pdf.js 官方 `TextLayer`**：逐 item 定位 + `scaleX` 横向拉伸 + 实测 ascent |
| 虚拟化   | **几何法**可见页计算（缩放后立即重算，无白屏）+ 缓冲页                           |
| 缩放     | 比例**整十数** + **左上角锚点**（第一排文字不动）+ 适配宽度/整页                 |
| 自适应   | **适应宽度 / 适应页面**两种模式；容器尺寸变化（开面板、拖窗口）自动重适配        |
| 定位     | 页顶边数组 + 二分查找当前页；跳页**精确到像素**                                  |
| 选区     | **跨页选择** → 合并优化 → 输出归一化几何（缩放无关）                             |
| 高亮     | 受控渲染，宿主自存；"我的/他人"两种底色                                          |
| 导出     | **导出带高亮的 PDF**（真 PDF `/Highlight` 批注，pdf-lib 是可选依赖）             |
| 链接     | 透明可点区域 + **协议白名单过滤**（拦 `javascript:`）                            |
| 缩略图   | 懒生成 + 窗口化 + LRU 缓存（条数上限）+ **DPR 清晰、零错位**                     |
| 目录     | 树 → 扁平列表 + 折叠 + 层级                                                      |
| 搜索     | 懒建索引 + 分片让出主线程 + **命中在页面上高亮 + 精确跳转**                      |
| 密码     | 内置密码框，或宿主完全接管                                                       |
| 缓存     | IndexedDB 存字节 + 内存降级 + LRU                                                |
| 无障碍   | 键盘翻页/缩放、ARIA 标注、焦点样式                                               |

## 坐标三空间

- **PDF 点**（72dpi，原点左下，y 向上）——pdf.js 内部
- **归一化 0–1**（`NormRect`）——**持久化用，缩放无关**
- **视口 px**——渲染

选区与高亮都以归一化坐标存储 → 换设备、换缩放、换主题都不需要迁移数据。

## 高亮与选区的渲染（对齐 pdf.js + WPS）

### 文字层：逐 item + `scaleX`

- **一个 pdf.js text item 一个 span**（不按行合并）→ 每个字的位置都对得上
- **`scaleX = PDF 真实宽度 / 浏览器实测宽度`** → 内嵌字体与系统字体度量不同时也不偏
  （⚠️ **不能设 `width`**，否则 scaleX 会被二次缩放抵消）
- **`top = 基线 − 实测 ascent`**（canvas `measureText` 量出来的，不是字号）
- **`line-height: 0`** → 同行不同字号的 span 不再各自形成行盒 →
  `::selection` 背景**每处只涂一次**（否则叠涂出现阶梯状深浅不一）

### 高亮：正片叠底（`mix-blend-mode: multiply`）

高亮层在 DOM 里排在 `<canvas>` 之后（这样才能点）。
若背景不透明就会**完全遮住文字** →
`multiply` 让**黑字 × 高亮色 = 黑**，字清晰可见，背景被染色（荧光笔效果）。

`::selection` 同理 —— 否则半透明蓝盖在 canvas 的黑字上 → 蓝 + 黑 = 灰蓝 → 字发虚。

### 颜色可配（包的边界）

包**只负责把颜色渲染出来**；取色器 UI、语义、持久化 → **归宿主**。

```tsx
// 1) 高亮色板：语义 key → CSS 颜色
<PdfViewer
  highlights={highlights} // 每条的 color 存的是 key（如 'yellow' / 'h-123'）
  highlightPalette={{ yellow: '#ffd54a', 'h-123': '#ff6b6b' }}
/>;

// 2) 选区颜色：CSS 变量
// :root { --scpdf-selection-color: rgba(13, 104, 189, 0.24); }
```

包内置 6 色（`DEFAULT_HIGHLIGHT_PALETTE`），宿主可完全覆盖或扩展。

## 选区浮层

选中文字后出现的操作条（🖍 高亮 · 📋 复制 · 🌐 翻译 · 💬 提问 · 📝 笔记）。

### 定位（自研，不用 UI 库的 Popover）

- **`position: fixed` + 视口坐标** → 不需要 scroll 换算 → **天然不漂移**
  （对比：原 scholar-club 用 `getClientRects() + window.scrollY` 当文档坐标，
  而 PDF 在内部容器滚动 → 弹层不跟随、页面滚动时漂移）
- **实测弹层尺寸**（不猜宽度 200 / 高度 50）
- **真翻转**：先试下方 → 放不下再试上方
- **clamp** 到 PDF 容器的可视区
- **滚动时隐藏**（位置已失效）

### 动作可注入

```tsx
<PdfViewer
  // 内置动作：宿主传了回调才显示
  onTranslate={({ text }) => openTranslate(text)}
  onAsk={({ text }) => ask(text)}
  // 自定义动作（覆盖同名内置项 / 追加新项）
  selectionActions={[
    { key: 'summary', icon: 'explain', label: '总结', onSelect: ({ text }) => summarize(text) },
  ]}
/>;
```

**规则**：宿主不传 `onTranslate` → "翻译"按钮**不显示**。

### 关闭条件

`mousedown` 落浮层外 · `Esc` · 选区被清空 · 滚动 / 缩放 / 翻页。

## 错误码

12 个，统一 `PdfViewerError`（带 `code` / `message` / `cause` / `retryable`）：

| 分类   | code                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------ |
| 加载 7 | `E_LOAD_HTTP` `E_LOAD_NETWORK` `E_LOAD_TIMEOUT` `E_PDF_INVALID` `E_EMPTY` `E_PDF_ENCRYPTED` `E_PDF_PASSWORD_WRONG` |
| 渲染 2 | `E_RENDER_PAGE` `E_FONT_MISSING`                                                                                   |
| 缓存 2 | `E_CACHE_QUOTA` `E_CACHE_UNAVAILABLE`                                                                              |
| 交互 1 | `E_LINK_INVALID`                                                                                                   |

```ts
import { isRetryable } from '@scholar-club/pdf-viewer';

if (isRetryable(error)) showRetryButton();
```

## 主题与外观（三层分层）

### 第 1 层：主题（整体风格）

**7 套内置主题**，每一套都覆盖**全部** CSS 变量：

| 主题       | 说明                 |
| ---------- | -------------------- |
| `light`    | 亮色（默认）         |
| `dark`     | 暗色                 |
| `auto`     | 跟随系统             |
| `paper`    | 纸张（米黄护眼）     |
| `sepia`    | 护眼（棕褐）         |
| `contrast` | 高对比度（无障碍）   |
| `minimal`  | 极简黑白（打印友好） |

```tsx
<PdfViewer theme="paper" />;
```

### 第 2 层：外观（结构开关）

```tsx
<PdfViewer
  appearance={{
    density: 'compact', // 'compact' | 'cozy' | 'comfortable'
    chrome: 'full', // 'full' | 'minimal' | 'hidden'
    pageShadow: false, // 页阴影
    showSearch: false, // 隐藏搜索按钮
    showThumbnails: false,
    showOutline: false,
  }}
/>;
```

### 第 3 层：CSS 变量（像素微调）

覆盖变量即融入自家设计系统：

```css
:root {
  --scpdf-color-primary: #fa541c;
  --scpdf-highlight-my: #fff3bf;
}
```

完整清单见 `src/styles/viewer.css`（`:root` 下 15 个变量）
- `src/styles/themes.css`（7 套主题的完整覆盖）。

## 打印

包自带 `@media print` 样式，**打印时**：

- ✅ 工具栏 / 侧栏 / 浮层 / 选区块 / **文本层** 全部隐藏（只有 PDF 本身）
- ✅ 滚动容器被**摊平**（`overflow: visible`）→ 18 页全在，不是只有一屏
- ✅ 每页一张纸（`break-after: page`）+ 去掉页阴影（省墨）
- ✅ **高亮保留**（`print-color-adjust: exact`，否则浏览器会省掉背景色）

```tsx
<PdfViewer printMode="with-highlights" />  {/* 默认：带高亮 */}
<PdfViewer printMode="original" />          {/* 只打印原 PDF（不带高亮） */}
```

⚠️ **宿主自己的 UI 要自己写打印样式**（包只管包内部）。
⚠️ 宿主的 inline style 优先级更高 → 需要 `!important` 才能盖住。

## 缩放：适应宽度 vs 适应页面

工具栏上的两个按钮，**行为不一样**：

| 模式         | 缩放比例                                  | 效果                                        |
| ------------ | ----------------------------------------- | ------------------------------------------- |
| **适应宽度** | `(容器宽 - 32) / 页宽`                    | **页宽铺满容器**，高度溢出 → **要上下滚动** |
| **适应页面** | `min((容器宽-32)/页宽, (容器高-32)/页高)` | **整页都看得见**，一页不用滚                |

```
适应宽度            适应页面
┌──────────────┐   ┌──────────────┐
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   │              │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   │▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   │▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   │              │
└──────────────┘   └──────────────┘
  ↑ 宽度铺满          ↑ 整页可见
  高度溢出（滚动）      两边有留白
```

### 自动重适配（和 WPS 一致）

在**适应宽度 / 适应页面**模式下，**容器尺寸变了会自动重新适配**：

- 开 / 关缩略图面板、目录面板 → 容器变窄 → **自动缩放**（页宽重新铺满）
- 拖动浏览器窗口 → 同样自动重适配
- 用户**手动缩放**之后 → **不再自动覆盖**（用户的意图优先）

```tsx
<PdfViewer
  initialScale="width"   {/* 初始就是"适应宽度" */}
/>
```

⚠️ **手动缩放会解除自适应**（和 WPS / 浏览器的行为一致）。

## 导出带高亮的 PDF

把高亮写成**真正的 PDF 批注**（`/Subtype /Highlight`）——
Acrobat / Preview / Chrome / Edge 打开都能看到，**也能点开看原文**。

```tsx
import { exportHighlightedPdf } from '@scholar-club/pdf-viewer';

const bytes = await exportHighlightedPdf({
  pdfBytes, // 原始 PDF 的字节（宿主自己取）
  highlights, // 高亮列表（宿主自己存）
  pageSizesPt: viewerRef.current?.getPageSizesPt() ?? [],
});

// 下载（包也提供 downloadFile 这个纯 DOM 工具）
downloadFile(new Blob([bytes], { type: 'application/pdf' }), 'annotated.pdf');
```

### `pdf-lib` 是**可选依赖**

| 场景           | 要做什么                                     |
| -------------- | -------------------------------------------- |
| 不用导出       | **什么都不用装**（那段代码不会被打包进去）   |
| 要导出         | `npm i pdf-lib`（宿主装）                    |
| 想自己控制版本 | `exportHighlightedPdf({ pdfLib: myPdfLib })` |

⚠️ **包只管"算坐标 + 写批注"**：
取原始文件、触发下载、存高亮 —— **全是宿主的事** → **换后端不用改包**。

## 开发

```sh
pnpm install
pnpm verify        # 8 门禁：lint + typecheck + test + build + demo:typecheck + size + publint + attw
pnpm demo          # 启动 demo → http://127.0.0.1:5180（固定端口）
pnpm e2e:all      # 全部 E2E（需先 pnpm demo）
```

### 启动（固定端口 5180）

demo 的地址**永远是** <http://127.0.0.1:5180>。

| 方式       | 命令              | 地址                             |
| ---------- | ----------------- | -------------------------------- |
| 开发服务器 | `pnpm demo`       | <http://127.0.0.1:5180>          |
| 构建静态站 | `pnpm demo:build` | `demo/dist/`（用任意静态服务器） |

> **端口为什么固定**：`demo/vite.config.ts` 里 `server.port = 5180` +
> `strictPort: true`。
> `strictPort` 的作用是：端口被占用时**直接报错**，而不是像 Vite 默认那样
> **偷偷往后找一个**（5180 → 5181 → 5182 …）—— 那正是之前每次地址都不同的原因。
>
> 端口被占用时先关掉旧进程：
> ```sh
> # Windows
> netstat -ano | findstr :5180
> taskkill /PID <pid> /F
> ```

### E2E

所有 E2E 脚本共用 `scripts/e2e-base.mjs` 里的**同一个基址**
（默认 <http://127.0.0.1:5180>），**不需要手动设 `E2E_BASE_URL`**：

```sh
pnpm demo        # 另开一个终端起 demo
pnpm e2e:all     # 跑全部 16 套
pnpm e2e         # 只跑冒烟
```

E2E 脚本（16 套，181 项断言）：

| 脚本                    | 验证内容                                          |
| ----------------------- | ------------------------------------------------- |
| `e2e`                   | 渲染 / 缩放 / 跳页 / 页码                         |
| `e2e:text`              | 文本层渲染与对齐                                  |
| `e2e:panels`            | 缩略图 / 目录 / 搜索三个面板                      |
| `e2e:links`             | 链接层（XSS 过滤 / 位置 / 点击）                  |
| `e2e:selection`         | **选区精准度**（scaleX 生效 / 起点 Δ / 整页不丢） |
| `e2e:selection:stable`  | **选区稳定性**（跨页 + 缩放不崩 / 哨兵不搬家）    |
| `e2e:selection:popover` | **选区浮层**（定位 / 翻转 / clamp / 关闭 / 色板） |
| `e2e:selection:shape`   | **选区形状**（碎矩形合并 / 基线裁剪）             |
| `e2e:highlight`         | **高亮效果**（逐行对齐 Δ=0 / 不遮挡 / 样式）      |
| `e2e:zoom`              | **缩放**（整十比例 / 左上角锚点 / 无白屏）        |
| `e2e:search`            | **搜索高亮**（命中矩形 / 落在文字上 / 跳转）      |
| `e2e:thumbnail`         | **缩略图**（零错位 / DPR / 无变形）               |
| `e2e:all`               | 上面全部（汇总）                                  |

另外还有几个回归套件（也走同一个基址）：

| 脚本                       | 验证内容                                           |
| -------------------------- | -------------------------------------------------- |
| `e2e-selection-regression` | 跨行选区回归（Δtop / 高度比 / 缩放后仍对齐）       |
| `e2e-popover-anchor`       | 浮层锚定回归（缩放 / 滚动 / 拖动中）               |
| `e2e-selection-perf`       | 选区性能（满帧 / 浮层延迟）                        |
| `e2e-zoom-matrix`          | **全缩放矩阵**（6 档 × 选区 / 高亮 / 性能 / 浮层） |

本地放一份真实 PDF 到 `demo/public/samples/local.pdf` 即可用真实文档测（不入库）。

> ⚠️ 改了 `src/` 后要 `pnpm build` **并重启 demo** —— demo 消费 `dist/`，
> Vite 对 workspace 依赖的缓存会导致 E2E 跑到旧代码。

工作区布局：根 = 包本体；`demo/` = 消费者（Vite 8 + React 19，零 antd）。

## 路线图

- [x] 阶段 0：包骨架（构建 / 测试 / CI / 类型契约 / 样式 / demo）
- [x] 阶段 1：core（坐标换算 / 选区 / 缓存 / 加载 / 搜索 / 状态容器）
- [x] 阶段 2：React 层（hooks / 组件 / i18n / 真实 PDF 联调 / E2E）
- [x] 阶段 4：P1 增强（文本层 / 缩略图 / 目录 / 搜索面板 / 链接层 / 密码框）
- [x] 阶段 5：发布基建（体积门禁 / publint / attw / changesets / CI 双 job）
- [ ] 阶段 3：主项目集成（按需进行）

## License

MIT
