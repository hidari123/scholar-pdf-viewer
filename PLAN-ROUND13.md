# 方案（第十三轮）：5 个问题的根因 + 修法

> **先不改代码**，等确认。

---

## 摘要：5 个问题，3 个是坐标/状态的 bug，2 个是功能缺失

| # | 问题 | 性质 | 根因 |
|---|------|------|------|
| 1 | 点高亮后选区不清除；点高亮块不弹浮层 | **bug** + 功能缺失 | `clearState()` 只清包内 state，**没清浏览器原生选区**；点高亮块只置 `activeHighlightId` |
| 2 | 面板打开时框选整体右偏 | **bug** | `pageLeft` 用 `offsetLeft` 算，**offsetParent 不是容器** → 面板一开就偏 −245px |
| 3 | 切换文档后高亮/选区残留 | **bug** + 功能缺失 | 包**不知道**文档换了；demo 高亮没持久化 |
| 4 | 页面样式不可配 | 功能缺失 | 只有 28 个 CSS 变量 + `theme: light/dark/auto`，没有"整套方案"的概念 |
| 5 | 打印效果不对 | 功能缺失 | **完全没有 `@media print` CSS** |

---

# 问题 1：点高亮后选区不清除 + 点高亮块不弹浮层

## 实测（已复现）

```
选中后:      nativeSelLen: 11  selectionLayer: 1  popover: true
点高亮后:    nativeSelLen: 11  selectionLayer: 1  popover: true   ← ❌ 全都没清
点高亮块后:  activeAnnotations: 1                                ← ❌ 只有个蓝框
```

![问题1](e2e-shots/issue1-after-highlight.png)

图上能看到三件事：
1. **蓝色外边框** = `.scpdf-annotation--active` 的 `outline: 2px solid`（点高亮块触发的）
2. **浮层还在** = 高亮后没关
3. **蓝色选区还在** = 自绘层没清

## 根因

### 1a. `clearState()` 没清浏览器原生选区

`src/hooks/useTextSelection.ts`：

```ts
const clearState = useCallback(() => {
  selectionRef.current = null;      // ← 只清了包内的引用
}, []);
```

`src/components/PdfViewer.tsx` 的 `clearSelectionAfterHighlight` 调它 → 清了 shape、关了浮层，
但 **浏览器里的原生选区还在** → `selectionchange` 还会触发 → 浮层又被打开。

> ⚠️ 不能无脑加 `removeAllRanges()`：之前踩过坑 —— 在 click 处理器里调 `removeAllRanges()`
> 会**永久破坏后续的文本选择**（用户再也选不中字）。
> → 正确做法见下面方案。

### 1b. 点高亮块只置 active 标记

```ts
const handleHighlightClick = useCallback((highlight: HighlightRecord) => {
  setActiveHighlightId(highlight.id);   // ← 只是加个蓝框
  onHighlightClick?.(highlight);
}, [onHighlightClick]);
```

包没有"高亮块的操作条"这个概念 —— 浮层只绑在**浏览器选区**上。

## 方案

### 1a. 高亮后彻底清掉选区（3 处）

**① 包内加一个"清原生选区"的动作**

在 `useTextSelection` 里新增 `clearNativeSelection()`：

```ts
/**
 * 清掉浏览器原生选区。
 *
 * ⚠️ **不能**在 mousedown/click 处理器里直接调 `removeAllRanges()`
 *    —— 那会永久破坏后续的文本选择（用户再也选不中字）。
 * → 只在**动作完成之后**（如"高亮已保存"）调。
 */
const clearNativeSelection = useCallback(() => {
  const selection = window.getSelection();
  if (!selection) return;
  // 先把选区内容记下来（宿主可能还要用）
  selection.removeAllRanges();
}, []);
```

**② `clearSelectionAfterHighlight` 改成三管齐下**

```ts
const clearSelectionAfterHighlight = useCallback(() => {
  textSelection.clearState();        // 包内 state
  textSelection.clearNativeSelection(); // ← 新增：浏览器原生选区
  setSelectionShapes(new Map());     // 自绘蓝色块
  setPopoverOpen(false);
  setPopoverAnchor(null);
  setCurrentSelection(null);
  setActiveHighlightId(null);        // ← 新增：去掉高亮的蓝框
}, [textSelection]);
```

**③ 顺序很关键**：先 `clearNativeSelection()`（会触发 `selectionchange`），
再关浮层 —— 否则 `selectionchange` 会在浮层关闭后又把它打开。

> 配套：`.scpdf-annotation--active` 的 `outline` 改成**只在 hover 时显示**，
> 或者改成"点选中后 1.5s 自动消失"（避免一直挂着蓝框）。

### 1b. 点高亮块 → 弹出"高亮操作条"

**新增组件 `HighlightPopover`**（和 `SelectionPopover` 同级，但锚点是**高亮块的矩形**）：

```
┌─────────────────────────────┐
│  🖍 ▾  📋  🗑  💬  ↩         │  ← 换色 / 复制 / 删除 / 笔记 / 更多
└─────────────────────────────┘
        ↑ 锚在"n End-to-End"这块高亮的上方
```

**关键设计决策（需要你定）**：

| 方案 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| **A. 复用 SelectionPopover** | 点高亮块时，用高亮的 `position` 算出一个矩形，塞进 `SelectionPopover` | 复用度高，改动小 | `SelectionPopover` 依赖**浏览器原生选区**（`readLiveAnchor`）→ 要改成支持"外部锚点" |
| **B. 新增 HighlightPopover** | 独立的组件，锚点来自高亮的 DOM 矩形 | 语义清晰，不污染选区浮层 | 多一个组件 |
| **C. 不弹浮层，点高亮块只选中它** | 高亮块获得 focus（键盘可达），用右键菜单 | 最简单 | 用户明确要求"点击高亮之后应该也会出现那个选择的弹框" → 不满足 |

**我推荐 B**，但**改造 `SelectionPopover` 让它支持"外部锚点模式"**（A 的机制 + B 的语义）：

```ts
export interface SelectionPopoverProps {
  open: boolean;
  /** 外部锚点（高亮块等非浏览器选区的场景）—— 给了就用它，不再读 DOM 选区 */
  anchorRect?: { left: number; top: number; right: number; bottom: number } | null;
  /** ...原有 props */
}
```

**包边界（重要）**：
- 包只提供 **UI + 事件**，不碰业务
- 高亮操作条的**动作**由宿主注入（复用现有的 `selectionActions` 机制）
- **删除高亮** → 触发 `onHighlightRemove(id)`，由宿主决定怎么删
- **换色** → 触发 `onHighlightUpdate(id, {color})`

**"删除高亮"按钮默认显示吗？** 按现在的规则（"宿主没配回调 ⇒ 按钮不渲染"），
→ 只有宿主传了 `onHighlightRemove` 才显示"删除"按钮。

### 1c. 顺带修一个小问题

`handleHighlightClick` 之后没有 `clearState()` → 浏览器原生选区还在 → 浮层还开着。
→ 点高亮块时应该**主动清掉原生选区**（否则浮层锚点还在旧选区上）。

---

# 问题 2：面板打开时框选文字整体右偏

## 实测（已复现）

```
无面板:  contLeft=8,   pageLeftViewport=8,   pageLeftContent=0    ✅
有面板:  contLeft=253, pageLeftViewport=253, pageLeftContent=0    ✅
```

但**自绘选区块的位置**：

```
无面板时选中: selRects[0].x = 716.6, 浏览器选区 left = 725  → Δ左=245  ❌
有面板时选中: selRects[0].x = 716.6, 浏览器选区 left = 725  → Δ左=245  ❌
```

（面板宽度正好 245 = 253 − 8 → **偏移量就是面板宽度**）

## 根因

**是我上一轮引入的 bug**（为了修"页居中时选区被丢弃"）。

`src/components/PdfViewer.tsx` 的 `measurePageLeft`：

```ts
const left = Math.round(pageEl.offsetLeft - container.offsetLeft);
```

**`offsetLeft` 是相对 `offsetParent` 的**，而实测：

```
pageOffsetParent: "scpdf-pages"     ← 页的 offsetParent 不是容器！
containerOffsetLeft: 245            ← 面板打开后容器的 offsetLeft 变成 245
myFormula: 0 - 245 = -245           ← ❌ 错的
correctFormula: 0                   ← ✅ 对的
```

→ 面板打开 → `container.offsetLeft` 变 245 → `pageLeft = -245`
→ 归页判定用 `left: -245` → 选区被算到**页左边 245px 外** → 整块偏移。

> 我上一轮把公式从 `getBoundingClientRect()` 差值改成 `offsetLeft`，
> 理由是"前者会算出错值（395 → 8 → 0）"。**根因其实不是公式，而是测量时机**。

## 方案

**改回 `getBoundingClientRect()` 差值，但解决"测量时机"问题**：

```ts
const measurePageLeft = () => {
  const pageEl = container.querySelector<HTMLElement>('.scpdf-page');
  if (!pageEl) return;

  /*
   * ⚠️ **必须用 getBoundingClientRect() 差值**（不能用 offsetLeft）。
   *
   * 实测：页的 `offsetParent` 是 `.scpdf-pages`，**不是容器**
   *      → `pageEl.offsetLeft - container.offsetLeft` 在面板打开时 = -245 ❌
   */
  const containerRect = container.getBoundingClientRect();
  const pageRect = pageEl.getBoundingClientRect();
  // 视口坐标 → 滚动内容坐标
  const left = Math.round(pageRect.left - containerRect.left + container.scrollLeft);
  setPageLeft((prev) => (Math.abs(prev - left) >= 1 ? left : prev));
};
```

**"测量时机"问题的解法**：

1. **用 `requestAnimationFrame` 延后到布局完成后**再测
2. **对"布局未就绪"做防御**：页宽为 0 时不更新（说明还没布局好）
3. **ResizeObserver 观察页元素本身**（页宽变化 → left 变化）

```ts
const pageObserver = new ResizeObserver(() => {
  // rAF 里测 → 布局已稳定
  requestAnimationFrame(measurePageLeft);
});
pageObserver.observe(container);
const firstPage = container.querySelector<HTMLElement>('.scpdf-page');
if (firstPage) pageObserver.observe(firstPage);
```

**兜底**：万一还测不准（极端情况），
→ 归页判定**不只靠 `left`**，改成"页框**重叠**判定"（见下）。

### 更稳的备选方案（推荐一起做）

`pageOfRect` 的判定从"中心点落在页框内"改成"**中心点落在页框内 或 页框包含中心点的 x 范围**"：

```ts
export function pageOfRect(rect: RectInput, pages: PageFrame[]): number | null {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  for (const page of pages) {
    // 垂直：中心点必须在页的上下范围内（这个是硬的，不能松）
    if (centerY < page.top || centerY > page.top + page.height) continue;
    // 水平：**允许一定的容差**（页的 left 可能有 1~2px 的测量误差）
    const tolerance = 4;
    if (centerX < page.left - tolerance || centerX > page.left + page.width + tolerance) continue;
    return page.pageNumber;
  }
  return null;
}
```

→ `pageLeft` 就算有误差也不会丢选区。

**回归测试要加**：
- `extract.test.ts`：页 `left` 为负/偏大时仍能归页
- **新增 E2E**：`e2e-panel-offset.mjs` —— 开面板 → 框选 → 断言选区块与浏览器选区 Δ ≤ 3px

---

# 问题 3：切换文档时高亮/选区残留

## 实测（已复现）

```
高亮后:      annotations: 1  selectionLayer: 1  nativeSel: 11  pages: 18
切换文档后:  annotations: 1  selectionLayer: 1  nativeSel: 11  pages: 3   ← ❌ 全都还在
```

## 根因

### 3a. 包不知道"文档换了"

包是**受控**的：`highlights` 是宿主的 prop。
→ 宿主不换 `highlights`，包就一直渲染旧高亮。**这是设计如此，不是 bug**。

但**选区**（`selectionShapes` / 浮层 / 原生选区）是**包内部状态**
→ 换文档时**必须**清 —— 现在没清。

### 3b. demo 没有持久化

`demo/src/App.tsx`：

```ts
const [highlights, setHighlights] = useState<HighlightRecord[]>([]);
// ❌ 没有 localStorage / IndexedDB / 后端
// ❌ 换文档时不重置
```

## 方案

### 3a. 包：文档变化时清内部状态

**包需要知道"文档换了"**。已有的 `documentId` prop 就是干这个的（`usePdfDocument` 用它做缓存 key）。

```tsx
// PdfViewer.tsx
/**
 * ⚠️ **文档切换 → 清掉所有"属于上一份文档"的内部状态**。
 *
 * 不清的后果（实测）：
 * ```
 * 切换文档后: annotations: 1  selectionLayer: 1  nativeSel: 11
 * ```
 * → 旧文档的选区蓝色块浮在新文档上。
 */
useEffect(() => {
  textSelection.clearState();
  textSelection.clearNativeSelection();
  setSelectionShapes(new Map());
  setPopoverOpen(false);
  setPopoverAnchor(null);
  setCurrentSelection(null);
  setActiveHighlightId(null);
  setSearchHits([]);
  setActiveSearchIndex(-1);
  // 滚动位置也重置
  containerRef.current?.scrollTo({ top: 0 });
}, [documentId, file]);
```

⚠️ **依赖用 `documentId` + `file`**，不要用 `data`（Uint8Array 每次都是新引用 → 会误触发）。

### 3b. 宿主侧：把高亮按文档隔离 + 持久化

**包不碰持久化**（这是边界）。但包应该给宿主**必要的工具**。

#### ① 包提供"高亮文档"的序列化格式（纯函数，零依赖）

新增 `src/core/highlight/serialize.ts`：

```ts
/**
 * 高亮文档（annotations）的**序列化格式**。
 *
 * ## 为什么放在包里
 *
 * 宿主要"导出/导入高亮"，但格式如果各写各的 → 互不兼容。
 * 包提供**一套标准格式 + 纯函数** → 任何后端都能用（存 JSON / 存 Blob / 传接口）。
 *
 * ## 边界
 *
 * 包**只管格式**，不碰存储（不碰 localStorage / IndexedDB / HTTP）。
 */

/** 格式版本（以后改格式时靠它做迁移） */
export const HIGHLIGHT_DOC_VERSION = 1;

/** 一份文档的高亮集合（可序列化） */
export interface HighlightDoc {
  version: number;
  /** 文档标识（宿主给，比如文件 hash / 业务 id） */
  documentId: string;
  /** 高亮列表 */
  highlights: HighlightRecord[];
  /** 导出时间 */
  exportedAt: number;
}

/** 导出 */
export function exportHighlights(
  documentId: string,
  highlights: readonly HighlightRecord[],
): HighlightDoc;

/** 导入（含版本校验 + 字段兜底） */
export function importHighlights(raw: unknown): HighlightDoc | null;

/** 转 JSON 字符串 */
export function stringifyHighlightDoc(doc: HighlightDoc): string;

/** 从 JSON 字符串解析 */
export function parseHighlightDoc(text: string): HighlightDoc | null;
```

#### ② 宿主侧：三种持久化方案（按需选一种）

| 方案 | 存哪 | 适合 |
|------|------|------|
| **A. localStorage** | 浏览器本地 | 单机使用、小数据量（< 5MB） |
| **B. IndexedDB** | 浏览器本地 | 大文档、大量高亮 |
| **C. 后端接口** | 服务器 | 多人协作、跨设备（**用户要的**） |

**C 的接口契约**（包不实现，宿主实现；包只给数据格式）：

```
POST   /api/documents/:id/highlights       整份保存（幂等 upsert）
GET    /api/documents/:id/highlights       读取
PATCH  /api/documents/:id/highlights/:hid  单条更新（换色）
DELETE /api/documents/:id/highlights/:hid  单条删除
```

**"每次改动都保存到接口"** —— 宿主侧用一个**防抖 + 队列**：

```ts
// 宿主侧（demo 示例）
const saveQueue = useRef<HighlightRecord[]>([]);
const saving = useRef(false);

const scheduleSave = useCallback((next: HighlightRecord[]) => {
  saveQueue.current = next;
  if (saving.current) return;
  saving.current = true;
  // 500ms 防抖：连续操作合并成一次请求
  setTimeout(async () => {
    const payload = saveQueue.current;
    saving.current = false;
    await fetch(`/api/documents/${docId}/highlights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exportHighlights(docId, payload)),
    });
  }, 500);
}, [docId]);
```

> **包不内置 fetch**（换后端也能用）→ 包只给 `exportHighlights` / `importHighlights`。

#### ③ 切换文档时按 documentId 切换高亮

```tsx
// 宿主侧
const [highlightsByDoc, setHighlightsByDoc] = useState<Record<string, HighlightRecord[]>>({});

// 文档切换 → 加载对应文档的高亮
useEffect(() => {
  let cancelled = false;
  void (async () => {
    const res = await fetch(`/api/documents/${documentId}/highlights`);
    const doc = importHighlights(await res.json());
    if (!cancelled && doc) setHighlightsByDoc((p) => ({ ...p, [documentId]: doc.highlights }));
  })();
  return () => { cancelled = true; };
}, [documentId]);

// 传给包
highlights={highlightsByDoc[currentDocumentId] ?? []}
```

### 3c. PDF 下载

**包不提供下载**（文件是宿主的），但可以提供**一个下载助手**：

```ts
// 宿主侧
const downloadPdf = () => {
  const url = URL.createObjectURL(pdfBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
};
```

**要不要包提供？** 建议**包提供一个纯工具函数**（不碰网络）：

```ts
// src/core/document/download.ts
/**
 * 触发浏览器下载（纯 DOM，无网络依赖）。
 *
 * ⚠️ 包**不负责获取文件** —— 文件是宿主的（URL / Blob / ArrayBuffer）。
 */
export function downloadFile(data: Blob | string, filename: string): void;
```

### 3d. 导出"带高亮的 PDF"

**这个必须在宿主侧做**（需要 pdf.js 的能力，而 pdf.js 在宿主侧）。
包**可以**提供一个"把高亮转成 PDF 批注"的**纯计算**函数：

```ts
// src/core/highlight/annotations.ts（新增）
/**
 * 把高亮转成 **PDF 批注（Annot）**的坐标描述。
 *
 * ⚠️ **只算坐标，不写文件** —— 写 PDF 是宿主的活（宿主有 pdf.js / pdf-lib）。
 *
 * 坐标系：PDF 点（72dpi，原点左下、y 向上）→ 需要页尺寸 + 归一化坐标换算。
 */
export function highlightToPdfAnnots(
  highlight: HighlightRecord,
  pageSizePt: { width: number; height: number },
): { rect: [number, number, number, number]; text: string }[];
```

宿主拿到后用 pdf-lib / pdf.js 写进 PDF。

---

# 问题 4：页面样式配置 —— 给出几套方案

## 现状

- **28 个 CSS 变量**（`--scpdf-color-*` / `--scpdf-shadow-*` / `--scpdf-radius-*` / `--scpdf-motion-*` / `--scpdf-font-*`）
- `theme?: 'light' | 'dark' | 'auto'` —— 只有 3 种
- 暗色只覆盖了 4 个颜色变量（surface / surface-alt / text / border）+ 2 个高亮色

**问题**：想要"整套风格"（比如学术论文风 / 护眼米色 / 极简黑白）时，
得在宿主 CSS 里写 28 个变量，而且**暗色下还漏了一堆**（primary、shadow、selection-color 都没覆盖）。

## 方案 A：CSS 变量覆盖（最轻，推荐保留为底层机制）

宿主写自己的 CSS：

```css
.my-viewer {
  --scpdf-color-surface: #faf8f3;
  --scpdf-color-primary: #b45309;
  --scpdf-radius-page: 6px;
  --scpdf-shadow-page: 0 4px 16px rgba(120, 90, 40, 0.15);
}
```

**优点**：零 JS、零构建、任意 bundler 可用、CDN 直引也能用
**缺点**：要手写变量；暗色要自己写两遍

**改进（要做）**：把暗色主题补全 —— 现在暗色漏了 `primary` / `shadow` / `selection-color` / `bbox-color`。

## 方案 B：内置多套主题（`theme` 改成具名主题）

```ts
type PdfViewerTheme =
  | 'light'      // 亮色（默认）
  | 'dark'       // 暗色
  | 'auto'       // 跟随系统
  | 'paper'      // 纸张（米黄护眼）
  | 'sepia'      // 深色护眼
  | 'contrast'   // 高对比度（无障碍）
  | 'minimal';   // 极简黑白（打印友好）
```

包内提供 CSS：

```css
.scpdf-root--paper {
  --scpdf-color-surface: #faf8f3;
  --scpdf-color-surface-alt: #f2ede3;
  --scpdf-color-text: #2b2620;
  --scpdf-color-border: #ddd5c5;
  --scpdf-color-primary: #b45309;
  --scpdf-highlight-my: #ffe9a8;
  --scpdf-highlight-others: #dbe7f5;
  --scpdf-highlight-active: #b45309;
  --scpdf-selection-color: rgba(180, 83, 9, 0.22);
  --scpdf-bbox-color: #b45309;
  --scpdf-shadow-page: 0 4px 16px rgba(120, 90, 40, 0.15);
  --scpdf-radius-page: 6px;
}
```

**优点**：开箱即用、切换零成本、每套主题都**完整**（含暗色变体）
**缺点**：主题数量有限；宿主想微调还是要用方案 A 覆盖变量

**两者不冲突** —— B 建立在 A 之上，宿主仍可用变量微调。

## 方案 C：`appearance` 配置对象（JS 传参）

```ts
<PdfViewer
  appearance={{
    density: 'compact' | 'cozy' | 'comfortable',   // 密度
    chrome: 'full' | 'minimal' | 'hidden',          // 工具栏/面板
    pageShadow: boolean,
    pageRadius: number,
    showPageNumber: boolean,
    showOutline: boolean,
    showThumbnails: boolean,
    showSearch: boolean,
    accentColor?: string,
    fontFamily?: string,
    fontSize?: number,
  }}
/>
```

**优点**：**非 CSS 的东西**（显示哪些按钮、密度、页码）用 JS 配最自然
**缺点**：CSS 视觉细节还是得靠变量

## 方案 D：插槽（完全自定义）

```tsx
<PdfViewer
  slots={{
    toolbar: <MyToolbar />,      // 完全替换工具栏
    panel: <MySidebar />,        // 完全替换侧栏
    pageOverlay: <MyOverlay />,  // 页内叠加层
  }}
/>
```

**优点**：自由度最高
**缺点**：改动大

## 我的建议组合

```
方案 B（内置主题） + 方案 C（appearance 配置） + 方案 A（变量微调，作为底座）
```

- **B** 给"整套风格"（用户要的"几套方案"）→ 包内提供 `light / dark / auto / paper / sepia / contrast / minimal`
- **C** 给"结构性开关"（哪些面板、密度）→ 用 JS 配
- **A** 作为底座，宿主随时微调任意变量

**分层表**：

| 层 | 控制什么 | 手段 |
|---|---|---|
| 1 | 整体风格 | `theme="paper"` |
| 2 | 结构开关 | `appearance={{...}}` |
| 3 | 像素微调 | CSS 变量覆盖 |

### 具体要新增的

1. `theme` 类型扩展（7 套）+ 每套的完整 CSS（含暗色变体 `.scpdf-root--paper` + `@media (prefers-color-scheme: dark)` 下的 paper-dark）
2. 补全现有暗色主题缺失的变量
3. 新增 `appearance` prop + 对应 CSS 类（`scpdf-root--density-compact` 等）
4. 新增 `slots` prop（方案 D 也一并做了，成本不高）

---

# 问题 5：打印效果不对

## 实测（已复现）

```
打印态: {
  toolbarVisible: true,       ← ❌ 工具栏会被打印
  containerOverflow: "auto",  ← ❌ 打印时仍是滚动容器
  containerHeight: "811px",   ← ❌ 只有一屏高
  pagesHeight: "33093px",     ← 18 页全在里面，但被裁掉
}
```

![问题5](e2e-shots/issue5-print-view.png)

图上能看到：工具栏、demo 头部（载入内置样张 / 高亮色）都被打印了，页面底部被裁断。

## 根因

**完全没有 `@media print` CSS** —— 浏览器按屏幕样式打印。

## 方案

### 5a. 加打印 CSS（核心）

```css
/*
 * ---------- 打印 ----------
 *
 * ⚠️ **打印时必须把滚动容器"摊平"**。
 *
 * 屏幕上是 `.scpdf-container { overflow: auto; height: 811px }`
 * → 打印时只有 811px 可见 → **18 页只剩第一屏**（实测）。
 *
 * → 打印时：
 *   - 容器 `overflow: visible` + `height: auto`
 *   - 工具栏 / 面板 / 浮层 / 选区层 全部 `display: none`
 *   - 页阴影去掉（打印机不印阴影，白费墨）
 */
@media print {
  .scpdf-toolbar,
  .scpdf-panel,
  .scpdf-selection-popover,
  .scpdf-selection-layer,
  .scpdf-annotations,
  .scpdf-text-layer {
    display: none !important;
  }

  .scpdf-container {
    overflow: visible !important;
    height: auto !important;
    min-height: 0 !important;
    background: #fff !important;
  }

  .scpdf-body {
    display: block !important;
  }

  .scpdf-pages {
    height: auto !important;
  }

  .scpdf-page {
    box-shadow: none !important;
    border-radius: 0 !important;
    /* 每页都从新的一页开始 */
    break-after: page;
    page-break-after: always;
  }

  /* 最后一页不要多余的空白页 */
  .scpdf-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }

  @page {
    size: auto;
    margin: 12mm;
  }
}
```

### 5b. 尺寸适配（关键难点）

打印时页面要用**纸张尺寸**，不是屏幕缩放。

**方案 i（简单，推荐先用）**：打印前临时切到"适合页面"缩放

```ts
// 宿主侧
const handlePrint = () => {
  zoom.fitPage(printWidthPt, printHeightPt);  // 按 A4 内容区算
  setTimeout(() => globalThis.print?.(), 300); // 等重排
};
```

**方案 ii（更准）**：打印时用 CSS `transform: scale()` 缩放页

```css
@media print {
  .scpdf-page {
    /* 打印宽度 - 页边距 */
    transform: scale(var(--scpdf-print-scale, 1));
    transform-origin: top left;
  }
}
```

**方案 iii（最准，但工作量大）**：打印专用渲染 —— 用 pdf.js 把每页画成 `<img>`，再打印。
**这个不该在包里做**（pdf.js 在宿主侧）。

> **我的建议**：包里做 5a（CSS）+ 提供一个 `print` 辅助 hook：
> ```ts
> const { print, preparing } = usePrint({ pageWidthPt, pageHeightPt, paper: 'A4' });
> ```
> 负责：算缩放比 → 临时应用 → 打印 → 恢复。

### 5c. 打印时要不要保留高亮？

**要**（用户的高亮是重要信息）。

- 高亮是 DOM（`.scpdf-annotation`）→ 默认会被打印
- 但 `mix-blend-mode: multiply` 在打印时可能失效 → 颜色会变
- → 打印 CSS 里给高亮加 `print-color-adjust: exact`：

```css
@media print {
  .scpdf-annotation {
    mix-blend-mode: normal !important;   /* 打印时不用正片叠底 */
    opacity: 0.45 !important;            /* 用透明度模拟"高亮但不遮字" */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```

### 5d. 文本层要隐藏

`text-layer` 是透明的（给选中用的）→ 打印时**必须隐藏**：
- 否则某些浏览器会把透明文字也打出来（幽灵文字）

已在 5a 里加了 `.scpdf-text-layer { display: none }`。

### 5e. 包提供 `onPrint` 的默认值

现在：`onPrint={features.print === false ? undefined : () => globalThis.print?.()}`

→ 改成**包内置一个"智能打印"**：

```tsx
onPrint={
  features.print === false
    ? undefined
    : () => {
        // 1. 临时把缩放调到"适合纸张"
        // 2. 等重排
        // 3. window.print()
        // 4. 恢复原缩放
      }
}
```

---

# 实施顺序建议

| 阶段 | 内容 | 理由 |
|---|---|---|
| **1** | 问题 2（页居中偏移）| 纯 bug，且会让问题 1/3 的验证变复杂 → 先修 |
| **2** | 问题 1（选区清除 + 高亮浮层）| 用户可见的核心体验 |
| **3** | 问题 3（文档切换清理）| 依赖 1、2 的状态管理 |
| **4** | 问题 5（打印）| 独立，可并行 |
| **5** | 问题 4（主题方案）| 功能增强，放最后 |

---

# 需要你确认的 5 个决策点

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | 点高亮块弹出的浮层，**长什么样**？ | 复用选区浮层的样式（同一套 `SelectionPopover`），但锚点用高亮块 |
| 2 | 高亮浮层里**默认放哪些按钮**？ | 🖍换色 / 📋复制 / 🗑删除（仅当宿主传了 `onHighlightRemove` 才显示）/ 更多 |
| 3 | 高亮持久化走**哪种后端**？ | 包只给**格式 + 纯函数**，具体存储（localStorage / IndexedDB / 接口）由宿主实现 —— **换后端也能用** |
| 4 | 主题要**几套**？ | `light / dark / auto / paper / sepia / contrast / minimal` 共 7 套 |
| 5 | 打印要不要**保留高亮**？ | **保留**（用透明度模拟，避免遮字） |

---

# 附：本轮调查中发现的一个额外 bug

**demo 的 Vite alias**（`demo/vite.config.ts`）——
`optimizeDeps.exclude` 对 **CSS 子路径导出**无效 → 必须显式 alias：

```ts
resolve: {
  alias: {
    '@scholar-club/pdf-viewer/styles.css': `${packageRoot}dist/styles.css`,
  },
},
```

否则 `import "@scholar-club/pdf-viewer/styles.css"` 会 500（demo 白屏）。
**这个和用户的 5 个问题无关，但属于"起不来"的阻塞问题**，已在上一轮修掉，方案里一并列出。
