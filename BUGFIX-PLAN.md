# 四个 Bug 的排查结论与修复方案

> 排查时间：2026-11-16 · 全部基于真实 PDF（`Agent引擎.pdf`，18 页，612×792pt）
> 状态：**只给方案，未写代码**（文本层精准定位已实施，见文末）

---

## Bug 2：缩放比例是 xx4%，且是中心缩放导致页面移动

### 排查结论

**两个独立的问题。**

#### 2.1 比例不是整十数

`src/hooks/useZoom.ts:113-123` 的 `fitWidth`：

```ts
const available = containerWidth - 32;
setScale(available / pageWidth);      // ← 任意小数
```

容器宽 1391px、页面宽 612pt → `1359/612 = 2.2205...` → 工具栏显示 **222%**。

而步进缩放 `SCALE_STEP = 0.1`（`useZoom.ts:16`）是 **0.1 = 10%**，
所以「适配宽度」之后点一次放大 → 232%，与「适配宽度」的语义冲突。

**工具栏显示**：`Toolbar.tsx:218` 的 `Math.round(scale * 100)}%` —— 忠实显示，
问题出在 **scale 的值本身**，不是显示。

#### 2.2 中心缩放导致页面移动

`src/hooks/useZoom.ts:81`：

```ts
const anchorY = container.clientHeight / 2;   // ← 锚点在视口正中
const nextScrollTop = anchoredScrollTop(scrollTop, anchorY, prevScale, clamped);
```

锚点取的是**视口中心**那个内容点 → 缩放后它保持在原地 →
**视口顶部的内容必然移动**（放大时内容向下流，缩小向上流）。

用户要的是：**视口左上角那个内容点保持不动** → 缩放时第一排文字纹丝不动。

### 修复方案

#### 改动 1：锚点改为视口左上角

`useZoom.ts` 的 `setScale`：

```ts
// 改前
const anchorY = container.clientHeight / 2;
// 改后
const anchorY = 0;   // 视口左上角
```

同时 `core/store/instance.ts` 的 `anchoredScrollTop` 公式需要复核
（锚点是 0 时，公式退化为 `scrollTop * nextScale / prevScale`）。

**为什么锚点选左上角而不是别的**：
- 用户明确要求「第一排文字高度不动」
- 左上角锚点 = **滚动位置与内容位置的线性关系**最简单 → 公式最稳
- PDF 阅读器惯例（Chrome 内置 PDF 阅读器、macOS 预览）都是左上角锚点

> ⚠️ 注意：左上角锚点在**页面顶部**缩放时，等价于「内容整体缩放，不动」；
> 但当用户已经滚到文档中间时，缩放会让**当前页的起始位置**改变，
> 这是几何必然。正确表现是「视口左上角那个字不动」。

#### 改动 2：缩放比例量化到整十数

**方案：引入「显示比例」与「实际比例」分离**

| 概念 | 值 | 用途 |
|---|---|---|
| `scale` | 实际渲染比例（任意小数） | 渲染几何 |
| `zoomPercent` | **整十数**（10/20/…/250） | 工具栏显示 + 步进基准 |

但这样「适配宽度」算出的 222% 就无法精确显示。

**更好的方案（推荐）：把 scale 本身量化**

```
step 量化：scale = round(scale / 0.1) * 0.1     → 220%
适配宽度：scale = round(fitScale / 0.1) * 0.1   → 220%
```

**为什么量化 scale 本身**：
- 工具栏显示、渲染几何、页尺寸计算**全部一致** → 不会出现「显示 220% 但实际是 222%」
- 不会出现「适配宽度后点放大跳到 232%」这种突兀感
- 量化误差 ≤ 5%，对「适配宽度」来说，页面右边缘最多差 5px —— 可接受
  （用户要求「整十数」的收益 > 5px 的损失）

**具体改法**：

```ts
// useZoom.ts 新增
const SCALE_QUANTUM = 0.1;   // 10%

function quantizeScale(scale: number): number {
  return Math.round(scale / SCALE_QUANTUM) * SCALE_QUANTUM;
}

// setScale 里
const clamped = clampScale(next);
const quantized = quantizeScale(clamped);
```

并把 `MIN_SCALE` / `MAX_SCALE` 也对齐到 0.1 的倍数（0.2 / 2.5 已经是）。

**配套**：`fitWidth` / `fitPage` 传入的原始值也要量化（走 `setScale` 即可，
因为量化在 `setScale` 内部统一做）。

#### 改动 3：可选 —— 比例下拉菜单

如果需要「50% / 75% / 100% / 125% / 150% / 200% / 250%」这类预设，
可以加一个下拉。**建议先不做** —— 用户只要求「整十数」，量化就够了。

### 测试计划

- 单测：`quantizeScale(2.2205) === 2.2`、`quantizeScale(1.04) === 1.0`
- 单测：锚点为 0 时，`anchoredScrollTop` 的行为
- E2E：点「适配宽度」→ 工具栏显示 `220%`（不是 222%）
- E2E：缩放前后，**视口第一行文字的 top 像素不变**（误差 < 1px）

---

## Bug 3：缩放后上移下移，原本有文字的页面变成白屏

### 排查结论

**已复现**（`scripts/debug-zoom.mjs`）：

```
=== 初始 ===
  页1: top=-459 h=1800 canvas=true(1390x1799) text=134项
=== 放大 3 次后 ===
  页1: top=-552 h=1980 canvas=false(0x0) text=0项     ← 白屏
```

**根因：`visiblePages` 在缩放后失效 → `isVisible=false` → `<Page>` 整个不渲染。**

`PdfViewer.tsx:708`：

```tsx
{isVisible ? <Page ... /> : null}    // isVisible = visiblePages.includes(pageNumber)
```

`visiblePages` 来自 `useVisiblePages`（`src/hooks/useVisiblePages.ts`），它有两个致命问题：

#### 根因 A：IntersectionObserver 的 rootMargin 用的是「百分比」，缩放后完全失效

`useVisiblePages.ts:117`：

```ts
rootMargin: `${bufferPages * 100}% 0px`,   // = 300% 0px
```

`rootMargin` 的百分比是相对 **root（滚动容器）尺寸**计算的，
**不是相对元素尺寸**。

- 缩放前：容器高 811px → 缓冲 2433px ≈ 3 个页高 ✓
- 缩放 300% 后：页高从 1800px 变成 1980px（容器还是 811px）→
  缓冲仍是 2433px，但**现在只够 1.2 个页高**（本意是 3 个）

**更严重的是**：IO 的 `rootMargin` 是**固定值**，缩放改变了页面尺寸，
但 IO 观察的元素尺寸变了 → **IO 不会重新触发回调**（除非元素真的进出缓冲区）。

结果：`visiblePages` 停留在旧值，而视口已经移到了别的页 → 那些页 `isVisible=false` → 白屏。

#### 根因 B：观察的是「页占位元素」，但占位元素的 `top` 在缩放时全部变化

`PdfViewer.tsx:701-706`：

```tsx
style={{
  width: size.width,
  height: size.height,
  top: pageTops[index] ?? 0,     // ← 缩放后全部变了
}}
```

页占位元素是**绝对定位**的，`top` 由 `pageTops` 数组给出。
缩放 → `pageTops` 重算 → **所有占位元素的 top 突变** → IO 观察到的位置全变。

但 IO 的 `isIntersecting` 只有在**跨越阈值**时才回调。
如果缩放后某页**仍然在缓冲区里**（isIntersecting 不变）→ **IO 不触发** →
`visiblePages` 不更新 → 那些实际已移出视口的页依然在渲染，
而新进入视口的页**还没进 `visiblePages`** → 白屏。

### 修复方案

#### 改动 1：缩放后强制重算可见页（核心修复）

**不要依赖 IO 单独驱动**。缩放是一个**离散的、已知的**事件 ——
此时应该**主动重算**一次可见页，而不是等 IO 回调。

**做法**：把「可见页计算」抽成纯函数，IO 和缩放都能调用。

```ts
// core/virtualization/visible.ts（新增）
export function computeVisiblePages(
  container: HTMLElement,
  pageElements: Map<number, HTMLElement>,
  totalPages: number,
  bufferPages: number,
): number[]
```

计算方式：**直接用 `getBoundingClientRect()` 判断**，不依赖 IO。

**为什么改用几何计算**：
- IO 的 rootMargin 百分比语义在"页面尺寸随缩放变化"时不可靠
- 直接算几何是**确定性的**：给定 scrollTop 和 scale，结果唯一
- 缩放后能立即得到正确结果，不等 IO 的异步回调

**调用时机**：
1. `scroll` 事件（节流到 rAF）→ 重算
2. `scale` 变化 → 重算（**这就是修 bug 3 的关键**）
3. `resize` 事件 → 重算

#### 改动 2：IO 降级为「优化」而非「唯一来源」

保留 IO 用于**减少 scroll 回调频率**，但**每次重算都以几何为准**。

或者更简单：**直接去掉 IO，用 rAF 节流的 scroll + 几何计算**。
IO 的唯一优势是"不占主线程"，但我们的计算是 O(可见页数) 的纯几何，
18 页文档 < 1ms，不值得引入 IO 的复杂度与不确定性。

**推荐**：**去掉 IO，改用几何计算**。理由：
- 消除一整类"IO 不触发"的问题
- 代码更简单、更可测
- 性能足够（500 页文档也就 500 次 getBoundingClientRect，rAF 节流后完全 OK）

#### 改动 3：白屏兜底 —— 保留上一页的渲染

即使重算有延迟（异步取页 proxy），也不该让页面变白。

**做法**：`isVisible` 的判断放宽 —— 页只要**曾经渲染过**，就保留其 `<Page>`，
直到确认它已滚出缓冲区。

```tsx
// 用"渲染过的页集合"而不是"当前可见页集合"来决定是否渲染
const shouldRender = visiblePages.includes(n) || renderedOnce.has(n);
```

**为什么**：白屏比"多渲染一页"糟糕得多。
多渲染的页只是浪费一点内存，滚远了再卸载。

#### 改动 4：缩放时的渲染节流

缩放连点 5 次 = 5 轮全量重渲染 → 卡顿（用户也提到"展示的时候会出现卡顿"）。

**做法**：
- 缩放时**先只改 CSS 尺寸**（页面容器高度 + 占位），**canvas 保持旧内容**
- 用 `requestAnimationFrame` 合并多次缩放
- 或者：缩放期间给 canvas 加 `transform: scale()` 做**视觉上的即时缩放**，
  停止缩放 150ms 后再渲染真内容（类似 Chrome 的"快速缩放预览"）

**推荐改动 4 的简化版**：缩放时 debounce 渲染（150ms），
canvas 保持上一帧内容（略微拉伸但不白屏）。

### 测试计划

- E2E：放大 3 次 → **视口内的页都有 canvas**（`canvas.width > 0`）
- E2E：缩放后滚动 → 每一屏都不能出现"有 page 元素但无 canvas"的页
- E2E：连续点放大 5 次 → 测量渲染次数不爆炸（< 20 次）
- 单测：`computeVisiblePages` 在不同 scrollTop / scale 下的正确性

---

## Bug 4：搜索出来没有高亮展示

### 排查结论

**搜索功能本身是通的**（之前 E2E 测到「107 个结果」），但**根本没有渲染命中的代码**。

`src/components/SearchPanel.tsx` 全文：
- 搜索 → 拿 `SearchHit[]`
- 显示**数量**（`search.count`）
- ↑↓ 切换 `activeIndex` → 调 `onNavigate(hit, index)`

`PdfViewer.tsx:599-602`：

```tsx
onNavigate={(hit: SearchHit) => {
  // 跳到命中所在页（宿主可再根据 start 做精确定位与高亮）
  scrollToPage(hit.pageNumber);
}},
```

**只跳页，不高亮。** 注释里写的「宿主可再根据 start 做精确定位与高亮」
—— 但宿主也没实现。

**更关键的问题**：`SearchHit` 只有 `pageNumber / text / start / length`，
**没有矩形几何**：

```ts
export interface SearchHit {
  pageNumber: number;
  text: string;
  start: number;     // 在该页文本中的字符起始位置
  length: number;
}
```

而包里的高亮层 `AnnotationLayer` 画的是 `HighlightRecord`（含 `NormRect` 归一化矩形）。
**搜索命中 → 矩形的转换这一步，压根不存在。**

### 修复方案

#### 改动 1：搜索命中 → 矩形几何（core，纯函数，可单测）

新增 `src/core/search/highlight.ts`：

```ts
/** 把命中转成归一化矩形 */
export function hitToRects(
  hit: SearchHit,
  pageItems: PositionedTextItem[],   // 该页已排版的文本项
  viewport: TextViewportLike,
): NormRect[]
```

**算法**（逐 item 累加字符数，找到覆盖命中的那些 item）：

```
pageText = items.map(i => i.text).join('')
命中区间 = [hit.start, hit.start + hit.length)

遍历 items，累加每个 item 的字符数，
  与命中区间有交集的 item → 用 item 的 left/top/width/fontSize 生成矩形
  （部分命中时按比例裁剪宽度）
```

**为什么用「逐 item 累加」而不是别的**：
- 索引是在**拼接后的整页文本**上建的（`search.ts` 的 `PageIndex.text`）
- item 的 `str` 按顺序拼接 = 索引文本的来源
- 所以**字符偏移 → item 区间**的映射是精确的（前提：索引与渲染用的是同一份 items）

**⚠️ 陷阱**：索引和渲染必须用**完全相同**的 items 序列。
现在 demo 里搜索的 provider 和渲染的 `getTextContent` 是**两个独立调用**，
如果 PDF 有随机性或两次调用顺序不同 → 偏移错位。
**修复**：让宿主缓存每页的 textContent，搜索与渲染共用。

#### 改动 2：搜索高亮的渲染

复用现有的 `AnnotationLayer`（已经在画高亮了）：

```tsx
// PdfViewer 里
const searchRects = useMemo(() => {
  // 当前关键词的命中 → 矩形（只算可见页，避免全文档计算）
}, [searchHits, keyword, visiblePages]);
```

然后把 `searchRects` 传给 `AnnotationLayer`，用**另一种颜色**（如黄色/橙色）区分。

**为什么复用 AnnotationLayer**：
- 已经有归一化矩形 → 视口 px 的换算
- 已经处理了缩放（归一化坐标与缩放无关）
- 不需要新的渲染层 → 少一处状态

**但需要给 AnnotationLayer 区分两类高亮**：
- `highlights`（用户高亮，宿主受控）
- `searchHits`（搜索命中，包内部状态）

**建议**：给 `AnnotationLayer` 加一个可选的 `searchRects` prop，
渲染成 `.scpdf-annotation--search`（独立颜色）。

#### 改动 3：命中项在页面上的定位要滚动过去

现在 `onNavigate` 只 `scrollToPage(hit.pageNumber)` → 跳到**页首**，
但命中可能在页面的第 3 行中间。

**修复**：用命中矩形的 y 坐标算精确滚动位置：

```ts
const rect = hitRects[0];
const targetScrollTop = pageTop[hit.pageNumber] + rect.y * pageHeightPx - 100;
```

（减 100 是留点余量，让命中在视口上部可见）

#### 改动 4：搜索结果列表（可选）

现在只有数量，没有列表。用户说"搜索功能也用不了"，
说明期望是能看到结果并点击跳转。

**建议**：加一个下拉列表（每条：页码 + 命中上下文片段），点击 → 滚动 + 高亮当前项。

### 测试计划

- 单测：`hitToRects` —— 命中在单 item 内 / 跨 item / 跨行 的矩形计算
- 单测：字符偏移 → item 映射的边界（start=0 / start=末尾 / length 超出）
- E2E：搜索 "harness" → **页面出现 `.scpdf-annotation--search` 元素**
- E2E：点击 ↑↓ → 视图滚动到对应命中处

---

## Bug 1：缩略图展示不正确，跟原文展示的不一样

### 排查结论

**这个我实测了，结论比较意外：缩略图的渲染几何是**正确**的。**

用同一页、同一相对尺寸，在两种 scale 下测内容边界：

| 渲染 | 内容边界 | 左边距 | 下边距 |
|---|---|---|---|
| 页1 @227%（主页面） | `54,39→1281,1643` | 3.9% | 8.6% |
| 页1 @缩略图 scale | `4,3→111,142` | 3.3% | 8.3% |
| 页2 @227% | `163,38→1225,1701` | 11.7% | 5.3% |
| 页2 @缩略图 scale | `13,3→106,146` | 10.8% | 5.8% |

**比例完全一致** → 缩略图**没有裁切、没有拉伸变形**。
页 2 左边距大是因为 PDF 本身有旋转的 arXiv 侧栏（占 11% 宽度）——
主页面看上去也是一样的。

**但确实有 3 个真实的缺陷**：

#### 缺陷 A：1px 的尺寸错位 + `object-fit: contain` → 出现白边

- 包的 `thumbnailSpec`（`core/thumbnail/plan.ts`）算出 `height = Math.round(pageHeight * scale)` = **155**
- 宿主渲染出的 canvas 是 `Math.ceil(viewport.height)` = **156**
- `<img>` 的 CSS 是 `width:120px; height:155px`，而图片原始是 **120×156**
- CSS 还有 `border: 1px` → 内容区变成 **118×153**
- `object-fit: contain` → 图片被缩到 117.7×153 → **上下各 0.15px、左右 0.15px 的白边**

**结果**：缩略图看起来"比原图多了一圈白框" → 视觉上"跟原文不一样"。

#### 缺陷 B：缩略图没有 DPR 感知，在高 DPI 屏上是糊的

- 主页面：`canvas.width = viewport.width * min(DPR, 2)` → 清晰
- 缩略图：`canvas.width = ceil(viewport.width)` = 120px（**没乘 DPR**）
- 屏上显示 120 CSS px，在 DPR=2 的屏上需要 240 物理像素 → **2 倍模糊**

#### 缺陷 C：JPEG 0.7 的有损压缩 + dataURL 的内存开销

- `toDataURL('image/jpeg', 0.7)` → 有损
- 18 页 × 每张 dataURL（~5KB）→ 还好；但 500 页 × 缩略图就会占不少内存
- 缩略图本该是"缩略"，用 JPEG 0.7 尚可；但**小尺寸下 JPEG 的块效应明显**

### 修复方案

#### 改动 1：包统一尺寸口径，宿主按包给的尺寸渲染（消除 1px 错位）

**核心问题**：包算 `height` 用 `round`，宿主渲染用 `ceil` → 不一致。

**方案**：包在 `thumbnailSpec` 里**明确给出宿主要的画布尺寸**：

```ts
export interface ThumbnailSpec {
  /** 渲染画布宽（px）——宿主应直接用这个值作为 canvas.width */
  width: number;
  /** 渲染画布高（px） */
  height: number;
  /** 渲染 scale */
  scale: number;
}
```

并统一用 **`Math.ceil`**（画布尺寸必须向上取整，否则会裁掉内容）。

同时 `<img>` 的 CSS 尺寸**必须与图片原始尺寸一致** →
要么都用 ceil，要么都用 round。**统一用 ceil**（与 canvas 一致）。

#### 改动 2：宿主渲染缩略图时用 DPR（清晰）

demo 的 `renderThumbnail` 改成：

```ts
const ratio = Math.min(window.devicePixelRatio, 2);
canvas.width = Math.ceil(viewport.width * ratio);
canvas.height = Math.ceil(viewport.height * ratio);
const context = canvas.getContext('2d');
context.setTransform(ratio, 0, 0, ratio, 0, 0);   // ← 关键
await page.render({ canvas, canvasContext: context, viewport }).promise;
```

**注意**：pdf.js v6 **必须传 `canvas` + `viewport`**（实测：不传 viewport 会报
`Cannot read properties of undefined (reading 'transform')`）。

**包这边**：`<img>` 的 CSS 尺寸仍是逻辑尺寸（120×155），
图片是 2 倍物理像素 → 浏览器自动缩放 → **清晰**。

#### 改动 3：去掉 `object-fit: contain` + border，改用 `object-fit: fill` 或精确尺寸

- `object-fit: contain` 是为了防止图片比例与盒子不符时变形
- 但既然我们保证了尺寸精确一致，就该用 **`fill`**（或干脆不设 object-fit）
- border 改成用 `box-shadow: 0 0 0 1px` 画在**外侧**，不占内容区

#### 改动 4（可选）：缩略图用 PNG 还是 JPEG？

- JPEG 0.7：小尺寸下块效应明显，文字糊
- PNG：文字锐利，但内存大 3-5 倍
- **推荐**：JPEG 0.85 或 WebP（体积小、质量好）

**但这属于宿主的选择**（包不该管编码格式）。demo 里改成 `image/webp, 0.85` 即可。

### 测试计划

- 单测：`thumbnailSpec(612, 792, 120)` → `height === 156`（ceil，不是 round）
- E2E：缩略图 `<img>` 的 `naturalWidth/Height` === CSS `width/height`（**不再有 1px 错位**）
- E2E：缩略图内容边界比例 === 主页面内容边界比例（误差 < 2%）

---

## 实施顺序建议

| 顺序 | 内容 | 理由 |
|---|---|---|
| 1 | **Bug 3**（白屏） | 最影响可用性，且改动会牵动 `useVisiblePages` 的架构 |
| 2 | **Bug 2**（缩放） | 与 Bug 3 耦合（都要动缩放流程） |
| 3 | **Bug 4**（搜索高亮） | 独立功能，但工作量最大（要新增几何计算 + 渲染） |
| 4 | **Bug 1**（缩略图） | 影响最小，改动最简单 |

---

## 附：文本层精准定位（已完成）

**问题**：框选文字时，选区框和看到的字对不上。

**根因（4 个叠加）**：
1. **主因**：把一行里所有 pdf.js text item **合并成一个 span**，只用第一个 item 的
   `left/top/fontSize`。实测同一行有 x=72.78/96.62/112.38、字号 6.78/6.78/4.56 三个 item，
   合并后 span 宽 6686px（真实只占 ~118pt）→ 浏览器当连续等宽文字渲染 → 选区框错位
2. **字号用 `transform[3]`**（字体渲染矩阵的垂直分量，含 ascent/descent 缩放，≠字号）
   → 改用 `item.height`
3. **宽度让浏览器按系统字体估算**（与 PDF 内嵌字体不同）→ 显式设 `item.width`
4. CSS `overflow:hidden` 裁掉边缘 item + `opacity:0.25` 让选中高亮变淡

**修复**：
- `core/text-layer/layout.ts` 新增 `layoutTextItems()` —— **一个 item 一个片段**，
  每个片段用自己的 `left/top/width/fontSize`，按 `(top, left)` 排序
- `components/TextLayer.tsx` 改为逐 item 渲染 span，显式设 `width`
- CSS：`overflow: visible`、去掉 `opacity`

**验证**：
- 单测 +5 例（每个 item 保留自己的几何 + 排序）→ **234 passed**
- 新增 E2E `e2e-selection-align.mjs`：**7/7**
  - 选区起点与文字起点 Δ = **0.0px**
  - span 宽 176.53px vs 渲染宽 176.5px（PDF 宽度精确生效）
