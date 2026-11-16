# 第五轮方案：选区错位 / 精度 / 卡顿 / 高亮叠加（2026-11-16 傍晚）

> 全部基于**真实 PDF 实测**（`Agent引擎.pdf`，230% 缩放，Chromium）
> 状态：**只给方案，未写实现**

---

## 摘要

用户报了 5 个现象。逐个实测后，结论是 **1 个是真 bug、3 个是实现缺陷、1 个是浏览器行为**：

| # | 现象 | 实测结论 | 性质 |
|---|---|---|---|
| 1 | `::selection` 错位 | 选区框高 **44px**，字形只有 **22px** → 上下各多 11px | **真 bug**（行盒 ≠ 字形） |
| 2 | 只能选择整行整段 | 字符级选择**其实是准的**（实测 `"n"` 只选 1 个字符）；"整行"是浏览器对**跨行拖选**的原生行为 | **部分误解 + 视觉放大** |
| 3 | 卡顿 | **有哨兵 17.1ms/步 vs 无哨兵 2.5ms/步 = 7 倍** | **真 bug**（哨兵移动触发全层重排） |
| 4 | 高亮区域叠加 | 自绘选区层**从不清除** → 旧选区一直残留 | **真 bug** |
| 5 | 高亮后 `::selection` 没去掉 | 加高亮后选区仍激活 → 自绘层继续叠在高亮上 | **真 bug** |

---

## 问题 3（最影响体验）：卡顿 —— 7 倍差距

### 实测

用 CDP 派发原生鼠标事件（排除 Playwright 的开销）：

```
拖动(有自绘选区层): 50 步 856ms = 17.1ms/步
拖动(已移除哨兵):   50 步 123ms =  2.5ms/步     ← 7 倍差距
基线(空白拖动):     50 步 862ms
```

**DOM 操作本身很快**（不是瓶颈）：

| 操作 | 耗时 |
|---|---|
| 哨兵移动（`insertBefore`） | 0.001 ms/次 |
| `getClientRects()`（小范围） | 0.002 ms/次 |
| `getClientRects()`（整页 323 个 rect） | 0.20 ms |

### 根因

`useTextSelection` 的 `selectionchange` 处理器**每次都把哨兵 `insertBefore` 到选区边界**：

```ts
parent.insertBefore(end, reference ?? null);
```

而哨兵的 CSS 是：

```css
.scpdf-text-layer__end {
  position: absolute;
  inset: 100% 0 0;      /* ← 宽 = 整个文本层宽 (1408px), 高 0 */
  z-index: -1;
}
```

**每次拖动都移动一个 1408px 宽的绝对定位元素**
→ 浏览器要重算整个 text layer 的布局 → **每一步 17ms**。

### 修复方案

**S3.1 哨兵改成"跟随"而不是"移动 DOM"**

把哨兵的**位置**用 CSS 变量控制，而不是改 DOM 结构：

```ts
// 改前: 移动 DOM 节点 (触发重排)
parent.insertBefore(end, reference ?? null);

// 改后: 只改 top (只触发重绘, 不重排)
end.style.top = `${offsetY}px`;
```

> 绝对定位元素的 `top` 变化 → **只重绘，不重排**（不影响兄弟节点的位置）。

**S3.2 哨兵改成 `position: absolute` + `width: 0`**

```css
.scpdf-text-layer__end {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;          /* ← 不要 1408px 宽 */
  height: 0;
  z-index: -1;
}
```

**S3.3 `selectionchange` 里只在需要时动**

```ts
// 只有当哨兵的目标位置**真的变了**才更新
if (end.style.top !== nextTop) {
  end.style.top = nextTop;
}
```

**S3.4 更彻底：直接不要哨兵**

实测哨兵的作用是"防止在空白处拖选时选区扩到文本层末尾"。
但它带来的 7 倍卡顿**不值这个代价**。

**决策**：保留哨兵但改成 **CSS 变量驱动**（S3.1 + S3.2 + S3.3），
保留 pdf.js 的行为但去掉重排。若实测仍慢，再走 S3.4。

---

## 问题 1：`::selection` 错位（框比字高一倍）

### 实测

对同一处选中，比较**选区矩形**与 **canvas 上真实字形像素**：

```
选区 rect:  t=345, h=44
字形墨迹:   355 ~ 377  (只有 22px 高)
→ 上边多 10px，下边多 12px
```

### 根因：浏览器的选区矩形 = **字体的自然行盒**，不是字形高度

**实测证明**（改 CSS 完全无效）：

| 尝试 | 选区高度 | 字形高度 |
|---|---|---|
| 当前（`line-height: normal`） | 44px | 22px |
| `line-height: 1` | 44px | 22px |
| `line-height: 0.9` | 44px | 22px |
| `line-height: 1` + `height: 1em` | 44px | 22px |
| `line-height: 1` + `display: inline` | 44px | 22px |
| 显式 `height: 33px` + `overflow: hidden` | 44px | 22px |

**为什么改不动**：span 是 `position: absolute` → 浏览器用**字体的自然行盒**
（ascent + descent + lineGap）来画选区矩形，**CSS 的 `line-height`/`height` 管不着**。

### 修复方案：**自己裁剪**（不再依赖浏览器的选区矩形）

**S1.1 用 font metrics 算出字形实际高度**

我已经有 `font-metrics.ts`（canvas `measureText`）→ 能拿到 `fontBoundingBoxAscent/Descent`：

```ts
// 字体自然行盒 vs 字形墨迹高度
const fontHeight = ascent + descent;              // 浏览器用它画选区矩形
const glyphHeight = actualBoundingBoxAscent + actualBoundingBoxDescent;  // 真实墨迹
```

**S1.2 自绘层按字形高度裁剪**

```ts
// 每个 rect 的上下各裁掉 (fontHeight - glyphHeight) / 2
const trim = (fontHeight - glyphHeight) / 2;
rect.top += trim;
rect.height -= trim * 2;
```

**实测验证**（需要先量出真实字形高度）：
- 当前字形高 22px，字体行盒 44px → 每边裁 11px
- 裁完后选区框 = 22px，**贴合字形**

**S1.3 或者：干脆自己算选区矩形，完全不用 `getClientRects()`**

我已经有 `PositionedTextItem`（每个 text item 的精确几何：left/top/fontSize/scaleX）。
→ **用字符偏移直接算出选区矩形**，不依赖浏览器。

**优点**：
- 框高 = 字体的 `fontHeight`（PDF 里的字体高度）→ **与 canvas 渲染的字完全一致**
- 不受浏览器行盒规则影响
- 可以精确到**字形**（用 PDF 的字体 bbox）

**代价**：要处理"选区跨 item、跨行"的情况（已有 `mapRangeToItems` 可以复用）。

> **推荐 S1.3**（更彻底、更准）。
> **备选 S1.1+S1.2**（改动小，裁剪现有的矩形）。

---

## 问题 2："只能选择整行整段"

### 实测结论：**字符级选择其实是准的**

| 操作 | 选中的内容 | 判定 |
|---|---|---|
| 在字符 "n" 内部拖 8px | `"n"`（startOffset=1, endOffset=2） | ✅ **精确到字符** |
| 双击单词 | `"An "` | ✅ 精确到词 |
| 在一个 span 内拖 | `"Haoni"`（w=59px，不是整个 span 的 149px） | ✅ 精确 |

**"整行整段"的真实来源**：**浏览器对跨行拖选的原生行为** —— 拖过中间的行时，
那些行会被**整行选中**（实测：`left=116 → right=1305`，整行）。

```
top=345 left=787  right=1026   ← 第一行：从 60% 到行尾 ✅ 精确
top=498 left=116  right=1305   ← 中间行：整行 ❌ 浏览器行为
top=528 left=497  right=630    ← 末行：到 30% ✅ 精确
```

### 为什么会**看起来**更糟

**中间行是多个 span**（"Haoning Wang" / "*" / "Mingxun Zhang" / "*" ...），
每个 span 又产生 **2 个重叠的 rect**（正文 + 上标，高度不同）。

→ 自绘层要把这些 rect 合并 → 合并后**中间行被连成一大片**。

**实测**：38 个原始 rect → 34 个 clip rect，面积 49665 ≈ 原始 49667（覆盖正确）。
所以**覆盖是对的**，但**视觉上**因为每行有多个小块、且行高 44px（比字高 22px），
看起来像"整行整段"。

### 修复方案

**S2.1 先修问题 1（行高裁剪）→ 视觉立刻改善**

行高从 44px 裁到 22px → 每行的高亮从"粗条"变成"贴合文字的细条"。

**S2.2 合并算法改进：按"视觉行"分组后再逐段合并**

现在的 `mergeOverlappingRects` 只跟 `merged[last]` 比较 → 同行的多个小块
可能被合并成一大片。改成：

```ts
// 先按 y 分组成"视觉行", 再在行内按 x 合并相邻/重叠的
```

**S2.3 明确"中间行整行选中"是浏览器行为，不改**

> ⚠️ **决策**：中间行整行选中是 **Chrome 的原生行为**，
> 所有 PDF 阅读器（Chrome 内置、Acrobat、WPS）都一样。
> **我们不应该改**（要改就得接管整个选区逻辑，用户体验反而更差）。
> 通过 S2.1 + S2.2 让它**看起来**更精确即可。

---

## 问题 4 & 5：高亮叠加 + 高亮后 `::selection` 没去掉

### 实测

```
选中后:   { layers: 1, rects: 1 }     ← 正常
取消后:   { layers: 1, rects: 1 }     ← ❌ 旧选区还在！
再选后:   { layers: 1, rects: 1 }     ← 被替换
```

加完高亮后：
```
{ selLayer: 1, selRects: 1, selText: "\"Shangha\"" }   ← ❌ 选区还激活着
```

### 根因

`PdfViewer` 里 `setSelectionShapes` **只在 `handleSelectionClientRects` 里调用**，
**从不清除**：

```tsx
const handleSelectionClientRects = useCallback((rects) => {
  ...
  setSelectionShapes(() => { ... });     // ← 只设置，从不设置成空
}, [...]);
```

而 `onSelectionChange(null)`（选区被取消）时**没有清 shape**。

### 修复方案

**S4.1 选区清空时同步清 shape**

```tsx
const handleSelectionChange = useCallback((selection) => {
  setCurrentSelection(selection);

  if (!selection || selection.text.trim().length === 0) {
    setPopoverOpen(false);
    setPopoverAnchor(null);
    setSelectionShapes(new Map());      // ← ★ 补上：清空自绘层
    onSelectionChange?.(selection);
    return;
  }
  ...
}, [...]);
```

**S4.2 加高亮后主动清选区**

`onHighlight` 触发时（宿主确认高亮）→ 清选区 + 关浮层：

```tsx
onHighlight={({ text, color, position }) => {
  handleHighlightCreate({ ... });
  setSelectionShapes(new Map());   // ← 清掉蓝色选区
  handlePopoverClose();
}}
```

> **但**：`onHighlight` 是**宿主**的回调 → 清选区应该由**包**做，
> 不能指望宿主调 `clearSelection()`。
> → **S4.1 才是根治**（选区一被取消就清）。
> S4.2 作为"高亮后立即清"的额外保障。

**S4.3 `useTextSelection` 暴露 `clearSelection` 给 PdfViewer**

目前 `useTextSelection` 返回了 `clearSelection`，但 `PdfViewer` 没用它。
→ 高亮后调 `clearSelection()` → 触发 `onSelectionChange(null)` → shape 被清。

**S4.4 高亮块叠在高亮层上时的 z-order**

现在 `.scpdf-selection-layer` 的 `z-index: 2`，`.scpdf-annotations` 在后面（z-index 更高）。
→ 高亮在选区之上 ✅ 没问题。
但**同一处的两个用户高亮**会完全重叠（实测 3 个高亮位置完全相同）
→ 这是**数据问题**（demo 用了 stale selection），不是渲染问题。
→ demo 侧要用 `selection.norm`（当前的），而不是缓存的。

---

## 实施顺序

| 步骤 | 内容 | 风险 | 验证 |
|---|---|---|---|
| **S4.1** | 选区清空时清 shape（修高亮叠加） | 低 | E2E：取消选区后 layer=0 |
| **S4.3** | 高亮后 `clearSelection()`（修 ::selection 不去掉） | 低 | E2E：高亮后 selText='' |
| **S3.1-3.3** | 哨兵改 CSS 变量驱动，去掉 DOM 移动（修卡顿） | 中 | E2E：拖动 50 步 < 5ms/步 |
| **S1.3** | 自己算选区矩形（用 text item 几何，不用 getClientRects）（修错位） | **高** | E2E：选区框高 ≈ 字形高（误差 < 3px） |
| **S2.2** | 合并算法按视觉行分组（改善视觉） | 中 | E2E：视觉对比 |

---

## 需要你确认

1. **选区框的高度**：你希望是
   - (a) **贴合字形**（22px，跟 PDF 的字体 bbox 一致）← 我推荐
   - (b) 保持行盒高度（44px，浏览器原生行为）
2. **中间行整行选中**：确认**不改**（浏览器原生行为，Chrome/Acrobat/WPS 都一样）？
3. **卡顿修复的取舍**：
   - (a) 哨兵改成 CSS 变量驱动（保留 pdf.js 行为，去掉重排）← 推荐
   - (b) 直接去掉哨兵（最简单，但空白处拖选会选出一大片空白）
