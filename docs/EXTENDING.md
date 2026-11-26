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
- [7. 换主题 / 做品牌色](#7-换主题-做品牌色)
- [8. 换富文本编辑器](#8-换富文本编辑器)
- [9. 自定义批注渲染](#9-自定义批注渲染)
- [10. 接管 Toast](#10-接管-toast)
- [11. 接管密码输入](#11-接管密码输入)
- [12. 注入自己的 pdf.js](#12-注入自己的-pdfjs)
- [13. 用 core 层的纯逻辑](#13-用-core-层的纯逻辑)
- [14. 包的边界（什么不要往里塞）](#14-包的边界什么不要往里塞)

---

## 1. 扩展地图

| 想做什么                 | 用什么                           | 难度   |
| ------------------------ | -------------------------------- | ------ |
| 工具栏**加**按钮         | `toolbar.leftSlot` / `rightSlot` | ⭐     |
| 工具栏**整个换**         | `slots.toolbar` + `viewerRef`    | ⭐⭐   |
| 选区浮层**加**动作       | `selectionActions`               | ⭐     |
| 选区浮层**覆盖**内置动作 | `selectionActions`（同 key）     | ⭐     |
| 加**一种语言**           | `locales`                        | ⭐     |
| 覆盖**一两句**文案       | `messages`                       | ⭐     |
| 换**图标**               | `icons`                          | ⭐     |
| 做**品牌主题**           | `theme` + CSS 变量               | ⭐⭐   |
| 换**富文本编辑器**       | `annotationEditor`               | ⭐⭐⭐ |
| 自定义**批注样式**       | CSS 变量 + `slots`               | ⭐⭐   |
| 接管 **Toast**           | `onToast`                        | ⭐     |
| 接管**密码输入**         | `onRequestPassword`              | ⭐     |
| 自带 **pdf.js**          | `getPage` / `getDocInfo` …       | ⭐⭐   |

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

<PdfViewer toolbar={{ rightSlot: <MyToolbarExtras /> }} />;
```

> 💡 插槽在工具栏的**两端**，中间的内置按钮都还在。

### 方式 B：整个替换（要完全控制布局时）

```tsx
const viewerRef = useRef<PdfViewerHandle>(null);

function MyToolbar() {
  const [page, setPage] = useState(1);
  return (
    <div className="my-toolbar">
      <button onClick={() => viewerRef.current?.goToPage(page - 1)}>‹</button>
      <input
        value={page}
        onChange={(e) => setPage(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') viewerRef.current?.goToPage(page);
        }}
      />
      <button onClick={() => viewerRef.current?.goToPage(page + 1)}>›</button>

      <button onClick={() => viewerRef.current?.zoomOut()}>−</button>
      <button onClick={() => viewerRef.current?.zoomIn()}>+</button>
      <button onClick={() => viewerRef.current?.fitWidth()}>适应宽度</button>
      <button onClick={() => viewerRef.current?.print()}>打印</button>
    </div>
  );
}

<PdfViewer ref={viewerRef} slots={{ toolbar: <MyToolbar /> }} />;
```

> ⚠️ 替换之后：**页码状态要自己同步**。
> 用 `onPageChange` 拿当前页：
> ```tsx
> <PdfViewer onPageChange={(p) => setPage(p)} />
> ```

---

## 3. 加一个选区动作

浮层里加一个"查文献"按钮：

```tsx
import type { SelectionAction } from '@scholar-space/pdf-viewer';

const actions: SelectionAction[] = [
  {
    key: 'lookup',
    icon: 'search',
    label: '查文献',
    order: 10,
    onSelect: (ctx) => {
      searchLiterature(ctx.text);
    },
  },
];

<PdfViewer selectionActions={actions} />;
```

### 带条件显示（只在选中英文时出现）

```tsx
{
  key: 'translate',
  icon: 'translate',
  label: '翻译',
  when: (ctx) => /[a-zA-Z]/.test(ctx.text),
  onSelect: (ctx) => translate(ctx.text),
}
```

### ⚠️ `label` 建议走 i18n

```tsx
{
  key: 'lookup',
  icon: 'search',
  label: '{my.lookup}',    // ← 占位符
  onSelect: ...,
}

// 配套
<PdfViewer messages={{ 'my.lookup': '查文献' }} />
```

---

## 4. 覆盖内置动作

**用同样的 `key`**：

```tsx
const actions: SelectionAction[] = [
  {
    key: 'copy', // ← 覆盖内置的"复制"
    icon: 'copy',
    label: '复制到笔记',
    onSelect: (ctx) => {
      myApp.copyToNotes(ctx.text);
      // 想让包清选区 -> 调 ctx.done?.()
      ctx.done?.();
    },
  },
];

<PdfViewer selectionActions={actions} />;
```

**内置 key**：`highlight` `copy` `translate` `note` `ask` `explain` `delete`

> 💡 不传 `onCopy` 也可以 —— 传了 `selectionActions` 里的 `copy` 会**优先**。

---

## 5. 加一种语言

```tsx
const locales = {
  de: {
    'load.loading': 'Wird geladen…',
    'load.retry': 'Erneut versuchen',
    'empty.title': 'Kein Dokument',
    'page.of': '{page} von {total}',
    // ⚠️ 不用写全 -> 缺的自动回退到内置英文
  },
};

<PdfViewer locale="de" locales={locales} />;
```

### ⚠️ `locales` vs `messages`

|            | 用途                       | 例子                      |
| ---------- | -------------------------- | ------------------------- |
| `locales`  | **加一整个语言**           | `{ de: { ...95 条 } }`    |
| `messages` | **覆盖当前语言的个别句子** | `{ 'load.loading': '…' }` |

> ⚠️ **两个都传**时，`messages` 优先级更高（回退链：`messages` → `locales[locale]` → 内置 → 英文）。

---

## 6. 换图标

### 逐个覆盖

```tsx
import { Download, Upload, Search } from 'lucide-react';

<PdfViewer
  icons={{
    download: <Download size={16} />,
    upload: <Upload size={16} />,
    search: <Search size={16} />,
  }}
/>;
```

### 用包自带的图标集（不引第三方库）

```tsx
import { Icon } from '@scholar-space/pdf-viewer/icons';

<Icon name="download" size={16} />;
```

**全部 54 个图标名**见 [API §9](./API.md#9-图标)。

> 💡 换图标不影响包体积 —— 宿主引的库不进包的 bundle。

---

## 7. 换主题 / 做品牌色

### 用内置主题

```tsx
<PdfViewer theme="sepia" />; // light dark auto paper sepia contrast minimal
```

### 做自己的品牌主题（CSS 变量）

```css
:root {
  /* 主色 */
  --scpdf-color-primary: #fa541c;
  --scpdf-color-primary-hover: #e64310;

  /* 文字 */
  --scpdf-text-primary: #1f2329;
  --scpdf-text-secondary: #646a73;

  /* 背景 */
  --scpdf-bg-page: #ffffff;
  --scpdf-bg-toolbar: #f7f8fa;

  /* 尺寸 */
  --scpdf-toolbar-height: 48px;
  --scpdf-page-gap: 12px;
}
```

> 💡 变量的完整清单在 [`src/styles/viewer.css`](../src/styles/viewer.css) 的 `:root` 段。
> **每个变量都有默认值** —— 你只覆盖要改的。

### 高亮色板（品牌色）

```tsx
<PdfViewer
  highlightPalette={{
    'my-yellow': '#fff3bf',
    'my-green': '#d9f7be',
    'my-blue': '#bae0ff',
  }}
/>;
```

> ⚠️ 色板是**语义 key → CSS 颜色**。存高亮时存 **key**（不是颜色值）→
> 宿主换主题时**高亮自动跟着变** ✅

---

## 8. 换富文本编辑器

### 用 TipTap（包自带集成）

```tsx
import { TipTapEditor } from '@scholar-space/pdf-viewer/editor';

<PdfViewer annotationEditor={TipTapEditor} />;
```

> ⚠️ 需要装 `@tiptap/react` `@tiptap/starter-kit` 等（可选 peer）。
>
> ⚠️⚠️ **`@tiptap/extension-text-style` 一定要装**（审计发现的**真 bug**）：
>
> -> TipTap 的 `Color` 扩展是**基于 `textStyle` 实现的** ✅
> -> 但 **StarterKit v3 不包含 `TextStyle`** ❌
> -> 少了它 -> `setColor` 直接抛错 ❌
>   -> 报错：`There is no mark type named 'textStyle'` ❌
>   -> -> **文字颜色功能 100% 失效** ❌
>
> ```sh
> pnpm add @tiptap/core @tiptap/starter-kit @tiptap/react \
>   @tiptap/extension-text-style @tiptap/extension-color \
>   @tiptap/extension-highlight @tiptap/extension-underline \
>   @tiptap/extension-link @tiptap/extension-placeholder
> ```
>
> -> **没装 TipTap** -> 自动**回退到包内置的轻量编辑器** ✅（功能少一点，但能用）

### 用自己的编辑器

```tsx
import type { ComponentType } from 'react';

const MyEditor: ComponentType<{
  value: string;
  onChange: (html: string) => void;
  toolbar?: RichTextToolbarItem[];
}> = (props) => <MyRichText {...props} />;

<PdfViewer annotationEditor={MyEditor} />;
```

### ⚠️ 自定义编辑器要支持这三个颜色命令

包会把 `toolbar` 传给编辑器，**编辑器负责执行命令**。三个颜色命令的语义**必须一致**：

| 命令            | 必须做到                         | 用哪个色板              |
| --------------- | -------------------------------- | ----------------------- |
| `hiliteColor`   | 设**背景色**（`value` 是颜色值） | `annotationPalette`     |
| `textHighlight` | 设**背景色**，**字色不变** ⭐    | `annotationPalette`     |
| `foreColor`     | 设**字色**（`value` 是颜色值）   | `annotationTextPalette` |

-> `value` **可能为空** -> 表示"清除这个格式" ✅
-> 颜色值是 **CSS 颜色字符串**（`#rrggbb` / `rgb(...)`）✅

**参考实现**：包内置的 `RichTextEditor`（`execRichTextCommand`）和
`TipTapEditor`（`run`）都遵守这个约定 ✅

### ⚠️ 图标要能区分开

三个颜色命令的图标**必须长得不一样**（用户反馈："图标还是跟文字颜色相同 需要区分开"）：

| 命令            | 内置图标         | 画法               |
| --------------- | ---------------- | ------------------ |
| `hiliteColor`   | `highlightColor` | 笔 + **底部**色条  |
| `textHighlight` | `textHighlight`  | "A" + **背景方块** |
| `foreColor`     | `textColor`      | "A" + **下方色条** |
| `removeFormat`  | `clearFormat`    | "A" + **斜杠**划掉 |

-> ⚠️ **默认工具栏只有前三个里的"高亮"和"文字颜色"**（"文字高亮"被去掉了）❌

-> 宿主覆盖图标时**也要保持这个区分** ✅

---

## 9. 自定义批注渲染

### CSS 定制小便签

```css
.scpdf-annotation {
  border-radius: 6px;
  box-shadow: 0 2px 8px rgb(0 0 0 / 12%);
  font-family: "Inter", sans-serif;
}
```

### 用 `slots.pageOverlay` 在页上加东西

```tsx
<PdfViewer
  slots={{
    pageOverlay: (pageNumber) => <MyPageBadge page={pageNumber} />,
  }}
/>;
```

> 💡 每页都会渲染这个函数返回的东西 —— 适合做"章节标记"这类东西。

---

## 10. 接管 Toast

```tsx
<PdfViewer
  onToast={(toast) => {
    // 用宿主自己的 UI 体系（antd / shadcn / 自研）
    myApp.toast({ type: 'success', message: '已保存' });
  }}
/>;
```

**`ToastController` 的方法**：

| 方法             | 签名                                | 说明                          |
| ---------------- | ----------------------------------- | ----------------------------- |
| `show`           | `(options: ToastOptions) => string` | 弹一条（返回 toast id）       |
| `success`        | `(msg, options?) => string`         | 成功                          |
| `error`          | `(msg, options?) => string`         | 失败                          |
| `warning`        | `(msg, options?) => string`         | 警告（**不是 `warn`**）       |
| `info`           | `(msg, options?) => string`         | 提示                          |
| `loading`        | `(msg, options?) => string`         | 加载中                        |
| `loadingPromise` | `(msg, task) => Promise<string>`    | **Promise 形态**（照着 antd） |
| `close`          | `(id?: string) => void`             | 关闭（不给 id = 关最后一条）  |

**`loadingPromise` 的妙用**（自动 loading → success / error）：

```tsx
onToast={(toast) => {
  toast.loadingPromise('正在复制…', async () => {
    await copyToClipboard(text);
    return '复制成功';   // ← 这句会变成 success toast
  });
}}
```

> 💡 **不传 `onToast` 就用包内置的**（antd 风格）。
> 宿主接管后，**包自己不发 toast**（宿主想怎么弹就怎么弹）。

---

## 11. 接管密码输入

```tsx
<PdfViewer
  onRequestPassword={({ retry, cancel }) => {
    openMyPasswordDialog({
      onSubmit: (pw: string) => retry(pw),
      onCancel: () => cancel(),
    });
  }}
/>;
```

> ⚠️ `retry(pw)` 密码错了会**再次调** `onRequestPassword` → 宿主记得显示"密码错误"。

---

## 12. 注入自己的 pdf.js

包**不内置 pdf.js**（体积 + 许可证）。宿主注入：

```tsx
import * as pdfjs from 'pdfjs-dist';
import type { PdfViewerProps } from '@scholar-space/pdf-viewer';

const workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

let doc: pdfjs.PDFDocumentProxy | null = null;

<PdfViewer
  file={url}
  getPage={async (n) => {
    doc ??= await pdfjs.getDocument(url).promise;
    return doc.getPage(n);
  }}
  getDocInfo={async (data) => {
    doc ??= await pdfjs.getDocument({ data }).promise;
    return { numPages: doc.numPages, title: '', author: '', subject: '', keywords: '' };
  }}
  getPageSizes={async (numPages) => {
    doc ??= await pdfjs.getDocument(url).promise;
    return Promise.all(
      Array.from({ length: numPages }, async (_, i) => {
        const page = await doc!.getPage(i + 1);
        const vp = page.getViewport({ scale: 1 });
        return { width: vp.width, height: vp.height };
      }),
    );
  }}
/>;
```

> 💡 **`getPageSizes` 一定要传** —— 不传则用 A4 兜底 → 跳页会偏。

---

## 13. 用 core 层的纯逻辑

`@scholar-space/pdf-viewer/core` 是**零 React、零 DOM** 的纯逻辑。
可以在**服务端**跑（比如批量算高亮坐标）：

```ts
import { sanitizeRichText, richTextToPlain } from '@scholar-space/pdf-viewer/core';

const safe = sanitizeRichText(userInput);
const plain = richTextToPlain(safe);
```

> ⚠️ `sanitizeRichText` 在 **SSR**（没有 `document`）下**不做任何清洗** ——
> 服务端要清洗的话，**别指望它**。

---

## 14. 包的边界（什么不要往里塞）

包**只做 PDF**。这些**不属于包**：

| 东西                         | 归谁     |
| ---------------------------- | -------- |
| 翻译 / 提问 / 解释的业务逻辑 | **宿主** |
| 批注内容存哪、怎么同步       | **宿主** |
| 认证 / 权限                  | **宿主** |
| 拖放上传文件                 | **宿主** |
| 文件列表 / 目录树            | **宿主** |

**判断标准**：如果一个功能**换个后端就不用改** → 属于包；
**换个后端就要改** → 属于宿主。

---

**← 返回 [README](../README.md) · [API 参考](./API.md) · [使用指南](./GUIDE.md)**
