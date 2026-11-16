# 高亮错位 + 高亮效果 方案（先不动代码）

> 排查时间：2026-11-16 · 依据：真实 PDF（`Agent引擎.pdf`）+ pdf.js v6.4.299 官方 CSS + 原 scholar-club 实现
> 状态：**只给方案，未写实现**

---

## 问题 1：高亮错位严重 + 挡住文字（不透明）

### 1.1 排查结论：错位的根因是**双重缩放**

实测数据（真实 PDF，230% 缩放，拖选 "Shanghai Artificial Intelligence"）：

| 量 | 值 |
|---|---|
| 选区（浏览器给的） | `left=272, top=171, w=151, h=14` |
| 选区页内坐标 | `left=264, top=58` |
| 高亮的 inline style | `left: 279.374px; top: 146.104px; width: 155.51px; height: 13.1686px;` |
| 高亮的 transform | **`transform: scale(2.3)`** ← 元凶 |

**问题在 `AnnotationLayer.tsx:160`**：

```tsx
style={{
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
  // 缩放时同步（高亮块是纯色，不缩放字体）
  transform: `scale(${scale})`,      // ← ← ← 这里
  transformOrigin: 'top left',
}}
```

而 `rect.left/top/width/height` **已经是从归一化坐标换算出来的视口 px**
（`AnnotationLayer.tsx:70-82`：`norm.x1 * viewport.width / norm.width`）。

→ **已经是当前缩放下的像素尺寸了，再乘一次 `scale(2.3)` 就是双重缩放。**

**验证**：高亮的 `top` 最终渲染在 `146.104 × 2.3 = 336px`，
而选区实际在 `58px` → **偏了 278px**。这就是"错位严重"。

**同款 bug 在搜索高亮里也有**（`AnnotationLayer.tsx:133` 同样有 `transform: scale(...)`）。

**为什么会写成这样**：早期版本 `rect` 是**参考尺寸下的 px**（不是视口 px），
所以需要 `scale()` 拉伸。后来 `viewport` 换算改成"直接乘比例"，
`transform: scale()` 就**忘了删** —— 两套缩放机制并存。

### 1.2 顺带发现的第二个错位源：`reference` 是硬编码的 A4

`PdfViewer.tsx:614`：

```ts
reference: { width: 595 * scale, height: 842 * scale },
```

但真实 PDF 是 **612×792pt**（Letter）。`595` 是硬编码的 A4 宽度。

`viewToNorm` 把视口 px 存进 `NormRect`，`width/height` 存"参考尺寸"。
读回时 `normToView` 按 `viewport / norm.width` 换算 —— 参考尺寸错了，
**换算比例就错了**。

> 实测这次偏差不大（因为采集与渲染用的是同一个错误值 → 自洽），
> 但一旦宿主换了纸张尺寸、或换设备读旧数据 → 高亮位置就飘。

**正确做法**：`reference` 应该是**该页的真实视口尺寸**（`pageSizes[i]`），
而不是硬编码的 A4。

### 1.3 遮挡的原因

`.scpdf-annotation--mine` 的背景是 `var(--scpdf-highlight-my)` = `#fff3bf`，
**不透明**。高亮层在 DOM 里排在 canvas **之后**（`Page.tsx:206`）→ 盖在文字上。

截图确认：选中区域是一块**纯黄色实心条**，底下的字完全看不见。

---

## 问题 2：文本层"透明"导致叠加深浅不一

### 2.1 排查结论

现在的渲染栈（从下到上）：

```
1. .scpdf-page          白色背景
2. <canvas>             真实的黑色文字
3. .scpdf-text-layer    color: transparent 的文字（看不见，但参与 ::selection）
4. .scpdf-links
5. .scpdf-annotations   高亮块（不透明）
```

**当前 `::selection` 的样式**（`viewer.css:242`）：

```css
.scpdf-text-layer ::selection {
  background: rgba(47, 84, 235, 0.28);
}
```

**问题**：浏览器把 `::selection` 的背景画在**文本层 span 上**（第 3 层），
而真正的黑字在 **canvas 上（第 2 层）**。选区背景是半透明的 →
**canvas 的黑字 + 半透明蓝 = 灰蓝色**，看起来"发虚、字变淡了"。

而**没被选中的部分**是纯黑字 → 对比之下，选中区域"颜色更深/发灰"。

> 用户说的"两层叠加起来中间有更深的地方"就是这个：
> **canvas 的字（黑）+ selection 背景（半透明蓝）叠在一起**。

### 2.2 成熟实现怎么做的（pdf.js v6.4.299 官方 CSS）

我读了 `pdfjs-dist@6.4.299/web/pdf_viewer.css` 的原文：

**（a）pdf.js 的 find-in-page 高亮**（`:709`）：

```css
.textLayer .highlight {
  --highlight-bg-color: rgb(180 0 170 / 0.25);        /* ← 25% 不透明度 */
  --highlight-selected-bg-color: rgb(0 100 0 / 0.25);
  margin: -1px;
  padding: 1px;
  background-color: var(--highlight-bg-color);
  border-radius: 4px;
}
```

**关键**：**25% 不透明度** + **圆角 4px** + `margin:-1px; padding:1px`（向外扩 1px）。

**（b）pdf.js 的选区**（`:759`）：

```css
.textLayer ::selection {
  background: rgba(0 0 255 / 0.25);
  background: color-mix(in srgb, AccentColor, transparent 50%);   /* ← 50% 透明 */
  color: transparent;                                              /* ← 文字仍透明 */
}
```

**（c）pdf.js v6 的"selectionRendering"模式**（`:765` + `:6341`）：

```css
.textLayer.selectionRendering ::selection {
  background: transparent;      /* ← 关掉浏览器的原生选区 */
  color: transparent;
}

.pdfViewer .page .selection {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  background: rgb(0 90 255 / 0.22);      /* ← 22% 蓝，用 SVG clip-path 挖出选区形状 */
}
```

这是 pdf.js v6 的**最终形态**：
- 关掉浏览器原生 `::selection`
- 用 `range.getClientRects()` 算出选区形状
- 画成 SVG `<clipPath>` → 一个 22% 蓝的覆盖层，**只覆盖选中的字形区域**
- 覆盖层在 canvas **之上**，但因为只有 22% 不透明度 → **字依然清晰可读**

### 2.3 原 scholar-club 的做法（WPS 风格的关键）

`scholar-club-new/src/pages/Chat/PdfSection/PageCom/style.ts:21`：

```ts
::selection {
  background-color: #0d68bd3d;      /* 24% 透明的蓝 */
  mix-blend-mode: multiply;         /* ← ★ 关键 */
  line-height: inherit;
}
```

**`mix-blend-mode: multiply` 就是 WPS/Word 高亮笔的核心**：
- 正片叠底 → 高亮色与底下颜色**相乘** → 黑色字仍是黑色，背景被染色
- 效果 = 真实荧光笔涂在纸上，字完全清晰

**这就是"文字在高亮下面"的效果来源。**

---

## 修复方案

### 改动 1（必做）：删掉高亮的 `transform: scale()`

**文件**：`src/components\AnnotationLayer.tsx:133` 和 `:160`

```tsx
// 改前
style={{
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
  transform: `scale(${scale})`,        // ← 删掉
  transformOrigin: 'top left',
}}

// 改后
style={{
  left: `${rect.left}px`,
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
}}
```

**为什么这样就对了**：`rect` 已经是视口 px（当前缩放下的最终尺寸），
直接用就是准确的。

> **连带**：`scale` prop 在 `AnnotationLayer` 里就不再需要了 → 可以删掉 prop
> （但 `Page.tsx` 还在传，先留着更安全，二期清理）。

### 改动 2（必做）：`reference` 改成该页的真实视口尺寸

**文件**：`src/components/PdfViewer.tsx:614`

```tsx
// 改前
reference: { width: 595 * scale, height: 842 * scale },   // 硬编码 A4

// 改后：用真实页面尺寸
reference: {
  width: pageSizes[0]?.width ?? 595 * scale,
  height: pageSizes[0]?.height ?? 842 * scale,
},
```

**为什么**：`NormRect.width/height` 是"采集时的参考尺寸"，
必须与采集时的真实视口一致，否则读回时换算比例错。

> 更彻底的做法：`reference` 应该**逐页**记录（每页可能尺寸不同）。
> 但 `NormRect` 是每页独立的 → 其实每页用自己的尺寸更准。
> 这项可以放到二期。

### 改动 3（必做）：高亮**半透明** + 放在文字**下面**

**核心问题**：现在高亮层在 DOM 里排在 canvas **之后** → 盖住文字。

**方案**：把高亮拆成**两层**，或者把高亮层移到 canvas **之前**。

**推荐做法（最简单、最接近 WPS）**：

```tsx
// Page.tsx 里的顺序改成：
<>
  {/* 1. 高亮层（在 canvas 下面 —— 文字压在高亮上） */}
  <AnnotationLayer ... />

  {/* 2. canvas（真实文字） */}
  <PageCanvas ... />

  {/* 3. 文本层（可选中的替身） */}
  <TextLayer ... />

  {/* 4. 链接层 */}
  <LinkLayer ... />
</>
```

**但**：高亮需要 `pointer-events: auto`（能点）→ 放最底下会被 canvas 挡住点击。

**解决**：给高亮块**不透明背景 + 混合模式**，让它"透"出底下的字：

```css
.scpdf-annotation--mine {
  background: var(--scpdf-highlight-my);
  mix-blend-mode: multiply;      /* ← 正片叠底：字仍是黑的 */
}
```

**`mix-blend-mode: multiply` 的效果**：
- 高亮色 × 底下的颜色
- 底下的黑字 → 仍是黑（黑 × 任何色 = 黑）→ **字完全清晰**
- 底下的白纸 → 被染成高亮色 → **有荧光笔效果**

**这正是 WPS/Word 的做法**（原项目也是 `multiply`）。

**⚠️ 注意**：`mix-blend-mode` 需要元素与底层**在同一个层叠上下文**里，
且**底层不能是孤立的**（`isolation: isolate` 会切断混合）。
`.scpdf-page` 有 `position: absolute` + 背景色 → 会在页面内形成层叠上下文，
但高亮与 canvas 是**兄弟节点**，混合会作用于**整个 `.scpdf-page` 的合成结果** → 可行。

**需要验证的点**（实施时实测）：
- `mix-blend-mode` 在 `.scpdf-page` 内的混合基准（是页面背景还是页面合成结果）
- 高亮与 canvas 的 DOM 顺序对混合结果的影响

### 改动 4（必做）：`::selection` 用 WPS 风格

**文件**：`src/styles/viewer.css:242`

```css
/* 改前 */
.scpdf-text-layer ::selection {
  background: rgba(47, 84, 235, 0.28);
}

/* 改后（WPS/Word 风格） */
.scpdf-text-layer ::selection {
  background-color: rgba(13, 104, 189, 0.24);
  mix-blend-mode: multiply;      /* ← 与原项目一致 */
}
```

**为什么 `multiply` 能解决"叠加深浅不一"**：
- 不混合时：半透明蓝直接盖在黑字上 → 蓝 + 黑 = 灰蓝 → 字发虚
- 混合时：蓝 × 黑 = 黑 → **字还是黑的**，只是背景被染色 → 干净

### 改动 5（推荐）：pdf.js v6 的 `selectionRendering` 模式

**这是最"正统"的方案**，但工作量大。分两步：

**5a. 简单版（本期做）**：
- `::selection` 用 `mix-blend-mode: multiply`（改动 4）
- 效果已经接近 WPS

**5b. 完整版（可选，二期）**：
照 pdf.js v6 实现：
1. `::selection { background: transparent }`（关掉浏览器原生选区）
2. 监听 `selectionchange` → `range.getClientRects()` → 归一化到页面坐标
3. 画成 SVG `<clipPath>` → 一个 `rgb(0 90 255 / 0.22)` 的覆盖层

**好处**：
- 选区形状**精确贴合字形**（不是矩形）
- 22% 蓝 + 在 canvas 之上 → 视觉统一
- 与 pdf.js / Chrome 内置阅读器**完全一致**

**代价**：需要一个 SVG 覆盖层 + `selectionchange` 监听（React 里要注意重渲染）。

### 改动 6（推荐）：高亮块加圆角与 1px 外扩（对齐 pdf.js）

```css
.scpdf-annotation {
  border-radius: 2px;              /* 现在是 2px，pdf.js 用 4px */
}
.scpdf-annotation--mine {
  background: var(--scpdf-highlight-my);
  mix-blend-mode: multiply;
}
```

**pdf.js 的 `margin: -1px; padding: 1px`**：
高亮块向外扩 1px → 视觉上"笔触"更饱满，不像精确的矩形。
可以用 `outline: 4px solid transparent` 或伪元素实现，或直接接受矩形。

### 改动 7（可选）：高亮色板改成半透明

现在的 CSS 变量是**不透明**的：

```css
--scpdf-highlight-my: #fff3bf;        /* 不透明 */
--scpdf-highlight-others: #d6e4ff;    /* 不透明 */
```

改成**半透明**，即使没开 `mix-blend-mode` 也不会完全遮住字：

```css
--scpdf-highlight-my: rgb(255 243 191 / 0.55);
--scpdf-highlight-others: rgb(214 228 255 / 0.55);
```

**但**：这是**破坏性变更** —— 宿主如果覆盖了这些变量（按不透明色写的），
包再乘不透明度会二次处理。所以**要么靠 `mix-blend-mode`（不改变量语义），
要么在变量旁新增 `--scpdf-highlight-my-alpha`**。

**推荐**：走 `mix-blend-mode` 路线，**不动现有变量**（宿主无感）。

---

## 实施顺序

| 步骤 | 内容 | 风险 |
|---|---|---|
| **S1** | 删掉 `transform: scale()`（高亮 + 搜索高亮） | 低 —— 纯删 |
| **S2** | `reference` 改用真实页面尺寸 | 低 |
| **S3** | `::selection` 加 `mix-blend-mode: multiply` | 低 |
| **S4** | 高亮层移到 canvas **下面** + 高亮块加 `multiply` | **中** —— 需实测混合基准 |
| **S5** | 圆角 / 1px 外扩对齐 pdf.js | 低 |
| **S6**（可选） | pdf.js v6 `selectionRendering` 完整版 | 高 —— SVG clip-path |

**S4 的两种实现**（实施时按实测结果选）：

- **4a. DOM 顺序**：高亮层移到 canvas 之前 → 高亮在字下面
  - 风险：canvas 挡住高亮的点击 → 需要给 canvas `pointer-events: none`？不行（要能选中）
  - 或：把**可点击的**高亮做成一个独立的透明层（在上），**视觉的**高亮在下
- **4b. 混合模式**：DOM 顺序不动（高亮仍在上面），靠 `mix-blend-mode: multiply`
  - 黑字在 canvas 上，高亮在更上层 → **高亮 × 页面合成结果**
  - 但 canvas 的黑字是**在 canvas 里**的，高亮在 canvas **上面** → 混合时
    高亮 × (canvas + 页面背景) → **黑字仍然是黑** ✓
  - **这条更简单，且效果对**

→ **推荐 4b**：DOM 顺序不动，只加 `mix-blend-mode: multiply`。

---

## 测试计划

| 测试 | 断言 |
|---|---|
| **单测** | `AnnotationLayer` 渲染的 style **不含** `transform: scale` |
| **单测** | `reference` 用真实页面尺寸（不是硬编码 595/842） |
| **E2E（新）** | 高亮矩形的 `getBoundingClientRect()` 与被选文字的 rect **偏差 < 3px** |
| **E2E（新）** | 高亮区域的**中心像素仍是深色**（字没被遮住）→ 采样 canvas + 高亮后的像素 |
| **E2E（新）** | `::selection` 的 computed style 含 `mix-blend-mode: multiply` |
| **E2E** | 搜索高亮同样不遮挡文字、位置准确 |
| 回归 | 现有 8 套 E2E 全过 |

**"字没被遮住"的像素验证**（很实用的断言）：
```js
// 高亮区域内，canvas 的字形像素应该是深色（不是被黄色覆盖）
// 用 canvas 的 getImageData 采样高亮覆盖的字位置
```

---

## 需要你确认的两点

1. **高亮要不要能点？**（现在能点，点了会触发 `onHighlightClick`）
   - 4b 方案（只加 `mix-blend-mode`）**不影响点击** → 推荐
2. **`::selection` 的颜色**：现在蓝色 `rgba(47,84,235,0.28)`，
   原项目是 `#0d68bd3d`（更淡的蓝）
   - 建议沿用原项目的 `#0d68bd3d`（你的团队已经习惯这个色）

---

## 跑起来看效果

**命令**（在包目录）：

```sh
cd C:\work\scholar-pdf-viewer
pnpm build          # 必须先 build（demo 消费 dist）
pnpm demo           # 启动 demo
```

**打开**：http://localhost:5173 （Vite 默认端口）

**用真实 PDF 看效果**：把 PDF 放到 `C:\work\scholar-pdf-viewer\demo\public\samples\local.pdf`
（你之前那份 `Agent引擎.pdf` 应该还在 `C:\Users\hidari\Downloads\`，改名拷过去即可）

**指定端口**：
```sh
pnpm --filter @scholar-club/pdf-viewer-demo dev --port 5199
```

**⚠️ 改了 `src/` 后必须 `pnpm build` + 重启 demo** —— demo 消费 `dist/`，
Vite 对 workspace 依赖有缓存，不重启会跑到旧代码。
