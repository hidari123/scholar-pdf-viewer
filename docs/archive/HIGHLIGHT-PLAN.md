# 高亮方案 v2（重叠修复 + WPS 风格 + 颜色可配置）

> 排查时间：2026-11-16 · 依据：真实 PDF 实测 + pdf.js v6.4.299 官方 CSS + 原 scholar-club 实现
> 状态：**只给方案，未写实现**

---

## 一、问题 1：选区"阶梯状重叠"（你截图里的现象）

### 实测数据（真实 PDF，230% 缩放，选 10 行）

```
浏览器返回的 rect 总数: 26
实际视觉行数:         10
每行的 rect 数分布:   { 1个rect: 2行, 2个rect: 4行, 4个rect: 4行 }
中心点被涂次数分布:   { 涂1次: 2行, 涂2次: 8行 }
```

**8 / 10 行**的选区背景被**画了两次** → 半透明蓝叠两次 → **颜色明显更深** → 阶梯状深浅不一。

### 根因：一行里有**不同字号的 span** → 浏览器产生多个行盒

实测同一行（"Haoning Wang" + 上标的 "*"）：

| rect | top | bottom | height | 覆盖的 span                              |
| ---- | --- | ------ | ------ | ---------------------------------------- |
| 1    | 498 | 521    | 23     | "Haoning Wang" (fs=22.9) + "*" (fs=17.4) |
| 2    | 494 | 524    | **30** | "Haoning Wang" (fs=22.9) + "*" (fs=17.4) |

**机制**：
1. 我的 span 是 `position: absolute; display: block` + `font-size: Npx`
2. 每一行里如果有两个**字号不同**的 span（正文 22.9px + 上标 17.4px），
   它们**各自形成一个行盒** → 浏览器 `getClientRects()` 返回**两个** rect
3. 两个 rect **垂直重叠 27px** → `::selection` 背景被**叠涂两次**
4. `rgba(47,84,235,0.28)` 涂一次 = 28%，涂两次 ≈ **48%** → 深色阶梯

**验证**：单独测一个 span（只有 scaleX）→ `getClientRects()` 只返回 **1 个** rect
→ **不是 scaleX 的问题，是"同行不同字号产生多个行盒"的问题**。

### pdf.js v6 是怎么解决的

```css
/* pdf_viewer.css:689-695 */
> :not(.markedContent) {
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
```

**关键差异**：pdf.js 用 `--font-height`（PDF 里的**字体高度**）算 `font-size`，
并且所有 span 的 **`line-height` 都是继承的 `1`**（`.textLayer { line-height: 1 }`）。

**但 pdf.js 也有同样的问题** —— 它靠 `.selectionRendering` 模式绕开：
```css
.textLayer.selectionRendering ::selection {
  background: transparent;
} /* 关掉原生选区 */
.pdfViewer .page .selection {
  background: rgb(0 90 255 / 0.22);
} /* SVG clipPath 覆盖层 */
```

→ **SVG 覆盖层每个像素只画一次** → 不可能有阶梯。

### 三个可选修法

| 方案                                        | 做法                                                                                                           | 优点                                                 | 缺点                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **A. `line-height: 0`**（推荐，已实测验证） | 给文本层 span 加 `line-height: 0` → **行盒高度归零** → 同行不同字号的 span 不再产生独立行盒 → 选区每处只涂一次 | **一行 CSS**；根治；保留浏览器原生选区；不动布局逻辑 | 行盒高度为 0 → 需要确认 `top` 定位仍准确（`position:absolute` + `top` 不依赖行盒） |
| **B. SVG 覆盖层**                           | 关掉 `::selection`，用 `getClientRects()` 画 SVG clipPath                                                      | 与 pdf.js v6 完全一致；形状贴合字形                  | 工作量大；需要 `selectionchange` 监听 + React 重渲染                               |
| **C. 降低不透明度**                         | 把 `::selection` 改成 14%（涂两次 ≈ 26%）                                                                      | 一行代码                                             | **治标不治本**；单涂的地方会太淡                                                   |

### ✅ 方案 A 已实测验证（真实 PDF，230%，选 10 行）

在页面上临时注入 `.scpdf-text-layer__item { line-height: 0 }` 后实测：

|          | rect 总数 | 视觉行数 | 每行 rect 数                | **中心被涂次数**                |
| -------- | --------- | -------- | --------------------------- | ------------------------------- |
| **改前** | 26        | 10       | {1个:2行, 2个:4行, 4个:4行} | **{涂1次: 2行, 涂2次: 8行}** ❌ |
| **改后** | 26        | 10       | {1个:2行, 2个:4行, 4个:4行} | **{涂1次: 10行}** ✅            |

**结论**：`line-height: 0` 让所有行的选区背景**只涂一次** → 阶梯状深浅彻底消失。
（rect 数不变，因为浏览器仍然返回它们，但它们的行盒高度归零 → 叠涂消失）

**视觉验证**：截图确认选区**均匀**，无深浅阶梯，文字清晰可读。

**为什么有效**：
- span 是 `position: absolute` → `top` 定位**不依赖行盒** → 位置不受影响
- 行盒高度 = `font-size × line-height` → `line-height: 0` → 行盒高度为 0
- 浏览器不再按每个字号生成不同的行盒矩形 → **只涂一次**

**推荐 A + C 组合**：
- **A** 根治（每处只涂一次）
- **C** 兜底（万一遇到更复杂的 PDF 布局，颜色差不会太刺眼）

> ⚠️ 实施时要**再验证**：`line-height: 0` 后
> - 选区起止位置是否仍精确（`e2e-selection-align` 要过）
> - 文字的 `top` 是否仍然对齐 canvas（截图比对）
> - 复制出来的文本是否正常

---

## 二、问题 2：高亮遮挡文字（不透明）

### 根因

```css
.scpdf-annotation--mine {
  background: var(--scpdf-highlight-my);
} /* #fff3bf 不透明 */
```

高亮层在 DOM 里排在 `<canvas>` **之后**（`Page.tsx:206`）→ 盖在文字上。

实测截图确认：选中区域是**纯黄色实心条**，底下的字完全看不见。

### 错位（附带发现的第二个 bug）

`AnnotationLayer.tsx:160`：

```tsx
style={{
  left: `${rect.left}px`,      // ← 已经是视口 px（换算过的）
  top: `${rect.top}px`,
  width: `${rect.width}px`,
  height: `${rect.height}px`,
  transform: `scale(${scale})`,  // ← ★ 又乘一次 → 双重缩放
}}
```

实测：选区在 `top=58px`，高亮渲染在 `146.104 × 2.3 = 336px` → **偏 278px**。

> 为什么会这样：早期 `rect` 是"参考尺寸下的 px"，需要 `scale()` 拉伸；
> 后来改成"直接乘比例"，`transform` 忘了删 → **两套缩放并存**。
> 搜索高亮（`AnnotationLayer.tsx:133`）有同款 bug。

还有 `PdfViewer.tsx:614` 的 `reference: { width: 595 * scale, height: 842 * scale }`
—— **硬编码 A4**，但真实 PDF 是 Letter（612×792）。

---

## 三、问题 3：文字层"两层叠加中间更深"

### 渲染栈

```
1. .scpdf-page          白色背景
2. <canvas>             真实的黑色文字
3. .scpdf-text-layer    color: transparent 的文字（看不见，但参与 ::selection）
4. .scpdf-links
5. .scpdf-annotations   高亮块（不透明）
```

**双重变深有两个来源**：
1. `::selection` 的半透明蓝画在**文本层（第 3 层）**，而黑字在 **canvas（第 2 层）**
   → 蓝 + 黑 = **灰蓝**，字发虚
2. 同行多个行盒 → 选区背景叠涂（问题 1）

### WPS/Word 的解法（`mix-blend-mode: multiply`）

原 scholar-club 用的就是它（`PageCom/style.ts:21`）：

```ts
::selection {
  background-color: #0d68bd3d;    /* 24% 透明的蓝 */
  mix-blend-mode: multiply;       /* ← ★ 正片叠底 */
}
```

**原理**：正片叠底 = 颜色相乘。
- 黑字 × 蓝 = **黑** → 字完全清晰
- 白纸 × 蓝 = **蓝** → 背景被染色

→ 这就是"文字在高亮下面"的荧光笔效果。

---

## 四、完整修复方案

### 阶段 1：修错位与遮挡（低风险）

| 步骤     | 内容                                                   | 文件                          |
| -------- | ------------------------------------------------------ | ----------------------------- |
| **S1.1** | 删掉 `transform: scale()`（高亮 + 搜索高亮）           | `AnnotationLayer.tsx:133,160` |
| **S1.2** | `reference` 改用该页**真实视口尺寸**                   | `PdfViewer.tsx:614`           |
| **S1.3** | 高亮块加 `mix-blend-mode: multiply`                    | `viewer.css`                  |
| **S1.4** | `::selection` 加 `mix-blend-mode: multiply` + 降到 14% | `viewer.css:242`              |

**S1.3 的效果**：不透明黄 + multiply → 黑字仍是黑 → **字清晰可见**，且**不用改 DOM 顺序**（不影响点击）。

### 阶段 2：修阶梯重叠

| 步骤     | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| **S2.1** | 文本层 span 加 `line-height: 0`（**已实测验证** → 每处只涂一次）        |
| **S2.2** | `::selection` 不透明度降到 **14%** + `mix-blend-mode: multiply`（兜底） |

### 阶段 3：颜色可配置（你的需求）

#### 3.1 `::selection` 颜色要能配置

**问题**：`::selection` 是伪元素，**不能用 CSS 变量直接改**吗？—— **可以**！

```css
.scpdf-text-layer ::selection {
  background: var(--scpdf-selection-color, rgba(47, 84, 235, 0.28));
}
```

CSS 变量在伪元素里**完全可用** → 宿主改一个变量就生效。

**新增 props**：

```tsx
/** 选区颜色（CSS 颜色值，支持 alpha） */
selectionColor?: string;
```

宿主传 `selectionColor="#0d68bd3d"` → 包内设成 CSS 变量。

**但**：用户要"自己调颜色" → 需要一个**取色器**。这个应该由**宿主**提供（UI 属于业务），
包只提供"颜色值 → 生效"的通道。

#### 3.2 高亮颜色要能配置

现在 `HighlightRecord.color` 是**语义名**（`'label-2'`），由宿主解释：

```ts
// 现在的 demo
color: highlight.color ?? 'label-6',
```

**方案**：包里存**语义 key**，宿主维护 key → 实际颜色/透明度 的映射。

**包内新增**（core，无业务）：

```ts
/** 高亮颜色方案 */
export interface HighlightPalette {
  /** 语义 key（如 'yellow' / 'green' / 'custom'） */
  key: string;
  /** CSS 颜色值 */
  color: string;
  /** 透明度（0-1） */
  opacity?: number;
}
```

**包的职责边界**（严格遵守"只做 PDF"）：
- 包**只负责**：把 `color` 渲染出来（把语义 key 映射成 CSS）
- 包**不负责**：UI（取色器、色板弹窗）、业务语义（"我的批注"/"他人批注"的含义）

**具体设计**：

```tsx
// PdfViewer 新增 prop
/** 高亮色板：语义 key → CSS 颜色。宿主可自定义/扩展 */
highlightPalette?: Record<string, string>;
```

**内置默认色板**（包内，纯视觉，无业务语义）：

```css
--scpdf-highlight-yellow: #ffd54a;
--scpdf-highlight-green:  #a5d6a7;
--scpdf-highlight-blue:   #90caf9;
--scpdf-highlight-pink:   #f48fb1;
--scpdf-highlight-purple: #ce93d8;
--scpdf-highlight-orange: #ffcc80;
```

**为什么色板放包里**：色板是**视觉**，不是业务 → 属于包。
**为什么 key 映射由宿主给**：宿主可能有"我的/他人的"语义 → 宿主传映射。

**自定义颜色的完整链路**：

```
用户在宿主取色器选了 #FF6B6B
  ↓
宿主存 { id, color: '#FF6B6B', ... }
  ↓
宿主渲染 <PdfViewer highlightPalette={{ 'h-123': '#FF6B6B', yellow: '#ffd54a', ... }} />
  ↓
包把 palette 写成 CSS 变量 → 高亮块用 var(--scpdf-highlight-h-123)
```

### 阶段 4：WPS 风格细节（可选）

对齐 pdf.js：
```css
.scpdf-annotation {
  border-radius: 4px; /* pdf.js 用 4px, 现在是 2px */
  /* 1px 外扩, 让"笔触"更饱满 */
  outline: 2px solid transparent; /* 或用伪元素 */
}
```

---

## 五、最终效果对比

|              | 现在                     | 改后                          |
| ------------ | ------------------------ | ----------------------------- |
| 高亮位置     | **偏 278px**             | 精确对齐                      |
| 高亮遮挡     | **完全不透明, 字看不见** | multiply 混合, **字清晰可见** |
| 选区颜色     | 阶梯状深浅不一           | **均匀**（每处只涂一次）      |
| 选区颜色可配 | ❌ 硬编码                | ✅ props 传入                 |
| 高亮颜色可配 | ❌ 只有语义名            | ✅ `highlightPalette` prop    |
| 高亮可点     | ✅                       | ✅（不动 DOM 顺序）           |

---

## 六、需要你确认

1. **`::selection` 的默认色**：沿用原项目的 `#0d68bd3d`（24% 蓝），还是现在的 `rgba(47,84,235,0.28)`？
   → 我建议 `#0d68bd3d`（你的团队已习惯这个色）
2. **色板的默认色**：包内置 6 个（黄/绿/蓝/粉/紫/橙）够吗？
3. **自定义颜色的存储**：由宿主存（包只给通道），对吧？

---

## 七、跑起来的命令

```sh
cd C:\work\scholar-pdf-viewer
pnpm build     # 必须先 build（demo 消费 dist）
pnpm demo      # 启动
```

**当前已经跑着一个**：**http://localhost:5193**（已加载 `Agent引擎.pdf`，18 页）

指定端口：
```sh
pnpm --filter @scholar-club/pdf-viewer-demo dev --port 5199
```

> ⚠️ 改了 `src/` 必须 `pnpm build` **并重启 demo** —— Vite 对 workspace 依赖有缓存。

---

## 八、实施顺序与验证（确认后执行）

| 步骤     | 内容                                                | 验证                                    |
| -------- | --------------------------------------------------- | --------------------------------------- |
| **S1.1** | 删 `transform: scale()`                             | E2E：高亮矩形与文字偏差 < 3px           |
| **S1.2** | `reference` 用真实页面尺寸                          | 单测 + E2E                              |
| **S1.3** | 高亮块 `mix-blend-mode: multiply`                   | E2E：高亮区中心像素仍是深色（字没被遮） |
| **S1.4** | `::selection` 加 multiply + 14%                     | E2E：computed style 检查                |
| **S2.1** | span 加 `line-height: 0`                            | E2E：**每行选区只涂一次**（新增断言）   |
| **S3**   | 颜色可配置（`selectionColor` + `highlightPalette`） | 单测 + demo 取色器 UI                   |
| **S4**   | 圆角 4px + 1px 外扩（对齐 pdf.js）                  | 截图对比                                |

**回归**：现有 8 套 E2E（64 项断言）必须全绿。
