# 第 13 轮（用户 6 条反馈） / 第 13 轮补完：对着 PLAN-ROUND13.md 做了一次逐行审计

> 本轮记录已从 `DEVLOG.md` 拆出。

## 第 13 轮（用户 6 条反馈）

### ① 缩略图 / 目录打开时，PDF 自动缩放（和 WPS 一致）

**用户反馈**："缩略图或者文档目录打开的时候 右侧的pdf自动缩放 跟wps保持一致"

**根因（三个叠在一起）**：

1. `initialFitScaleRef.current = scale` 记的是**过期**的 scale
   → 初始适配被误判成"用户手动缩放" → `userZoomedRef` 挡住了重新适配
   → **删掉这两个 ref**，改成显式的 `fitMode` 状态（`'width' | 'page' | null`）
2. `useSelectionPreservation` 返回 `{ save }`（**每次渲染都是新对象**）
   → `handleZoomChange` → `applyScale` → `setScale` → `zoom` 每次都变
   → ResizeObserver 的 effect 每次都重跑 → `lastWidth` 被重置
   → **宽度变化永远检测不到**
3. `useZoom` 同样返回新对象字面量

**修法**：**所有 hook 的返回值都用 `useMemo` 包住**
（`useSelectionPreservation` / `useCurrentPage` / `useTextSelection` /
`useVisiblePages` / `useZoom`）

**实测**：

```
初始:  scale=230% containerW=1384 pageW=1408
开缩略图: scale=180% containerW=1139 pageW=1102  ← 页宽刚好铺满（差 19px）
关缩略图: scale=220%   ← 量化到 10% 步进的漂移
```

**测试**：`scripts/e2e-sidebar-fit.mjs`（10 项）

---

### ② 解释"适应宽度" vs "适应页面"

**用户反馈**："适应宽度和适应页面的区别是什么"

- **适应宽度**：`(容器宽 - 32) / 页宽` → **页宽铺满容器**，高度溢出（要上下滚）
- **适应页面**：`min((容器宽-32)/页宽, (容器高-32)/页高)` → **整页都看得见**，两边有留白

两者都会记 `fitMode` → **容器尺寸变了会自动重适配**（开面板、拖窗口）；
但**用户手动缩放之后就不再自动覆盖**（`fitMode` 变成 `null`）。

---

### ③ 性能优化（"目前还是会觉得卡顿"）

**实测（优化前）**：

```
30 步拖动: 1485ms（49.5ms/步）
  脚本: 620ms  布局: 2ms  样式: 4ms
CPU profile: 18.2% drawImage ← ⚠️ canvas 在重画！
```

**根因 ①：canvas 被反复重画**

```tsx
<PageCanvas onRenderError={(e, p) => { onError?.(...); }} />  // ❌ inline 箭头函数
```

→ 每次渲染都是新函数 → `PageCanvas` 的 `useEffect` 依赖它
→ **每次渲染都重跑 effect** → **canvas 重新渲染**
→ 拖动选区时每一步都在重画 PDF

→ 提成 `useCallback`（`handlePageRenderError`）

**根因 ②：`React.memo` 失效（整页重渲染）**

拖动选区 → `PdfViewer` 重渲染 → **18 个 `<Page>` 全部重渲染**
→ 每个 Page 的 `TextLayer`（451 个 span）都要 React 协调一遍

→ `Page` 用 `React.memo` 包住
→ **前提：所有 props 都是稳定引用**
- `onRenderError` → `useCallback` ✓
- `onInternalLink` → **改成带 pageNumber 的签名**
  （之前是 inline 箭头函数 → 每次新引用 → memo 失效）
- `viewport={{ width, height }}` → `useMemo`

**根因 ③：`collectPages` 遍历所有 span**

→ `range.intersectsNode(span)` 会**遍历 DOM 树** → 每次 `selectionchange` 都跑一遍
→ 改成**先用矩形粗筛候选页**，只对候选页做 `intersectsNode`
→ ⚠️ 粗筛**不能**每次 `getBoundingClientRect()`（会强制重排，反而更慢）

**实测（优化后）**：

```
30 步拖动: 633ms（21.1ms/步）   ← 快 2.4 倍
  脚本: 144ms                    ← 快 4.3 倍
CPU profile: 84.2% idle        ← CPU 基本空闲
```

**一个重要结论**：**包的计算开销 ≈ 0**

```
withPkg:    17.6ms/步
withoutPkg: 17.6ms/步   ← 拦掉包的 selectionchange 监听，结果一样
```

→ 剩下的是**浏览器自己的** `selectionchange` + rAF 成本 → **不是包造成的**

---

### ④ 修复多行选择漏选（"中间有的没有底色"）

**实测（修复前）**：

```
nativeCount: 14   （浏览器选了 14 个矩形）
drawnCount:  6    （只画出来 6 个）
uncovered:   7    （7 个矩形没有底色！）← 用户看到的"漏选"
```

**根因：拖动范围过滤太严格**

浏览器会把选区**扩展到行首 / 词边界**：

```
拖动:  x=487 → 607
选区:  x=108 → ...      ← 左边整行都被包进来了（差 380px！）
```

→ 之前按"**和拖动范围有重叠**才保留"过滤 → **行首那部分全被丢掉**
→ 中间的行就没底色了

**修法：改成"离群才丢"**（阈值 `OUTLIER_DISTANCE = 450px`）

| 场景                 | 距离   | 结果                         |
| -------------------- | ------ | ---------------------------- |
| 浏览器扩展到行首     | ~380px | **保留**（是用户选的那一行） |
| 页边戳（另一个离群） | ~780px | **丢掉**（不是那一行的内容） |

**顺带澄清一个我自己的误判**

我一度以为"基线表是视口坐标，矩形是页内坐标"→ 加了一次换算
→ **Δtop 从 0.01px 变成 4px**（候选挑错）

实测证明：**`item.top` / `item.left` 本来就是"页内坐标"**
（`tx = viewport ∘ item` 把 PDF 单位映射到页像素，页元素本身就是页像素宽）
→ **不需要换算** → 已还原，并把结论写进注释

**测试**：单测 +1（共 407）、E2E `scripts/e2e-selection-coverage.mjs`（5 项）

---

### ⑤ 导出带高亮的 PDF（不是 JSON）

**用户反馈**："导出高亮我的意思是直接导出带高亮的pdf不是导出json"

新增 `core/export/export-pdf.ts` → `exportHighlightedPdf()`
写的是**真正的 PDF 高亮批注**（`/Subtype /Highlight`）：
Acrobat / Preview / Chrome / Edge 都能看到，**也能点开看原文**。

**关键设计：pdf-lib 是可选依赖**

- `optional peerDependency` + **动态 import**
- 不用导出的宿主：**不用装**（那段代码不会被打包进去 → 0 体积）
- 用导出的宿主：`npm i pdf-lib`
- 也可以自己传：`exportHighlightedPdf({ pdfLib })`

**踩的坑（都记进代码注释）**：

1. `setAnnots` 的高层对象**没有 `QuadPoints` 字段**，而且 `/QuadPoints`
   **必须挂在批注上**（不是页上）→ 改用**底层 API 手写批注字典**
2. **pdf-lib 的 `PDFArray.push()` 只接受一个参数** → `push(a,b,c,d)` 只 push 了第一个
   → 读回来是 `[ 10 ]` → `asRectangle()` 报错
3. 数组必须先 `context.register()` 再 `set`（否则被包成"1 个元素的数组"）
4. `Uint8Array` 可能是**更大的 buffer 的一段** → 必须 `buffer.slice(byteOffset, ...)`

**顺带加的**：`PdfViewerHandle.getPageSizesPt()`（宿主导出时需要每页的点尺寸）

**测试**：单测 9 项（含**真 pdf-lib 往返**）、E2E `scripts/e2e-export-pdf.mjs`（9 项）

⚠️ **E2E 不能只搜原始字节** —— 真实 PDF 用**对象流压缩** → 批注在压缩流里
→ 必须**用 pdf-lib 读回来**看真正的批注

---

### ⑥ 支持跨页选择

**用户反馈**："现在不能跨页选择 我需要有跨页选择的功能"

**实测（修复前）**：

```
选中文本长度: 2553   ← 浏览器**选中了**跨页的文字
选区层数: 0          ← 但自绘层是空的 → 用户什么都看不到
```

**根因 ①：跨页选区的共同祖先是"页容器"**

```
单页选区: commonAncestorContainer = .scpdf-page      ✓
跨页选区: commonAncestorContainer = .scpdf-pages     ← 两者都不是！
```

→ 旧逻辑 `if (!inTextLayer && !inPage) return false;` → **整个选区被丢弃**
→ 加第三种情况：**在页容器里也算合法**

**根因 ②：缓冲区外的页没挂文本层**

→ 浏览器的选区**到不了没挂文本层的页**（只给一个"整页大矩形"）
→ `Page` 新增 `renderCanvas?: boolean`
→ `PdfViewer` 新增 `textLayerPages`：可见页 **±2 页**都挂 `<Page>`
→ 缓冲区内的页**只挂文本层，不挂 canvas**（canvas 要重绘 PDF，很贵）

**实测（跨第 1/2 页拖选）**：

```
选中 44 字；第 1 页 2 个矩形，第 2 页 4 个矩形
```

**已知限制（浏览器行为）**：拖动**超出视口**时浏览器会**自动滚动**
→ 布局在拖动中变化 → 那一页给的是"整页大矩形" → 画不出逐行底色

**测试**：E2E `scripts/e2e-cross-page-selection.mjs`（6 项）

---

## 验证

- `pnpm verify`: **8/8 全绿**
- `pnpm test`: **416 passed**（34 个文件）
- E2E: **294/295**（唯一失败是**基线同样失败**的面板开合定位，非本轮引入）

---

---

## 第 13 轮补完：对着 PLAN-ROUND13.md 做了一次逐行审计

### 为什么要审计

前一轮把 5 个问题都实现了，但**没有逐条对照计划核验**。
这次拿计划文件逐条对源码 + E2E 实测 → 发现 **4 处功能缺口 + 4 处真 bug**。

### 审计结论（逐项）

| 项                        | 结论           | 说明                                                                            |
| ------------------------- | -------------- | ------------------------------------------------------------------------------- |
| 1 高亮后清选区 + 高亮浮层 | PASS           | 三管齐下、**顺序**（先清原生选区后关浮层）、锚点用高亮矩形、删除按钮条件渲染    |
| 2 面板打开时右偏          | PASS           | `getBoundingClientRect()` 差值（**故意不加 scrollLeft**，见下）                 |
| 3 切换文档残留            | PARTIAL → 已补 | 缺 `setActiveSearchIndex(-1)`；缺宿主侧持久化                                   |
| 4 主题 + appearance       | PARTIAL → 已补 | 7 套主题完整；**缺 `slots` prop**、`accentColor` 等、`showPageNumber` 是死 prop |
| 5 打印                    | PARTIAL → 已补 | CSS 全套；**打印时页还是绝对定位**（真 bug）、`usePrint` 没接线                 |

---

### 缺口 1：`slots` prop（方案 D）完全没做

计划的"具体要新增的 #4"明确写了要做。
之前只有 `Toolbar` 自己的 `leftSlot` / `rightSlot`（**已有的 toolbar 配置**）
→ 计划要的 `slots={{ toolbar, panel, pageOverlay }}` → **0/3 实现**。

**实现**：

- `core/theme/index.ts` → `PdfViewerSlots`
  - ⚠️ 类型用 `unknown` 而不是 `ReactNode` → **core 层保持零 React 依赖**（core 的铁律）
- `PdfViewer.tsx` → `slots` prop
  - `toolbar` 给了 → **整个替换**内置 `<Toolbar>`
  - `panel` 给了 → **整个替换**内置 `<ThumbnailPanel>` / `<OutlinePanel>`
  - `pageOverlay` 可以是**函数** → 按页号调用

**测试**：E2E `scripts/e2e-slots.mjs`（7 项，全绿）

```
插槽态: {"hostToolbar":1,"builtinToolbar":0,"hostPanel":1,"builtinPanel":0,"overlay":18,"pages":18}
PASS **内置工具栏被替换掉了** - 0 个
PASS **插槽 `pageOverlay` 每页都渲染** - 18 / 18 页
```

### 缺口 2：appearance 的 `accentColor` / `fontFamily` / `fontSize` + 死 prop `showPageNumber`

grep 全仓库确认：`showPageNumber` **只在类型里声明**，从没被读过 → **传了完全没效果**。

**修法**：

- `themeClasses` 产出 `scpdf-root--no-page-number` / `scpdf-root--show-page-number`
  → CSS 控制工具栏的翻页器
- 新增 `appearanceStyles()` → **任意值走内联 CSS 变量**
  （class 表达不了任意数值）

```ts
pageRadius: 8        → --scpdf-radius-page: 8px
accentColor: '#f00' → --scpdf-color-primary: #f00
fontFamily: '...'    → --scpdf-font-family: ...
fontSize: 14         → --scpdf-font-size: 14px
```

### 缺口 3：`setActiveSearchIndex(-1)`

计划明确要求 `-1`（"没有激活命中"），代码用了 `0`。

→ `activeSearchIndex` 是 **0-based** 的数组下标
→ `0` 意味着"第 0 个命中是激活的" → **语义不对**
→ `-1` → `searchHits[-1]` 是 `undefined` → 返回 `null` → 渲染无差异，语义正确

### 缺口 4：宿主侧的高亮持久化

之前只有内存态 + 手动 JSON 导入导出 → **刷新即丢**。

新增 `demo/src/highlight-store.ts`：

| 函数                     | 作用                                  |
| ------------------------ | ------------------------------------- |
| `loadHighlights(id)`     | 用包的 `importHighlights` 读 + 校验   |
| `saveHighlights(id, hs)` | 用包的 `exportHighlights` 写          |
| `createDebouncedSaver()` | **防抖 500ms** → 连续操作合并成一次写 |

⚠️ **包不碰存储**（边界）→ 换后端只改这一个文件
⚠️ 读失败 / 配额满 / 隐私模式 → **静默降级**

**测试**：E2E `scripts/e2e-highlight-persist.mjs`（7 项，全绿）

```
PASS **高亮落到了 localStorage**
PASS **存储的是包的格式**（version / documentId / highlights / exportedAt）
PASS **刷新后高亮还在**（持久化生效）
PASS **切换文档后高亮是"那一份"**（隔离生效，不是残留）
PASS **切回原文档 → 高亮还在**
```

---

### bug 1：打印时页还是绝对定位 → **重叠 / 丢页**（最严重）

**实测（修复前）**：

```
position: absolute; top: 16px / 1854px / 3691px …   ← 18 页各自定位
```

→ 打印时：

1. 18 个**绝对定位**的页 → 浏览器按绝对位置分页 → **重叠 / 大量空白页**
2. 绝对定位的页**不撑开父元素** → 打印流里只剩第一页的位置 → **后面的页全丢**

**修复**：打印 CSS 里 `position: static` + `top: auto`

**实测（修复后）**：

```
position: static
rectTop: 8 / 1842 / 3675 / 5509 / 7342   ← 依次排列，没有重叠 ✅
```

**回归测试**：E2E `e2e-print.mjs` **+2 项**（12 → **14 项**）

### bug 2：`transform: scale()` 不改变布局盒 → 每页后面多一截空白 → **空白页**

旧的 `margin-bottom: calc((scale - 1) * 100%)` **根本收不回空白**
（`margin` 的百分比是**相对宽度**的，不是高度）。

**修复**：**同时把 `height` 缩掉**

```css
height: calc(var(--scpdf-page-height, 100%) * var(--scpdf-print-scale, 1));
```

`--scpdf-page-height` 由 `usePrint` 在打印前**逐页**写好
（PDF 每页可以不同尺寸 → 必须逐页写）。

### bug 3：`usePrint` 从没被包内用；内联版打印后**不恢复缩放**

→ `PdfViewer` 改用 `usePrint({ pageSizePt, paper: 'A4' })`
→ 顺手修 `usePrint` 的 3 个问题：

1. `margin` **对象**在依赖数组里 → 宿主传字面量 → `print` 每次都是新函数
   → 拆成 4 个 number 依赖
2. `onAfterPrint` **会调两次**（`afterprint` + `setTimeout` 兜底谁先谁后）
   → 加 `restored` 标志 → **只恢复一次**
3. `onAfterPrint` 放进 **ref**（避免 inline 箭头函数进依赖）

### bug 4：高亮操作条的锚点**滚动后过期**

`measureHighlightRect` 只在点击时算一次 → 滚动 / 缩放后浮层脱离高亮块。
而 `SelectionPopover` 的实时校正轮询在"外部锚点"模式下是**跳过的** → 不会自愈。

**修复**：新增 effect → **滚动 / 缩放 / 换页时重算锚点**（rAF 节流 + 只在真变了才 setState）

---

### 其他

- **打印隐藏规则加 `!important`** → 宿主自己的 CSS 特异度可能更高 → 工具栏会被打出来
- **暗色主题补 `--scpdf-radius-page`** → 之前暗色下沿用 `:root` 的 2px → 和 `contrast`/`minimal` 不一致
- **`HighlightDoc.highlights` 类型 `unknown[]` → `HighlightRecord[]`**
  → 宿主不用再写 `doc.highlights as HighlightRecord[]`（demo 里那行断言删了）
  → 运行时**仍然逐条校验**
- **修掉一条与实现不符的注释**（写着 `removeAllRanges()`，实际是 `collapseToStart()`）

---

### 测试基准的坑：垂直基准不能用"行盒"

之前 E2E 一直有 **1 项失败**（"有面板：选区块位置正确" Δ上=5），
而且**基线也同样失败** → 一直当成"既有问题"放着。

这次定位到是**测试的基准错了**：

```
clientTop = 321.19   ← 行盒（浏览器给的）
spanTop   = 326.00   ← 字形（文字实际的位置）
drawnTop  = 326.20   ← 自绘块 ✅ 贴着字形（差 0.2px）
```

→ 自绘块是**刻意贴着字形**的（这样高亮块和文字才对齐）
→ 和行盒比 → **天然差 2~5px** → 那是**正常的**
→ 而且这个差值**和面板开不开无关**（是字体的固有行高）

→ 基准改成**被选中的文字 span 的 top** → Δ上 从 2/5/2 变成 **0/0/0**

---

## 验证

- `pnpm verify`: **8/8 全绿**
- `pnpm test`: **416 passed**（34 个文件）
- E2E: **311/311 —— 0 个套件失败**（第一次全绿）

---
