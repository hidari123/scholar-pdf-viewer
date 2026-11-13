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
主入口 11.74 kB（tree-shaken） · core 子路径 1.15 kB · CSS 11.7 kB
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

| prop                  | 类型                                       | 说明                           |
| --------------------- | ------------------------------------------ | ------------------------------ |
| `file`                | `string \| Blob \| ArrayBuffer \| null`    | 文档来源（唯一必填）           |
| `highlights`          | `HighlightRecord[]`                        | 受控高亮                       |
| `getPage`             | `(n) => Promise<PageProxyLike>`            | 取页（宿主注入 pdf.js）        |
| `getPageSizes`        | `(n) => Promise<{width,height}[]>`         | 各页尺寸（pt）——影响跳页准确性 |
| `getDocInfo`          | `(data) => Promise<PdfDocInfo>`            | 文档信息（页数/元数据）        |
| `getOutline`          | `() => Promise<OutlineItemLike[] \| null>` | 目录                           |
| `pageRefToNumber`     | `(ref) => number \| null`                  | 页引用 → 页码（解析目录目标）  |
| `renderThumbnail`     | `(n, width) => Promise<string \| null>`    | 渲染缩略图（返回图片 URL）     |
| `searchEngine`        | `PdfSearch \| null`                        | 搜索引擎（core 实例）          |
| `onSelectionChange`   | `(s: SelectionData \| null) => void`       | 选区变化（**纯几何**）         |
| `onHighlightCreate`   | `(h: NewHighlight) => void`                | 新建高亮（宿主决定是否保存）   |
| `onPageChange`        | `(page, total) => void`                    | 当前页变化                     |
| `onZoomChange`        | `(scale) => void`                          | 缩放变化                       |
| `onExternalLink`      | `(url) => void`                            | 外部链接点击（宿主决定怎么开） |
| `showPasswordDialog`  | `boolean`                                  | 用包内置密码框（加密文档）     |
| `initialScale`        | `'width' \| number`                        | 初始缩放（默认适配宽度）       |
| `locale` / `messages` | `'zh' \| 'en'` / `Partial<Messages>`       | 语言 / 文案覆盖                |
| `theme`               | `'light' \| 'dark' \| 'auto'`              | 主题                           |
| `toolbar`             | `ToolbarConfig`                            | 工具栏开关 + 左右 slots        |

完整清单见 `src/components/PdfViewer.tsx`。

## 能力清单

| 能力   | 说明                                                        |
| ------ | ----------------------------------------------------------- |
| 渲染   | pdf.js canvas 渲染，DPR 感知（cap 2），viewport 只读        |
| 文本层 | 透明 DOM 文字层 → **文字可选中、可复制**（浏览器原生）      |
| 虚拟化 | IntersectionObserver + 缓冲页 → 100 页文档首屏只渲染 3–7 页 |
| 缩放   | 步进缩放 + **锚点保持**（缩放不跳动）+ 适配宽度/整页        |
| 定位   | 页顶边数组 + 二分查找当前页；跳页**精确到像素**             |
| 选区   | 跨页选择 → 合并优化 → 输出归一化几何（缩放无关）            |
| 高亮   | 受控渲染，宿主自存；"我的/他人"两种底色                     |
| 链接   | 透明可点区域 + **协议白名单过滤**（拦 `javascript:`）       |
| 缩略图 | 懒生成 + 窗口化 + LRU 缓存（条数上限）                      |
| 目录   | 树 → 扁平列表 + 折叠 + 层级                                 |
| 搜索   | 懒建索引 + 分片让出主线程 + 命中上限                        |
| 密码   | 内置密码框，或宿主完全接管                                  |
| 缓存   | IndexedDB 存字节 + 内存降级 + LRU                           |
| 无障碍 | 键盘翻页/缩放、ARIA 标注、焦点样式                          |

## 坐标三空间

- **PDF 点**（72dpi，原点左下，y 向上）——pdf.js 内部
- **归一化 0–1**（`NormRect`）——**持久化用，缩放无关**
- **视口 px**——渲染

选区与高亮都以归一化坐标存储 → 换设备、换缩放、换主题都不需要迁移数据。

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

## 主题（CSS 变量）

覆盖变量即融入自家设计系统：

```css
:root {
  --scpdf-color-primary: #fa541c;
  --scpdf-highlight-my: #fff3bf;
}
```

完整清单见 `src/styles/viewer.css`（`:root` 下 15 个变量 + 暗色主题覆盖）。

## 开发

```sh
pnpm install
pnpm verify        # 8 门禁：lint + typecheck + test + build + demo:typecheck + size + publint + attw
pnpm demo          # 启动 demo（消费 dist 产物，真实消费者路径）
pnpm e2e           # E2E（需先 pnpm e2e:serve）
```

E2E 脚本：`e2e`（渲染/缩放/跳页）· `e2e:text`（文本层）· `e2e:panels`（三个面板）· `e2e:links`（链接层）。

本地放一份真实 PDF 到 `demo/public/samples/local.pdf` 即可用真实文档测（不入库）。

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
