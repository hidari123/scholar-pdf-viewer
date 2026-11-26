# 精准选区方案（对齐 pdf.js / react-pdf 的成熟做法）

> 调研时间：2026-11-16
> 参考实现：**pdf.js 官方 `TextLayer`**（`pdfjs-dist` v6.4.299）
> 参照项目：`react-pdf` 9.2.1（原 scholar-club 用的就是它）

---

## 一、调研结论：原 scholar-club 的做法为什么"笨重"

### 1.1 它的文本层其实是「成熟实现」

`scholar-club-new/src/pages/Chat/PdfSection/PageCom/index.tsx:21`：

```ts
import 'react-pdf/src/Page/TextLayer.css';
```

而 `PageWrapper.tsx` 用的是 react-pdf 的 `<Page renderTextLayer />` →
react-pdf 的 `TextLayer.tsx:196` 直接调用 **pdf.js 官方的 `pdfjs.TextLayer`**：

```tsx
const cancellable = new pdfjs.TextLayer(parameters);
cancellable.render().then(() => { ... });
```

**所以：它的选区是准的，因为文本层由 pdf.js 生成，不是我手写的。**

### 1.2 它的「选区计算」才是笨重的部分

`scholar-club-new/src/pages/Chat/PdfSection/utils/get-client-rects.ts`：

```ts
const clientRects = Array.from(range.getClientRects());

for (const clientRect of clientRects) {
  for (const page of pages) {                        // ← 双重循环：每个 rect × 每页
    const pageRect = page.node.getBoundingClientRect();

    if (
      clientRect.width > 0 &&
      clientRect.height > 0 &&
      clientRect.width < pageRect.width &&            // ← 靠"比页窄"来猜是不是这一页
      clientRect.height < pageRect.height
    ) {
      const highlightedRect = {
        top: clientRect.top + page.node.scrollTop - pageRect.top,
        left: clientRect.left + page.node.scrollLeft - pageRect.left,
        ...
      };
    }
  }
}
```

**问题**：
1. **双重循环** O(rects × pages) —— 选 500 页文档的一段话 = 几千次几何比较
2. **靠 `width < pageRect.width` 猜归属页** —— 选整页时 rect 等于页宽 → **被丢弃** → 选区丢失
3. **`scrollTop` 混算** —— 依赖 `page.node.scrollTop`，一旦容器结构变化就错位
4. `useTextSelection.ts:56-62` 又手工加 `offsetTop`/`offsetLeft` 补偿 → **两处坐标系打架**

**结论**：它不是"算法笨"，而是**自己重造了 pdf.js 已经做好的事**，还造得不准。

---

## 二、pdf.js 官方的做法（核心）

### 2.1 一个 text item 一个 span

pdf.js 的 `#appendText(geom)` **每个 item 建一个 `<span>`** —— 与我上一轮实施的
`layoutTextItems()` 方向一致

### 2.2 关键：字号用 `Math.hypot(tx[2], tx[3])`，不是 `item.height`

pdf.js v6 `pdf.mjs:15201`：

```js
const tx = Util.transform(this.#transform, geom.transform);
const fontHeight = Math.hypot(tx[2], tx[3]); // ← 变换后的矩阵列向量模长
const fontAscent = fontHeight * TextLayer.#getAscent(fontFamily, style, this.#lang);
```

- `tx` = **视口变换 ∘ 文本矩阵**（复合后的结果）
- `fontHeight` = 复合矩阵的**垂直分量模长**
- `fontAscent` = fontHeight × **字体的 ascent 比例**（用 canvas `measureText` 实测）

`#getAscent`（`pdf.mjs:15912`）：

```js
const ctx = this.#getCtx(lang);
this.#ensureCtxFont(ctx, DEFAULT_FONT_SIZE, fontFamily);
const metrics = ctx.measureText('');
let ascent = metrics.fontBoundingBoxAscent;
let descent = Math.abs(metrics.fontBoundingBoxDescent);
const ratio = ascent / (ascent + descent); // ← 比例，缓存
```

**⚠️ 与我上一轮做法的差异**：
- 我用 `item.height * viewportScale`
- pdf.js 用 `hypot(tx[2], tx[3])`（复合矩阵）+ **ascent 比例**

`item.height` 与 `hypot(tx[2],tx[3])` 在多数情况下接近，但 pdf.js 的做法**更严谨**
（考虑了文本矩阵自身的缩放）。

### 2.3 关键：位置 = 基线 − ascent（不是基线 − 字号）

pdf.js `pdf.mjs:15203-15207`：

```js
if (angle === 0) {
  left = tx[4];
  top = tx[5] - fontAscent; // ← 用 ascent，不是 fontHeight
}
```

**为什么用 ascent**：浏览器的行盒（line box）是从**字体基线向上到 ascent、向下到 descent**
决定的，不是从基线向上 fontHeight。用 fontHeight 会整体偏低（字号和 ascent 通常差 15-20%）。

### 2.4 关键：宽度用 `scaleX` 强制对齐（这是精准的精髓）

pdf.js `#layout(params)`（`pdf.mjs:15836`）：

```js
const { canvasWidth, fontSize } = properties;
TextLayer.#ensureCtxFont(ctx, fontSize * this.#scale, fontFamily);
const { width } = ctx.measureText(div.textContent); // ← 浏览器量出的实际宽度

if (width > 0) {
  transform = `scaleX(${(canvasWidth * this.#scale) / width}) ${transform}`;
}
```

**算法**：
1. 用**同一个字体、同一个字号**在离屏 canvas 上 `measureText` → 得到浏览器认为的宽度 `width`
2. 算出缩放比 `canvasWidth * scale / width`
3. 用 `transform: scaleX(ratio)` 把 span **横向拉伸/压缩到 PDF 的真实宽度**

**为什么这是关键**：
- PDF 内嵌字体（如 Times New Roman）与浏览器系统字体**度量不同**
- 不做 scaleX → 浏览器排出来的文字**总宽度**与 PDF 不同 → 越往右偏得越多
- 做了 scaleX → 每个 span 的**右边界精确落在 PDF 的右边界** → 选区框与 canvas 上的字**逐字对齐**

**这就是"精准"的来源** —— 我上一轮只做了"固定 width"（用 `item.width`），
那只能保证**边界**对齐，span **内部**的字仍然按系统字体排布；
pdf.js 的 scaleX 是把**整个 span 的字形**按比例拉伸，**每个字的位置**都对。

### 2.5 什么时候需要 scaleX（pdf.js 的判断）

pdf.js `pdf.mjs:15816`：

```js
let shouldScaleText = false;
if (geom.str.length > 1) {
  shouldScaleText = true; // 多字符 → 要对齐
} else if (geom.str !== ' ' && geom.transform[0] !== geom.transform[3]) {
  const absScaleX = Math.abs(geom.transform[0]);
  const absScaleY = Math.abs(geom.transform[3]);
  if (
    absScaleX !== absScaleY &&
    Math.max(absScaleX, absScaleY) / Math.min(absScaleX, absScaleY) > 1.5
  ) {
    shouldScaleText = true; // 单字符但被非等比缩放
  }
}
```

**单字符 + 无变形 → 不 scaleX**（scaleX=1 时没必要；而且单字符 scaleX 会有舍入误差）

### 2.6 其它细节

| 点                | pdf.js 做法                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| **字体**          | 用 PDF 的 `fontName` 映射到系统字体（`style.fontFamily`）；`sans-serif`/`monospace` 特殊映射           |
| **旋转文字**      | `angle = atan2(tx[1], tx[0])`；`transform: rotate(deg)` + `left/top` 用三角函数补偿                    |
| **垂直文字**      | `style.vertical` → `angle += PI/2`，`canvasWidth = geom.height`                                        |
| **hasEOL**        | 每个 item 后插一个 `<br role="presentation">`                                                          |
| **markedContent** | 嵌套 `<span class="markedContent">`                                                                    |
| **CSS**           | `.textLayer span { color: transparent; position: absolute; white-space: pre; transform-origin: 0 0; }` |
| **DPR**           | `this.#scale = viewport.scale * devicePixelRatio`（measureText 用 DPR 缩放的字号）                     |
| **最小字号**      | `#minFontSize`（浏览器最小字号，通常 0）→ `fontSize = minFontSize * fontHeight`                        |
| **选择高亮**      | `.textLayer .highlight { margin: -1px; padding: 1px; background: var(--highlight-bg-color); }`         |

---

## 三、方案：包内自建「pdf.js 等价」的文本层

### 3.1 架构决策

| 方案                                          | 评价                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| **A. 直接用 pdf.js 的 `TextLayer`**           | 包会依赖 pdfjs-dist → **违反"包不依赖 pdf.js"的边界** ❌ |
| **B. 包内自建，算法对齐 pdf.js**              | 包保持零 pdf.js 依赖，宿主注入字体信息  **推荐**         |
| C. 维持现状（我上一轮的逐 item + 固定 width） | 边界准但字形位置仍偏 → 不够准 ⚠️                         |

**推荐 B**：包内实现 pdf.js 的**算法**（ascent + scaleX），
但**不引入 pdf.js 依赖** —— 需要的两个输入由宿主注入：

1. **ascent 比例** → 需要 `measureText`（浏览器原生 API，包内可做，不需要 pdf.js）
2. **字体族** → 需要 PDF 的 `fontName` → 宿主注入（宿主有 pdf.js，能拿 `commonObjs` 的字体信息）

### 3.2 宿主需要额外注入什么

```ts
// PdfViewer 新增 prop
/** 每页的字体信息（pageNumber → fontName → {family, vertical?}） */
getFontInfo?: (pageNumber: number) => Promise<Record<string, FontInfo>>;
```

但这会让宿主接线变复杂。**更简单的做法**：

**降级方案（推荐先做）**：宿主**不注入字体**，包用**通用字体族**
（`sans-serif` / `serif` / `monospace`，按 `fontName` 关键词猜测）。

**为什么可行**：
- scaleX 的作用是"把浏览器排出来的字拉伸到 PDF 宽度" —— **只要浏览器字体和 PDF 字体的**
- **总宽度**对得上，**每个字的位置**就自然按比例对上了
- 用哪个系统字体不影响**总宽度对齐**（scaleX 会补偿掉差异）
- 只影响**字形外观**（看起来像不像），不影响**选区几何**

**这就是关键洞察**：
> **几何精准** ← scaleX（宽度对齐）
> **视觉相似** ← 字体族（可选增强）

所以包的**默认行为就能做到几何精准**，字体只是锦上添花。

### 3.3 具体实现

#### 改动 1：`core/text-layer/layout.ts` —— 引入 ascent 与 scaleX

```ts
/** 字体信息（可选，宿主注入） */
export interface FontInfo {
  /** CSS font-family */
  family: string;
  /** 是否垂直书写 */
  vertical?: boolean;
}

/** 排版结果 */
export interface PositionedTextItem {
  text: string;
  left: number;
  top: number;
  fontSize: number;
  /** PDF 真实宽度（px） */
  width: number;
  /** 横向缩放比（浏览器字体宽度 → PDF 宽度） */
  scaleX: number;
  /** 旋转角度（rad） */
  angle: number;
  hasEOL: boolean;
}
```

**新增工具**：

```ts
// core/text-layer/font-metrics.ts（新增）
/** 用离屏 canvas 实测字体的 ascent 比例 */
export function measureAscentRatio(fontFamily: string): number;

/** 用离屏 canvas 实测某段文字的宽度 */
export function measureTextWidth(text: string, fontFamily: string, fontSize: number): number;
```

**为什么 ascent 比例必须实测**：浏览器字体与 PDF 内嵌字体的 ascent 不同。
用 canvas `measureText('')` 拿 `fontBoundingBoxAscent / (fontBoundingBoxAscent + fontBoundingBoxDescent)`。

**为什么宽度必须实测**：只有知道浏览器排出来的实际宽度，才能算出 scaleX。
（`item.width` 是 PDF 里的宽度，不是浏览器的）

#### 改动 2：`layoutTextItems` 的新算法

```ts
export function layoutTextItems(
  content: TextContentLike,
  viewport: TextViewportLike,
  options: { fontFamily?: string; fontMap?: Record<string, FontInfo> } = {},
): PositionedTextItem[];
```

**每个 item 的计算**：

```
1. tx = viewport.transform ∘ item.transform        （复合矩阵）
2. fontHeight = hypot(tx[2], tx[3])                  （复合后的垂直分量模长）
3. ascentRatio = measureAscentRatio(family)           （缓存）
4. fontAscent = fontHeight * ascentRatio
5. left = tx[4]
   top  = tx[5] - fontAscent
6. fontSize = fontHeight
7. browserWidth = measureTextWidth(item.str, family, fontSize)   （缓存 by 文本）
   scaleX = browserWidth > 0 ? (item.width * viewportScale) / browserWidth : 1
```

**关键**：`scaleX` 的分子是 **PDF 的真实宽度 × 视口缩放**，
分母是**浏览器实测宽度** → 拉伸后浏览器排出的字宽度 == PDF 里的宽度。

**缓存**：`measureTextWidth` 按 `(text, family, fontSize)` 缓存 —— 同一行很多重复词，
实测很快；缓存后整页只测几十次。

#### 改动 3：`components/TextLayer.tsx` —— 应用 scaleX

```tsx
<span
  className="scpdf-text-layer__item"
  style={{
    left: `${item.left}px`,
    top: `${item.top}px`,
    fontSize: `${item.fontSize}px`,
    fontFamily: item.fontFamily,
    transform: item.scaleX !== 1 ? `scaleX(${item.scaleX})` : undefined,
    transformOrigin: 'left top',
  }}
>
```

**注意**：有了 scaleX，**不再需要固定 `width`** ——
scaleX 已经保证了总宽度；固定 width 会与 scaleX 叠加导致二次缩放。

#### 改动 4：CSS 对齐 pdf.js

```css
.scpdf-text-layer {
  position: absolute;
  inset: 0;
  line-height: 1;
  text-align: initial; /* pdf.js 有这行 —— 防止继承宿主 text-align */
  text-size-adjust: none; /* pdf.js 有这行 —— 防止移动端字体缩放 */
  forced-color-adjust: none; /* pdf.js 有这行 */
  transform-origin: 0 0;
  user-select: text;
  cursor: text;
}

.scpdf-text-layer__item {
  position: absolute;
  color: transparent;
  white-space: pre;
  margin: 0;
  transform-origin: 0 0;
  caret-color: var(--scpdf-color-primary);
}
```

**`text-align: initial` 很重要**：如果宿主有 `text-align: center`，
绝对定位的 span 也会被影响 → 位置全错。

#### 改动 5：`useTextSelection` —— 选区提取用 pdf.js 的方式

**保持 `range.getClientRects()`**（这是对的），
但**修正归页逻辑**（借鉴 pdf.js 的 `TextHighlighter`）：

pdf.js 的做法（`web/pdf_viewer.js` 的 `TextHighlighter`）：
1. 遍历 `textDivs`（每个 text item 对应的 span）
2. 用 `range.intersectsNode(span)` 判断哪些 span 被选中
3. 对被选中的 span，**用 span 自己的几何**（不是 `getClientRects`）
4. 处理**部分选中**的 span：按选中字符比例裁剪宽度

**我们的做法**（更简单且够用）：

```ts
// 每个 span → 它自己的矩形；被部分选中的 → 按比例裁剪
for (const span of selectedSpans) {
  const rect = span.getBoundingClientRect();
  // 完全选中 → 用整块
  // 部分选中 → 用 range.getClientRects() 里与它相交的部分
}
```

**为什么改**：现在的实现是「先拿全部 rects，再按 `width < pageRect.width` 猜页」
—— 这正是 scholar-club 的笨重做法。
改成「**先按 span 归属页**（span 上有 `data-page-number`），再取几何」
→ O(spans) 单次遍历，无双重循环，无猜测。

### 3.4 宿主接线（新增的部分）

```tsx
// 宿主可选注入字体信息（不注入也能几何精准）
getFontInfo?: (pageNumber: number) => Promise<Record<string, { family: string; vertical?: boolean }>>;
```

**不注入时的降级**：包按 `fontName` 关键词猜字体族：
- 含 "mono" → `monospace`
- 含 "serif" 且不含 "sans" → `serif`
- 否则 → `sans-serif`

**为什么这样够用**：scaleX 补偿了字体差异 → **几何精准不受影响**。

### 3.5 测试计划

| 测试                      | 断言                                                                    |
| ------------------------- | ----------------------------------------------------------------------- |
| 单测 `measureAscentRatio` | 返回 0 < r < 1；同字体缓存后一致                                        |
| 单测 `measureTextWidth`   | 非空文本 → 宽度 > 0；空串 → 0                                           |
| 单测 `layoutTextItems`    | `scaleX` = PDF 宽 / 浏览器宽；`top` = 基线 − ascent                     |
| 单测                      | `hasEOL` 保留；排序按 (top, left)                                       |
| **E2E（核心）**           | **选中的 3 个字，其选区框的每个字边界都与 canvas 上的字边界误差 < 2px** |
| **E2E（核心）**           | 选一段跨行文字，选区 rect 数量 == 期望的行数                            |
| E2E                       | 选整页（宽度 ≥ 页宽）→ **不被丢弃**（这是 scholar-club 的 bug）         |
| E2E                       | 中文选区：起点 Δ < 3px                                                  |

---

## 四、四个 Bug 的同步实施

### 实施顺序（Bug 3 → 2 → 4 → 1，精准选区穿插其中）

| 步骤   | 内容                                              | 依赖                   |
| ------ | ------------------------------------------------- | ---------------------- |
| **S1** | 精准选区：ascent + scaleX（core + 组件 + CSS）    | —                      |
| **S2** | 选区提取重写：按 span 归页（去双重循环）          | S1                     |
| **S3** | Bug 3 白屏：去 IO → 几何计算 + 白屏兜底           | —                      |
| **S4** | Bug 2 缩放：左上角锚点 + scale 量化               | S3（都要动缩放流程）   |
| **S5** | Bug 4 搜索高亮：hitToRects + AnnotationLayer 渲染 | S1（要复用文本层几何） |
| **S6** | Bug 1 缩略图：ceil 统一 + DPR + 去 contain        | —                      |
| **S7** | 全部 E2E 复跑 + DEVLOG + commit                   | —                      |

每步一个 commit，每步有测试。

---

## 五、预期效果

### 选区精度

| 指标                        | 现在                         | 目标                       |
| --------------------------- | ---------------------------- | -------------------------- |
| 选区起点 Δ                  | 0.0px（已修）                | 0.0px（保持）              |
| **span 总宽度 vs PDF 宽度** | 176.5 vs 176.53 ✓            | ✓（scaleX 后**完全**一致） |
| **每个字的边界**            | ❌ 按系统字体排布 → 逐渐偏移 | ✅ **误差 < 2px**          |
| 中文选区                    | ⚠️ 系统字体与 PDF 不同       | scaleX 补偿                |
| 整页选中                    | ❌ 可能被丢弃                | ✅ 保留                    |

### 四个 Bug

| Bug            | 修复后                                                       |
| -------------- | ------------------------------------------------------------ |
| **1 缩略图**   | 尺寸零错位（ceil 统一）+ DPR 清晰 + 无白边                   |
| **2 缩放**     | 比例整十（220% 而非 222%）+ **左上角锚点**（第一排文字不动） |
| **3 白屏**     | 缩放后视口内的页**都有 canvas**；不再出现空白页              |
| **4 搜索高亮** | 搜索命中在页面上**显示高亮矩形** + 结果列表可点击跳转        |
