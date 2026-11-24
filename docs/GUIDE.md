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
- [7. 自定义工具栏](#7-自定义工具栏)
- [8. RTL（从右往左）](#8-rtl从右往左)
- [9. 多语言](#9-多语言)
- [10. 主题与外观](#10-主题与外观)
- [11. 打印](#11-打印)
- [12. 缩放](#12-缩放)
- [13. 导出带高亮的 PDF](#13-导出带高亮的-pdf)
- [14. 加密文档](#14-加密文档)
- [15. 错误处理](#15-错误处理)
- [16. 性能与缓存](#16-性能与缓存)
- [17. 常见问题](#17-常见问题)

---

## 1. 30 秒接入

**1. 装依赖**

```bash
pnpm add @scholar-club/pdf-viewer
# 可选：导出带高亮的 PDF
pnpm add pdf-lib
```

**2. 引样式**（**必做**，否则布局全乱）

```tsx
import '@scholar-club/pdf-viewer/styles.css';
import '@scholar-club/pdf-viewer/themes.css'; // 可选
```

**3. 用起来**

```tsx
import { PdfViewer } from '@scholar-club/pdf-viewer';

export function Reader({ url }: { url: string }) {
  return (
    <div style={{ height: '100vh' }}>
      <PdfViewer file={url} />
    </div>
  );
}
```

> ⚠️ **容器必须有高度**。包会填满父容器；父容器高度是 0 → 什么都看不见。

---

## 2. 完整接线示例

一个真实的"论文阅读器"宿主：

```tsx
import { useCallback, useRef, useState } from 'react';
import {
  PdfViewer,
  type PdfViewerHandle,
  type HighlightRecord,
  type NewHighlight,
  type AnnotationRecord,
} from '@scholar-club/pdf-viewer';
import '@scholar-club/pdf-viewer/styles.css';
import '@scholar-club/pdf-viewer/themes.css';

export function PaperReader({ paperId, fileUrl }: Props) {
  const viewerRef = useRef<PdfViewerHandle>(null);
  const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
  const [annotations, setAnnotations] = useState<AnnotationRecord[]>([]);

  // 保存高亮
  const handleHighlight = useCallback((ctx: any) => {
    const id = `hl_${Date.now()}`;
    setHighlights((prev) => [
      ...prev,
      {
        id,
        selectedText: ctx.text, // ⚠️ 字段叫 selectedText，不是 text
        position: ctx.position,
        color: ctx.color ?? 'my-1',
      },
      },
    ]);
    return id; // ← 返回 id，批注可以挂上去
  }, []);

  return (
    <PdfViewer
      ref={viewerRef}
      file={fileUrl}
      documentId={paperId}
      initialPage={1}
      initialScale="width"
      // 数据（受控）
      highlights={highlights}
      stickyNotes={annotations}
      // 行为
      onHighlight={handleHighlight}
      onAnnotationSave={(id, html) =>
        setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, content: html } : a)))
      }
      onAnnotationCreate={(id, html, _plain, highlightId, text) =>
        setAnnotations((prev) => [
          ...prev,
          { id, content: html, highlightId, pageNumber: undefined, createdAt: Date.now() },
        ])
      }
      onAnnotationDelete={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
      // 链接
      onExternalLink={(url) => window.open(url, '_blank', 'noopener')}
      /*
       * ⚠️ **包自己跳** -> 这里只被"通知"，**不要再调 goToPage**（会跳两次）。
       * -> ctx.targetPage = 目标页（不是链接所在页）
       * -> 想自己接管 -> 调 ctx.cancel()
       */
      onInternalLink={(ctx) => {
        console.log('跳到第', ctx.targetPage, '页');
      }}
      // 错误
      onError={(error) => console.error(error.code, error.message)}
    />
  );
}
```

---

## 3. 三条消费契约

宿主和包之间只有三条约定：

| 契约     | 包负责             | 宿主负责                                |
| -------- | ------------------ | --------------------------------------- |
| **渲染** | 加载 / 渲染 / 定位 | 提供 pdf.js 的 `getPage` / `getDocInfo` |
| **数据** | 渲染高亮和批注     | **存储**它们（存数据库 / 后端）         |
| **动作** | 抛事件（`onXxx`）  | **执行**动作（翻译 / 提问 / 保存）      |

> 💡 **包不碰你的后端**。换后端不用改包。

---

## 4. 加载文档

### `file` 支持什么

```ts
type DocumentSource = string | Blob | ArrayBuffer | Uint8Array;
```

### ⚠️ `documentId` 必须变

```tsx
// ❌ 换文档但 documentId 没变 -> 不会重新加载
<PdfViewer file={urlA} documentId="doc" />
<PdfViewer file={urlB} documentId="doc" />

// ✅ documentId 跟着变
<PdfViewer file={urlB} documentId={`doc_${paperId}`} />
```

### HTTP 请求带认证

```tsx
<PdfViewer
  file="/api/papers/123/content"
  loadOptions={{ headers: { Authorization: `Bearer ${token}` } }}
/>;
```

---

## 5. 高亮：从选区到持久化

### 完整链路

```
用户拖选文字
  → 包算出归一化坐标
  → 弹选区浮层
  → 用户点"高亮"
  → 调 onHighlight(ctx)
  → 宿主存起来
  → 传给 highlights prop
  → 包重新渲染
```

### ⚠️ 必须存归一化坐标

```ts
interface NormPosition {
  boundingRect: NormRect; // { x1, y1, x2, y2, width, height, pageNumber }
  rects: NormRect[]; // 每行一个
  pageNumber: number;
}
```

> 💡 **0~1 的相对位置** → 换缩放、换设备、换 PDF 大小，落点都对。
> 如果你存的是像素坐标，用户换个缩放高亮就飘了。

### ⚠️ `onHighlight` 和 `onHighlightCreate` 别都调

| 你想干嘛             | 用哪个                                         |
| -------------------- | ---------------------------------------------- |
| 用包的浮层"高亮"按钮 | **`onHighlight`**（可返回 id）                 |
| 宿主自己实现高亮按钮 | **`onHighlightCreate`** + `onHighlightCreated` |

```tsx
// ❌ 两个都传 -> 保存两次
onHighlight={save} onHighlightCreate={save}

// ✅ 二选一
onHighlight={save}
```

---

## 6. 批注

### 三个入口，三个回调（**别漏传**）

| 入口       | 触发                | 必须传的回调                                                             | 不传会怎样                |
| ---------- | ------------------- | ------------------------------------------------------------------------ | ------------------------- |
| 写新批注   | 选区浮层 → "加批注" | `onAnnotationCreate(id, html, plain, highlightId, text)`                 | 没有新批注                |
| 看详情     | 便签 → "展开"       | `onAnnotationExpand(annotation)` + `onAnnotationChange(id, html, plain)` | 没有"展开"按钮 / 详情只读 |
| 改已有批注 | 便签 → "编辑"       | `onAnnotationEdit(annotation, element?)`                                 | 没有"编辑"按钮            |

> ⚠️ **`onAnnotationExpand` 不传 → 便签上不渲染"展开"按钮** —— 用户会以为"按钮坏了"。
> ⚠️ **`onAnnotationChange` 不传 → 详情面板**永远是只读**（"编辑"按钮点不动）。

### 便签详情的流程

```
hover 便签 → 点"展开"
   ↓
【详情面板】只读（富文本渲染，贴着便签显示）
   ├─ 点"编辑" → **就地变成编辑器**（按钮变"完成"）→ `onAnnotationChange` 实时回调
   ├─ 点"删除" → `onAnnotationDelete(id)`
   └─ 点"✕"    → 关闭
```

-> 同一行有多条批注 -> 自动**合并成一个图标**（带角标）✅
-> hover 那个图标 -> 弹出**选择列表** -> 点某项 -> **打开那一条的详情** ✅
-> 列表在右边放不下 -> **自动翻到左边** ✅

### 工具栏的三个新能力（第 27 轮）

#### 主题（🎨）

-> 包**内置 7 个主题**，宿主传 `onThemeChange` 就能在工具栏里切 ✅
-> 不传 -> **不显示按钮** ✅
-> 详见 `docs/API.md` ✅

#### 缩放比例可以**填写**

-> 工具栏的比例**点一下就能填**（回车生效，Esc 放弃）✅
-> 上下限（`minScale` / `maxScale`）和**能不能填**（`allowScaleInput`）宿主可配 ✅

#### 高亮不用每次都选颜色

-> 点 **🖍** = **直接用当前色**高亮 ✅
-> 点 **▾** = 展开颜色下拉 ✅
-> 当前色 = 上次选的 / **`defaultHighlightColor`**（宿主可配）✅

### ⚠️ **打印时不会泄露批注内容**

-> 用户反馈："导出带高亮的pdf的时候 如果悬浮在pdf上
-> 会有黄色框的便签展示出高亮pdf的内容 不要这个"✅
-> **打印时**（浏览器的"打印"）-> 便签 / 详情面板 / 弹窗**全部藏起来** ✅
-> 否则**批注正文会被打印出去**（隐私泄露）❌✅
-> ⚠️ **"导出 PDF"是另一条路** -> 走**真 PDF 批注** -> 本来就没有这个问题 ✅

### ⚠️ HTML 已经消毒过

```tsx
onAnnotationSave={(id, html, plain) => {
  // ⚠️ html 已经过 sanitizeRichText 清洗（防 XSS）
  // 但你存进数据库前，最好**再过一次**（防御纵深）
  save({ id, html: sanitizeRichText(html), plain });
}}
```

### 换掉编辑器（用 TipTap）

```tsx
import { AnnotationDialog } from '@scholar-club/pdf-viewer/dialog';
import { TipTapEditor } from '@scholar-club/pdf-viewer/editor';

<PdfViewer
  annotationEditor={TipTapEditor}
  // ...
/>;
```

> ⚠️ 需要装 `@tiptap/*`（可选 peer 依赖）。

---

## 7. 自定义工具栏

### 7.1 只想加两个按钮（**用 `leftSlot` / `rightSlot`**）

```tsx
<PdfViewer
  toolbar={{
    leftSlot: <MySaveButton />,
    rightSlot: <MyShareButton />,
  }}
/>;
```

> 💡 **不用整个替换** —— 内置的翻页 / 缩放 / 搜索都还在。

### 7.2 整个替换（`slots.toolbar`）

```tsx
<PdfViewer
  ref={viewerRef}
  slots={{
    toolbar: (
      <MyToolbar
        onZoomIn={() => viewerRef.current?.zoomIn()}
        onZoomOut={() => viewerRef.current?.zoomOut()}
        onFitWidth={() => viewerRef.current?.fitWidth()}
        onPrint={() => viewerRef.current?.print()}
        onGoToPage={(p) => viewerRef.current?.goToPage(p)}
      />
    ),
  }}
/>;
```

> ⚠️ 替换之后 **缩放 / 打印要靠 `viewerRef` 驱动**（内置按钮没了）。

### 7.3 关掉某些内置按钮

```tsx
<PdfViewer toolbar={{ showSearch: false, showThumbnails: false }} />;
```

### 7.4 关掉某些功能

```tsx
<PdfViewer features={{ print: false, outline: false }} />;
```

---

## 8. RTL（从右往左）

```tsx
// 显式指定
<PdfViewer dir="rtl" locale="ar" />

// 或者**自动判断**（locale 是阿拉伯语 / 希伯来语 -> 自动 rtl）
<PdfViewer locale="ar" />
```

### 自动判断顺序

```
1. 显式 `dir` prop      <- 最高
2. `locale` 是 RTL 语言（ar / he / fa / ur …）
3. 宿主页面的 `document.dir`
4. `ltr`（兜底）
```

> ⚠️ **`locale` 优先于页面的 `dir`**：
> 宿主页面是 `dir="rtl"`（阿拉伯语站点）但组件 `locale="en"` ->
> 组件**保持 LTR**（英文按钮不该反）✅

### 镜像了什么

| 部位             | 处理                                                 |
| ---------------- | ---------------------------------------------------- |
| 文字方向         | 根节点 `dir="rtl"` -> **浏览器自己处理** ✅          |
| 工具栏 / 侧栏    | CSS 镜像 ✅                                          |
| **翻页箭头**     | **单独翻转**（`scaleX(-1)`）-> RTL 里"下一页"朝左 ✅ |
| **PDF 页面本身** | **不镜像**（PDF 的内容方向是它自己的事）✅           |

---

## 9. 多语言

### 切换语言

```tsx
const [locale, setLocale] = useState<Locale>('zh');

<PdfViewer locale={locale} />;
```

### 加一个新语言（西班牙语）

```tsx
const es = {
  'load.loading': 'Cargando…',
  'load.retry': 'Reintentar',
  'page.of': '{page} de {total}',
  // 不用写全 -> 缺的自动回退到内置
};

<PdfViewer locale="es" locales={{ es }} />;
```

### 覆盖一两个句子

> ⚠️ **`messages` 是【按语言绑定】的**（和 `locales` 同一个概念）。
>
> -> 之前是 `messages={{ 'load.loading': '…' }}`（**不绑语言**）❌
>   -> 那些句子在**任何语言**下都生效 -> 切语言还是中文 -> **中英文混杂** ❌
> -> 现在：`messages={{ zh: { … } }}` ✅ -> **换语言只影响对应语言的那份** ✅

```tsx
<PdfViewer locale="zh" messages={{ zh: { 'load.loading': '正在打开…' } }} />;
```

### 自定义按钮也要能翻译

```tsx
const toolbar = [{ command: 'bold' as const, label: '{my.bold}', icon: 'bold' as const }];

<PdfViewer annotationToolbar={toolbar} messages={{ zh: { 'my.bold': '加粗' } }} />;
```

> ⚠️ **宿主自己的 UI 也要自己接 `locale`**（包的 i18n 只管包里的文字）。
> -> demo 里演示了正确的做法（见 `demo/src/demo-i18n.ts`）✅

> 💡 `label` 写 `{xxx.yyy}` 形式 → 包会拿 `xxx.yyy` 去查文案表。

---

## 9.5 富文本的两个色板

### 为什么分成两个

| 色板                    | 用途         | 内置值                                    |
| ----------------------- | ------------ | ----------------------------------------- |
| `annotationPalette`     | **高亮底色** | **浅色**（`#fff3a3` 黄 / `#c8e6c9` 绿 …） |
| `annotationTextPalette` | **文字颜色** | **深色**（`#c62828` 红 / `#1565c0` 蓝 …） |

-> 之前只有**一个**色板（浅色）❌
-> 拿来当**文字颜色** -> **浅得看不见** ❌
-> 所以**文字颜色必须用深色板** ✅

### 工具栏里的三个颜色命令

| 命令            | 效果                     | 用哪个色板              |
| --------------- | ------------------------ | ----------------------- |
| `hiliteColor`   | 高亮底色（**浅色背景**） | `annotationPalette`     |
| `textHighlight` | 文字高亮（**字色不变**） | `annotationPalette`     |
| `foreColor`     | 文字颜色（**字色**）     | `annotationTextPalette` |

-> `textHighlight` **只加背景色，字色完全不变** ✅（WPS 的"突出显示"）

### 换掉色板

```tsx
<PdfViewer
  annotationPalette={{ yellow: '#ffe082', green: '#a5d6a7' }}
  annotationTextPalette={{ red: '#b71c1c', blue: '#0d47a1' }}
/>;
```

-> 不传也有内置的 ✅
-> 传了**覆盖**内置 ✅

---

## 10. 主题与外观

### 四层定制（从粗到细）

| 层  | 手段                                  | 适合                 |
| --- | ------------------------------------- | -------------------- |
| 1   | `theme="dark"`                        | 整体风格             |
| 2   | `appearance={{ density: 'compact' }}` | 密度 / 外壳 / 页阴影 |
| 3   | CSS 变量                              | 像素微调             |
| 4   | `slots`                               | 完全自定义           |

### 常用 `appearance` 字段

```tsx
<PdfViewer
  appearance={{
    density: 'compact', // 'compact' | 'cozy' | 'comfortable'
    chrome: 'full', // 'full' | 'minimal' | 'hidden'
    pageShadow: true, // 页阴影
    pageRadius: 4, // 页圆角（px）
    showPageNumber: true, // 页脚页码
    showOutline: true, // 目录侧栏
    showThumbnails: true, // 缩略图侧栏
    showSearch: true, // 搜索面板
    accentColor: '#fa541c', // 强调色
    fontFamily: 'Inter, sans-serif',
    fontSize: 14,
  }}
/>;
```

> 💡 `appearance.showOutline` / `showThumbnails` / `showSearch` 是**上层开关**，
> **优先级高于** `toolbar.showOutline` 等 —— 宿主用 `appearance` 统一控制，
> 用 `toolbar` 做细调 ✅

### CSS 变量

```css
:root {
  --scpdf-color-primary: #fa541c;
  --scpdf-toolbar-height: 48px;
}
```

---

## 11. 打印

### 两种模式

```tsx
<PdfViewer printMode="with-highlights" />  // 默认：打印带高亮
<PdfViewer printMode="original" />         // 只打印原 PDF
```

### 打印按钮

```tsx
<PdfViewer features={{ print: true }} />; // 默认就是 true
```

> ✅ 打印按钮和缩放按钮**互相独立** —— `toolbar={{ showZoom: false }}` **不会**隐藏打印按钮。

### 打印纸张

```tsx
// 内置：A4 / A3 / Letter / Legal
<PdfViewer printPaper="Letter" />

// 自定义（mm）
<PdfViewer printPaper={{ width: 210, height: 297 }} />

// 边距（mm，部分覆盖；默认四边 12mm）
<PdfViewer printMargin={{ top: 20, bottom: 20 }} />
```

> ✅ 也可以写进 `config`：`config={{ printPaper: 'Letter' }}`（prop 优先）。

---

## 12. 缩放

### 三种方式

```tsx
viewerRef.current?.zoomIn(); // 放大（就近取整到 10%）
viewerRef.current?.zoomOut(); // 缩小
viewerRef.current?.fitWidth(); // 适应宽度
viewerRef.current?.fitPage(); // 适应整页
```

### Ctrl + 滚轮

按住 **Ctrl**（macOS 是 **Cmd**）滚轮即可缩放 —— 和所有 PDF 阅读器一致。
不按 Ctrl → 正常滚动页面。

### ⚠️ 手动缩放会解除"自适应"

和 WPS / 浏览器行为一致：用户手动调过比例后，容器变窄**不会**强行重新适配。

---

## 13. 导出带高亮的 PDF

把高亮写成**真正的 PDF 批注**（`/Subtype /Highlight`）——
Acrobat / Preview / Chrome / Edge 打开都能看到，**也能点开看原文**。

```tsx
import { exportHighlightedPdf } from '@scholar-club/pdf-viewer';

const bytes = await exportHighlightedPdf({
  pdfBytes, // 原始 PDF 字节（宿主自己取）
  highlights, // 高亮列表
  pageSizesPt: viewerRef.current?.getPageSizesPt() ?? [],
});

// 下载
const blob = new Blob([bytes], { type: 'application/pdf' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'annotated.pdf';
a.click();
URL.revokeObjectURL(url);
```

> ⚠️ 需要装 **`pdf-lib`**（可选 peer 依赖）。没装会给出明确报错。

---

## 14. 加密文档

### 用包内置的密码框（最简单）

```tsx
<PdfViewer file={url} showPasswordDialog />;
```

### 宿主自己接管

```tsx
<PdfViewer
  file={url}
  onRequestPassword={({ retry, cancel }) => {
    const pw = window.prompt('请输入密码');
    if (pw) retry(pw);
    else cancel();
  }}
/>;
```

---

## 15. 错误处理

```tsx
<PdfViewer
  onError={(error) => {
    console.error(error.code); // 'E_LOAD_NETWORK'
    console.error(error.message); // 可直接展示的文案
    console.error(error.retryable); // 重试有没有意义

    if (error.retryable) {
      showRetryButton(() => reload());
    }
  }}
/>;
```

> 💡 包内置的错误界面**已经**按 `retryable` 判断要不要显示「重试」按钮
> （"文件不是 PDF"不会给无意义的重试）。

### 搜索引擎

```tsx
<PdfViewer searchEngine={myPdfSearch} />;
```

> ⚠️⚠️ **关键坑**：建索引用的 `getTextContent()` **必须和渲染用的是同一个**！
>
> -> 不一样 -> **所有命中的高亮位置全错** ❌
> -> 原因：搜索靠字符偏移定位，渲染的偏移和索引的偏移对不上 -> 命中位置漂移 ❌
>
> ```ts
> // ⚠️ 索引和渲染要用同一个 page proxy
> const page = await doc.getPage(n);
> await search.indexPage(n, await page.getTextContent());
> // 渲染时也是这一份
> <PdfViewer getPage={async (n) => { await doc.getPage(n); }} />
> ```

---

## 16. 性能与缓存

### 内存缓存（默认）

```tsx
<PdfViewer file={url} documentId="paper-1" />;
```

### 用 IndexedDB 缓存（`idb`）

```ts
import { DocumentCache } from '@scholar-club/pdf-viewer/core';

const cache = new DocumentCache({
  dbName: 'my-pdf-cache',   // IndexedDB 的库名
  maxBytes: 200 * 1024 * 1024, // 200MB 上限（超出按 LRU 淘汰）
  memoryOnly: false,       // true = 只用内存（不落盘）
});

await cache.init();  // ⚠️ 要先 init（失败会自动降级为内存）

<PdfViewer file={url} documentId="paper-1" cache={cache} />
```

> 💡 `DocumentCache` 底层是 **IndexedDB**，失败**自动降级为内存**（不会崩）。
> 只会暴露 5 个动作：`get` / `set` / `remove` / `clear` / `stats` —— 不暴露 IDB 细节。

### 性能建议

- ✅ 传 `getPageSizes`（跳页才准）
- ✅ 用 `documentId` 复用缓存
- ✅ 高亮用归一化坐标（渲染快）
- ❌ 别在 `onHighlight` 里做同步的重活（会卡渲染）

---

## 17. 常见问题

<details>
<summary><b>页面空白 / 什么都看不见</b></summary>

1. 容器**没有高度** → 包填满父容器，父容器 0 高就是 0 高
2. **忘了引样式** → `import '@scholar-club/pdf-viewer/styles.css'`
</details>

<details>
<summary><b>跳页不准 / 滚动条长度不对</b></summary>

没传 `getPageSizes` → 包用 A4 兜底 → 不同尺寸的 PDF 就偏。
**传上它**。
</details>

<details>
<summary><b>换了文档但没重新加载</b></summary>

`documentId` 没变。**换文档时一定要改 `documentId`**。
</details>

<details>
<summary><b>高亮位置飘了 / 换个缩放就错位</b></summary>

存了像素坐标而不是**归一化坐标**。用 `ctx.position`（`NormPosition`）。
</details>

<details>
<summary><b>点一次高亮存了三条</b></summary>

`onHighlight` 和 `onHighlightCreate` 都传了。**二选一**。
</details>

<details>
<summary><b>"翻译"按钮不显示</b></summary>

这是**故意的**：宿主没实现 → 不渲染。传 `onTranslate` 就有。
</details>

<details>
<summary><b>选区蓝色块一直浮着 / 取消不了</b></summary>

宿主自己实现了高亮按钮但没通知包。调 `viewerRef.current.createHighlight(hl)`
或配 `onHighlightCreated`。
</details>

---

**← 返回 [README](../README.md) · [API 参考](./API.md) · [扩展开发](./EXTENDING.md)**
