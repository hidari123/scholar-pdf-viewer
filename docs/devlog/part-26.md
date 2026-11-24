# 精准选区 + 四个 Bug 修复（2026-11-16）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 精准选区 + 四个 Bug 修复（2026-11-16）

这一轮做了两件事：
1. **调研** pdf.js 官方 `TextLayer` 的完整算法，把文本层改成与之等价
2. **同步实施** 用户报的 4 个 bug

### 调研：原 scholar-club 的做法为什么"笨重"

**关键发现**：原项目的**文本层**其实是成熟实现 —— 它用 `react-pdf`，
而 react-pdf 的 `TextLayer.tsx:196` 直接调用 **pdf.js 官方的 `pdfjs.TextLayer`**：

```tsx
const cancellable = new pdfjs.TextLayer(parameters);
cancellable.render().then(() => { ... });
```

**它的「选区计算」才是笨重的**（`utils/get-client-rects.ts`）：

```ts
for (const clientRect of clientRects) {
  for (const page of pages) {
    // ← 双重循环 O(rects × pages)
    if (clientRect.width < pageRect.width) {
      // ← 靠"比页窄"猜归属页
      // ... clientRect.top + page.node.scrollTop - pageRect.top
    }
  }
}
```

问题：
1. **双重循环** —— 选 500 页文档的一段话 = 几千次几何比较
2. **靠 `width < pageRect.width` 猜页** —— 选整页时 rect 等于页宽 → **被丢弃** → 选区丢失
3. **`scrollTop` 混算** + 另一处又手工加 `offsetTop` 补偿 → **两处坐标系打架**

**结论**：它不是"算法笨"，而是**自己重造了 pdf.js 已经做好的事**，还造得不准。

### 从 pdf.js 源码提取的算法（v4.8.69 / v5.5.207 / v6.1.200 三版一致）

| 关键点    | pdf.js 的做法                                           | 我之前的做法     | 差距          |
| --------- | ------------------------------------------------------- | ---------------- | ------------- |
| span 粒度 | 一个 text item 一个 span                                | 最初按行合并一个 | ❌            |
| 字号      | `hypot(tx[2], tx[3])`（复合矩阵）                       | `item.height`    | ⚠️            |
| top       | 基线 − **实测 ascent**                                  | 基线 − 字号      | ❌ 差 15~20%  |
| 宽度      | **不设 width**，用 `scaleX(pdfWidth / measureText宽度)` | 设固定 width     | ❌            |
| 单字符    | `shouldScaleText` 判断（x/y 缩放差 > 1.5 倍才缩放）     | 没判断           | ⚠️            |
| 哨兵      | `endOfContent` + `selectionchange` 重定位               | 无               | ❌ 选区会膨胀 |

**最关键的是 scaleX**：

```js
// pdf.js #layout()
const { width } = ctx.measureText(div.textContent);
transform = `scaleX(${(canvasWidth * this.#scale) / width})`;
```

PDF 内嵌字体 ≠ 浏览器系统字体 → 不拉伸的话文字总宽度对不上 → 越往右偏得越多。
scaleX 把**整个 span 的字形**按比例拉伸 → 每个字的位置都对得上。

### 实施

**新增 `src/core/text-layer/font-metrics.ts`**：

- `measureAscentRatio`（canvas `measureText('')` 拿 ascent/descent 比例，带缓存）
- `measureTextWidth`（canvas `measureText` 实测浏览器排版宽度，带缓存）
- `guessFontFamily`（按 fontName 猜系统字体；**几何精准不受字体影响**，scaleX 会补偿）

**`layout.ts`**：复合矩阵算法（`Util.transform(viewport, item)`）+ scaleX 计算
**`TextLayer.tsx`**：逐 item 渲染 + 应用 scaleX + `endOfContent` 哨兵 + `data-page-number`
**`useTextSelection.ts`**：归页改为**按 span 归属**（去掉双重循环）+ `selectionchange` 重定位
**CSS**：对齐 pdf.js（`text-align:initial` / `text-size-adjust:none` / `forced-color-adjust:none`）

### Bug 2：缩放比例 xx4% + 中心缩放

- **比例**：`fitWidth` = `(1391-32)/612 = 2.2205` → 222%。新增 `quantizeScale`（10% 步长），
  量化在 `setScale` 内部统一做 → **显示值 == 渲染几何 == 页尺寸计算**
- **位置**：`anchorY` 从 `clientHeight/2` 改为 **0**（左上角锚点）
  → 缩放时视口左上角内容不动 → "第一排文字高度不动"

### Bug 3：缩放后白屏（已复现）

```
初始:      页1 canvas=true(1390x1799) text=161项
放大3次后: 页1 canvas=false(0x0)     text=0项    ← 白屏
```

**根因 A**：`useVisiblePages` 用 IntersectionObserver，`rootMargin: '300% 0px'`
的百分比相对 **root（滚动容器）**算，不是相对元素 → 缩放后缓冲区从 3 页骤降到 1.2 页
**根因 B**：页占位元素 `top` 在缩放时全变 → IO 的 `isIntersecting` 不跨阈值
→ **IO 不重新触发** → `visiblePages` 停在旧值 → 新进入视口的页没渲染 → 白屏

**修复**：

- 新增 `core/virtualization/visible.ts`（`computeVisiblePages` 几何法，纯函数可单测）
- **去掉 IO** → scroll（rAF 节流）/ **scale** / resize 时重算；**scale 变化后立刻重算**（核心）
- 加"渲染过就保留"的白屏兜底（`pagesToRender`）

### Bug 4：搜索无高亮

搜索本身是通的（107 个结果），但**根本没有渲染命中的代码**：

- `SearchPanel` 只显示数量，`onNavigate` 只 `scrollToPage` 不高亮
- `SearchHit` 只有 `pageNumber/text/start/length`，**没有矩形几何**

**修复**：

- 新增 `core/search/highlight.ts`：`mapRangeToItems`（字符偏移 → 文本项，
  对齐 pdf.js 的 `_convertMatches` 思路）+ `hitToRects`（部分命中按比例裁剪宽度）
- `AnnotationLayer` 加 `searchRects` prop（橙色，与用户高亮分开）
- `SearchPanel` 加 `onHitsChange`；`Page` 加 `onTextItems`
- `scrollToSearchHit` 按命中 y 精确滚动（留 100px 余量）

### Bug 1：缩略图跟原文不一样

**实测结论出乎意料**：缩略图的**渲染几何是对的**
（内容边界比例与主页面一致：页2 11.7% vs 10.8%）→ 没有裁切、没有变形。

真实缺陷是另外 3 个：

- **1px 错位**：包用 `round`(155) 而宿主 canvas 用 `ceil`(156)
  → CSS 尺寸 ≠ 图片原始尺寸 → 配合 `object-fit:contain` + `border:1px` → **四周白边**
- **无 DPR 感知**：主页面 `canvas.width = w*min(DPR,2)`，缩略图直接 `w` → 高 DPI 屏糊
- **JPEG 0.7** 小尺寸块效应明显

**修复**：`thumbnailSpec` 统一用 `ceil`（且 width/height 就是宿主该用的画布尺寸）；
宿主按 DPR 渲染 + `context.setTransform(ratio,...)`；去掉 `object-fit:contain`，
border 改用 `box-shadow` 画在外侧。

### 实施中遇到的问题（全部记录）

1. **测试环境的 canvas stub 把 measureText 写死**：`measureText: (text) => ({ width: text.length * 6 })`
   —— 不随字号变化 → 所有字号测出同一宽度 → scaleX 失真
   - 修复：stub 记录 `font` 状态，按字号算宽度 + 提供 `fontBoundingBoxAscent/Descent`
2. **`layout.test.ts` 缺 jsdom 环境** → `measureTextWidth` 返回 0 → scaleX 恒为 1
   - 修复：加 `// @vitest-environment jsdom`
3. **单字符 scaleX 的测试期望写错了**：我以为"单字符不缩放"，
   但 pdf.js 的规则是"x/y 缩放差 > 1.5 倍才缩放"→ 普通单字符（x=字号,y=字号）也不缩放，
   而 `transform=[1,0,0,12]`（x≠y）**会**缩放 → 改测试用真实的 transform
4. **搜索高亮的单位不一致（真 bug）**：文本项是**视口 px**，而分母用了 **pt**
   → 高亮框高度离谱（121px，应为 22px）→ 改用视口尺寸
5. **回调引用不稳定（真 bug）**：`onHitsChange` 是内联箭头 → `SearchPanel` 的搜索 effect
   反复重跑 → `activeIndex` 被重置为 0 → **点"下一个"没反应**
   → 改用 `useCallback` 稳定引用
6. **初始化顺序（真 bug）**：`handleSearchNavigate` 用了还没初始化的 `scrollToSearchHit`
   → `Cannot access 'scrollToSearchHit' before initialization` → 整页白屏
   → 调整声明顺序
7. **页内下标算错（真 bug）**：一个命中可能产生**多个矩形**（跨 item / 跨行），
   不能简单数命中个数 → 改为按矩形数累加
8. **适配宽度的容差**：比例量化到 10% 后，页宽不可能精确等于容器宽
   → E2E 容差从固定 40px 改为**按比例 5%**
9. **副作用**：量化后"打开侧栏 → 容器变窄 → 适配宽度过时"
   → 加 ResizeObserver：容器宽度变化且**用户没手动缩放过**时重新适配
10. **demo dev server 缓存 dist**（老坑，第 N 次）：改完 `src/` 必须 `pnpm build`
    **并重启 demo**，否则 E2E 跑的是旧代码

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**289 passed**（23 个测试文件）
- E2E（真 Chromium，真实 PDF 18 页）：**8 套全过，合计 64 项断言**
  - smoke 13/13 · text-layer 7/7 · panels 12/12 · links 5/5
  - **selection-align 9/9**（scaleX 生效证明：浏览器排版 138.52px → 拉伸后 176.54px；
    选区起点 **Δ = 0.00px**）
  - **zoom 6/6**（比例整十 ×4 + **左上角锚点 Δ = 0.0px** + 无白屏）
  - **search-highlight 6/6**（107 结果 → 37 个高亮矩形；**高亮落在文字上距离 0px**）
  - **thumbnail 6/6**（CSS 120×156 == 图片 240×311 @DPR2 → 零错位）

### 关键文件

```
src/core/text-layer/font-metrics.ts    字体度量实测（ascent / 宽度）
src/core/text-layer/layout.ts           复合矩阵 + scaleX 算法
src/core/virtualization/visible.ts      几何法可见页计算（替掉 IO）
src/core/search/highlight.ts            字符偏移 → 矩形
src/components/TextLayer.tsx            逐 item 渲染 + scaleX + 哨兵
src/hooks/useTextSelection.ts           按 span 归页 + 哨兵重定位
src/hooks/useVisiblePages.ts             几何法 + 缩放重算
src/hooks/useZoom.ts                     量化 + 左上角锚点
```

### 遗留 / 可选

- 阶段 3（主项目迁移）：按用户要求暂不进行；包已具备迁移所需能力
- AcroForm 表单填写：未实现（不在 P0/P1 范围）
- 印刷级分页（print CSS）：未实现（`onPrint` 走浏览器原生打印）
- `endOfContent` 的 Chrome 专属 `selectionchange` 重定位已实现，
  但 Firefox 的 `-moz-user-select: none` 路径未特判（Firefox 行为已正常）

---
