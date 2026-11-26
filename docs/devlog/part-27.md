# 高亮效果重做（2026-11-16 下午）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 高亮效果重做（2026-11-16 下午）

用户报了两个问题：**高亮错位严重** + **高亮挡住文字**，
另外截图显示**选区有阶梯状深浅不一**。这一轮全部修掉。

### 问题 1：高亮错位 —— 双重缩放

**实测**（真实 PDF，230%）：

```
选区实际在:   top=58px
高亮渲染在:   146.104 × 2.3 = 336px     ← 偏了 278px
```

`AnnotationLayer.tsx:160` 的 `transform: scale(${scale})` ——
而 `rect.left/top/width/height` **已经是从归一化坐标换算出来的视口 px**
（`norm.x1 * viewport.width / norm.width`）→ **不需要再乘一次 scale**。

> **为什么会写成这样**：早期 `rect` 是"参考尺寸下的 px"，需要 `scale()` 拉伸；
> 后来改成"直接乘比例"，`transform` 忘了删 → 两套缩放机制并存。
> 搜索高亮（`AnnotationLayer.tsx:133`）有同款 bug。

**修复**：删掉两处 `transform: scale()`。

### 问题 2：选区坐标双重扣减（新发现）

修完双重缩放后，高亮**水平对齐了**（Δ 0.3px），但**垂直还差 97px**。

**排查过程**：

1. 选区 rect 是**视口坐标**（`getClientRects()`）
2. `pageFrames` 的 `top` 是**滚动内容坐标**（`pageTops[]`）
3. 代码把两者都减了 `containerRect.top` → **减了两次**

```ts
// ❌ 改前
const frames = pageFrames.map(f => ({ ...f, top: f.top - containerRect.top, ... }));
const rects  = clientRects.map(r => ({ top: r.top - containerRect.top, ... }));
//    ↑ containerRect.top 被减了两次 → 正好差 97px（容器的视口 top）

// ✅ 改后：统一换算到"容器内容坐标"
const toContentCoords = (v: number) => v - containerRect.top + container.scrollTop;
```

**修复后实测**：6 个高亮块与选区 rect **逐行 Δ = 0.0px**。

### 问题 3：阶梯状深浅不一（选区叠涂）

**实测**（选 10 行）：

```
浏览器返回 26 个 rect，实际只有 10 个视觉行
每行 rect 数: {1个: 2行, 2个: 4行, 4个: 4行}
中心被涂次数: {涂1次: 2行, 涂2次: 8行}   ← 8/10 行被叠涂!
```

**根因**：一行里有两个**不同字号**的 span（正文 22.9px + 上标 17.4px），
它们**各自形成一个行盒** → `getClientRects()` 返回多个**垂直重叠 27px** 的 rect
→ `::selection` 背景被**逐个 rect 绘制** → 重叠区涂两次
→ `28%` 的蓝叠两次 ≈ `48%` → **阶梯状深浅不一**。

**排除 scaleX**：单独测一个 span（只有 scaleX）→ `getClientRects()` 只返回 **1 个** rect。

**修复（一行 CSS，已实测验证）**：

```css
.scpdf-text-layer__item {
  line-height: 0;
}
```

|      | 中心被涂次数                    |
| ---- | ------------------------------- |
| 改前 | {涂1次: 2行, **涂2次: 8行**} ❌ |
| 改后 | **{涂1次: 10行}** ✅            |

**为什么有效**：行盒高度 = `font-size × line-height` → 归零 → 同行不同字号不再产生独立行盒。
**为什么不影响位置**：span 是 `position: absolute`，`top` 定位**不依赖行盒**。

**试过但没用的方案**：

| 方案                                   | 结果                                |
| -------------------------------------- | ----------------------------------- |
| `line-height: normal` / `1`            | maxPaint = 2 ❌（问题回来了）       |
| `line-height: 0` + `padding-top: 20px` | maxPaint = 2 ❌（padding 又撑出盒） |
| `line-height: 0.001`                   | maxPaint = 1 ✅ 但高度只有 0.016px  |

> **pdf.js v6 自己也有这个问题** —— 它靠 `.selectionRendering` 模式绕开
> （关掉原生 `::selection`，改用 SVG clipPath 画 `rgb(0 90 255 / 0.22)` 覆盖层）。
> 我们用 `line-height: 0` 更简单，代价是 span 盒子高度为 0
> → Playwright 的 `waitForSelector`（要求"可见"）会超时 → E2E 改用 `waitForFunction`。

### 问题 4：高亮遮挡文字 → `mix-blend-mode: multiply`

高亮层在 DOM 里排在 `<canvas>` **之后**，而背景 `#fff3bf` **不透明** → 完全遮住字。

**解法**（原 scholar-club 也是这么做的，`PageCom/style.ts:21`）：

```css
.scpdf-annotation {
  mix-blend-mode: multiply;
}
```

**原理**：正片叠底 = 颜色相乘

- 底下的**黑字** × 高亮色 = **黑** → 字完全清晰
- 底下的**白纸** × 高亮色 = 高亮色 → 荧光笔效果

**为什么不动 DOM 顺序**：高亮要能点（`onHighlightClick`）→ 放 canvas 下面会被挡住。
`multiply` 不改顺序 → **不影响点击**。

`::selection` 同理：

```css
.scpdf-text-layer ::selection {
  background: var(--scpdf-selection-color, rgba(13, 104, 189, 0.24));
  mix-blend-mode: multiply;
}
```

（不含 multiply 时：半透明蓝直接盖在 canvas 的黑字上 → 蓝 + 黑 = 灰蓝 → 字发虚）

### 问题 5：颜色可配置（用户需求）

**包的边界**：包**只负责把颜色渲染出来**（纯视觉）；
取色器 UI、语义含义、持久化 → **全部归宿主**。

**两条通道**：

1. **`::selection` 颜色** → CSS 变量（伪元素里 CSS 变量可用）

   ```css
   --scpdf-selection-color: rgba(13, 104, 189, 0.24);
   ```

2. **高亮颜色** → `highlightPalette` prop（语义 key → CSS 颜色）

   ```tsx
   <PdfViewer highlightPalette={{ yellow: '#ffd54a', 'h-123': '#ff6b6b' }} />
   ```

   → 高亮记录存 `color: 'h-123'`（**语义 key，不是颜色值**）→ 换色板不用改数据

**新增** `src/core/highlight/palette.ts`：

- `HighlightPalette` 类型
- `DEFAULT_HIGHLIGHT_PALETTE`（内置 6 色）
- `resolveHighlightColor` / `paletteToCssVars`

**demo 侧**（`demo/src/HighlightPicker.tsx`，**宿主 UI，不在包里**）：
6 个预设色 + 原生取色器 + "用此色"保存自定义色 → 全部走 `highlightPalette` 通道。

### 附带修的

- `reference` 硬编码 `595 * scale`（A4）→ 改用该页**真实视口尺寸**
  （真实 PDF 是 Letter 612×792 → 参考尺寸错 → 读回时换算比例错）
- 高亮圆角 `2px` → `4px`（对齐 pdf.js 的 `.textLayer .highlight`）

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**303 passed**（24 个测试文件）
  - 新增 `palette.test.ts`（11 例）
  - `AnnotationLayer.test.tsx` 新增 5 例（**无 transform: scale** / 色板生效 / CSS 变量）
- E2E：**9 套 73 项断言全通过**（新增 `e2e-highlight.mjs` 9/9）
  - **高亮与被选文字逐行对齐：最大偏差 0.0px**
  - **选区每处只涂一次：最大叠涂次数 = 1**
  - 高亮用 `multiply` / 圆角 4px / 无 `transform: scale`
  - 高亮块可点击（`elementFromPoint` 命中高亮本身）
  - 回归：选区精准度 9/9（**Δ = 0.00px** 不回归）

### 关键文件

```
src/core/highlight/palette.ts       色板类型 + 默认色 + 工具函数
src/hooks/useTextSelection.ts       修坐标双重扣减
src/components/AnnotationLayer.tsx  删 transform: scale + 应用色板
src/styles/viewer.css               multiply / line-height:0 / CSS 变量
demo/src/HighlightPicker.tsx        宿主的取色器 UI（不在包里）
scripts/e2e-highlight.mjs           高亮效果 E2E（9 项）
```

---

## 第四轮：高亮黑框 / 选区叠涂换方案 / 缩放崩溃 / 选区浮层（2026-11-16 下午）

用户报了 4 个问题。排查后发现**其中两个是上一轮"修复"引入的**。

### 问题 1：高亮有黑框 + 缩放下定位不对

**实测：几何完全是对的**

```
选区: { l: 457.7, t: 328.9, w: 252,  h: 44 }
高亮: { l: 457.7, t: 328.9, w: 252,  h: 44 }
Δleft = Δtop = Δw = Δh = 0.0
```

缩放后也正确（230% → 250%，高亮宽 252 → 273.9 = ×1.088）。

**错的是渲染** —— 高亮是 `<button>`，但 **CSS 从来没 reset 浏览器默认样式**：

```js
{ tagName: "BUTTON",
  border: "2px outset rgb(0, 0, 0)",   // ← 黑框
  padding: "1px 6px",
  boxSizing: "border-box" }            // ← 内容区被 border 吃掉
```

- `border: 2px outset` → **可见黑框**
- `box-sizing: border-box` → 可见区域比几何框小 2px → **看起来没对齐**

**修**：reset button 样式 + **`box-sizing: content-box`**（让 width/height 就是全部可见区域）。

### 问题 2：选区叠涂仍在 + 框选多选一点 —— **上一轮的修法是治标**

**关键实测**（发现 `line-height: 0` 是一对问题的其中一半）：

| line-height       | 选区 top 相对 span top     | 选区高度 | 叠涂次数 |
| ----------------- | -------------------------- | -------- | -------- |
| **`0`（上一轮）** | **−21.9px**（上偏 22px）❌ | 44px     | **1** ✅ |
| **`normal`**      | **+0.1px**（完美）✅       | 44px     | **2** ❌ |
| `1`               | −5.9px                     | 44px     | 2 ❌     |
| `1.15`            | −3.9px                     | 44px     | 2 ❌     |

选区框高 **44px** 而字号只有 **16.1px** → 框粗 2.7 倍 → 就是"上下多框选一点"。

**原因**：`line-height: 0` 让行盒归零 → 浏览器 fallback 到**默认行盒**画选区矩形
→ 叠涂"少"了，但框歪了。**它只是把行盒压扁，没真正解决。**

**正解：pdf.js v6 的 `selectionRendering` 模式**

1. 关掉原生 `::selection` 的背景
2. `getClientRects()` 拿原始形状 → 合并同行重叠矩形
3. 画成 SVG `<clipPath>` → **每个像素只画一次**

**已实测验证**：手工注入后选区均匀、贴合文字、无阶梯 ✅

**新增** `src/core/selection/shape.ts`（`buildSelectionShapes` + `mergeOverlappingRects`）
**新增** `src/components/SelectionLayer.tsx`（SVG clipPath 覆盖层）

**踩到的坑**：SVG **绝对不能设 viewBox**！
`viewBox="0 0 100 100"` + `preserveAspectRatio="none"` 会把用户坐标从 100×100
拉伸到页面真实像素 → clipPath（`userSpaceOnUse`）的 `x=449` 被放大成 `449×(1408/100)=6324`
→ 形状跑到页面外 → **选区完全看不见**（截图确认）。
→ 修：**不设 viewBox** → SVG 用户坐标 = CSS 像素。

### 问题 3：缩放时页面消失（NotFoundError）

**复现了完全一样的报错**：

```
NotFoundError: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
```

**两个根因**（实测定位）：

1. `insertBefore(newNode, referenceNode)` 要求 `referenceNode` 是 `newNode.parentElement` 的子节点。
   缩放时 React 重建所有 span（key 含位置 → 全变）→ `endContainer.nextSibling` 可能属**别的 parent** → 抛错。
2. **跨页选择时哨兵被搬到另一页**（实测 `endStillInL1: false`）
   → 第 1 页哨兵丢失、第 2 页多一个 → 哨兵失去意义。

**异常在 `selectionchange` 里未捕获** → React 错误边界 unmount 整棵树 → **页面消失**。

**修**：
- `contains()` 校验引用节点同父（不满足 → 降级 `appendChild`）
- 跨页时**不动**哨兵（每页各有自己的）
- 哨兵加**固定 key**（React 重渲染不再错位）

**新增** `scripts/e2e-selection-stability.mjs`：6/6

### 问题 4：选区浮层（scholar-club 那种）

**调研了原项目**（`TextSelectionPopover` + `useTextSelection`），确认它的毛病：

| 它的问题                         | 实测                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| 坐标系错                         | `getClientRects()`（视口）+ `window.scrollY` → 当文档坐标用 |
| 不跟随内部滚动                   | 项目**自己的缺陷 B2** 就记着这事                            |
| 假翻转                           | 永远在下方，"翻转"只是 `popoverY -= 50`                     |
| 魔法数字                         | 宽度猜 `200`（实际 350-400）、高度猜 `50`                   |
| 位置不更新                       | 只在 mouseup 算一次，缩放/滚动都不重算                      |
| 无 Esc / 无 selectionchange 关闭 | —                                                           |
| 死代码                           | `document.createElement('div')` 后直接丢弃                  |
| 动作硬编码                       | 每个按钮一个闭包，没有配置数组                              |

**我们的实现**：

- **定位**：`position: fixed` + 视口坐标 → **不需要 scroll 换算** → 天然不漂移
  - **实测弹层尺寸**（不猜）+ **真翻转**（先下方再上方）+ clamp 到容器
- **动作注册表**（可注入）：宿主传 `selectionActions` 覆盖/追加
  内置：🖍高亮(带色板) · 📋复制 · 🌐翻译 · 💬提问 · 📝笔记 · 🗑删除
  **宿主不传 `onTranslate` → 按钮不显示** ✅
- **内置图标 7 个**（纯 SVG，零依赖）
- **统一色板下拉**：6 预设色（原项目新高亮/编辑高亮用了**两套 UI**）
- **关闭**：mousedown 外部 · Esc · 选区清空 · 滚动/缩放（隐藏）

**踩到的坑**：

1. **`react-dom` 不是依赖**：包只 peer-dep `react` → 不能用 `createPortal`
   → 改用 `position: fixed` 内联渲染（祖先链无 transform/filter/contain → 等价于挂 body）
2. **鸡生蛋死锁**：位置没算出来 → 返回 `null` → 元素没渲染 → 量不到尺寸 → 永远算不出位置
   → 修：**第一帧先渲染**（`visibility: hidden`），量到后再算位置
3. **biome `noSvgWithoutTitle`**：要求每个 svg 有**字面量**的 `<title>`（变量不认）

**新增** `src/core/selection/popover-position.ts`（纯函数定位，可单测）
**新增** `src/core/selection/actions.ts`（动作类型 + 合并逻辑）
**新增** `src/components/SelectionPopover.tsx` + `SelectionActionIcons.tsx`

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**333 passed**（27 个测试文件）
  - 新增 `popover-position.test.ts`（10）+ `actions.test.ts`（5）
- E2E：**11 套 96 项断言全通过**
  - `e2e-selection-popover.mjs` **15/15**（定位/居中/clamp/真翻转/Esc/点外部/滚动隐藏/色板/选色触发高亮）
  - `e2e-selection-stability.mjs` **6/6**
  - `e2e-highlight.mjs` **11/11**（改写断言：原生背景已关 + 自绘层生效）

### 关键文件

```
src/core/selection/shape.ts            选区形状（归页 + 合并重叠）
src/core/selection/popover-position.ts  浮层定位（纯函数）
src/core/selection/actions.ts          动作注册表
src/components/SelectionLayer.tsx      SVG clipPath 自绘选区
src/components/SelectionPopover.tsx    选区浮层
src/components/SelectionActionIcons.tsx 内置图标
```

---

## 第八轮：选区"大长方形" / 高亮叠加 / 选区残留（2026-11-17 上午）

用户反馈：**选区画成了一个大长方形**，问是不是我画错了。

> 先说结论：**不是画歪了，是**合并算法**被一个异常矩形污染了**。

### 问题 1：选区变成"大长方形"

#### 实测定位

真实 PDF（arXiv 论文，230%）跨 3 行选择，自绘层输出了 **75 个矩形**，
其中有：

```
l=88  t=-460  w=56  h=829     ← 整页高！
l=88  t=-460  w=42  h=829
```

顺着查 DOM，找到了这个矩形的来源：

```js
{
  txt: "arXiv:2608.07346v4 [cs.AI] 7 S",
  transform: "scaleX(0.922172) rotate(-90deg)",   // ← 竖排的页边戳
  rect: { l: 95, t: -460, w: 42, h: 829 }
}
```

**浏览器对旋转文字给出的选区矩形是整页高（829px）**。

#### 为什么会变成"大长方形"

旧合并算法只跟 `merged[merged.length - 1]` 比：

```ts
if (overlapY > 0 && overlapX > 0) {
  // 合并 → 高度取并集
}
```

这个 829px 的巨型矩形一旦和别的小矩形**垂直重叠** → 合并后的矩形**长高**
→ 继续吸收更多 → **画出一大块**（图里的 20 多个元素全被涂成蓝块）。

截图确认（修复前）：整块蓝色盖住了正文 3 行 + 下面的整张插图。

#### 修法（三步）

1. **先剔除异常矩形**：`height > 最小高度 × 4` → 丢掉
   （⚠️ 必须用**最小高度**当基准，用中位数会在矩形很少时失效）
2. **按"视觉行"分组**（垂直中心相近 → 同一行），不再跨行乱合并
3. **组内按 x 排序逐段合并**，**只合并水平有重叠的**
   → 同行里不相邻的片段保持分开（不涂到中间的空白）

结果：**75 个矩形 → 14 个**，正文 3 行变成 3 条独立的细条。

### 问题 2：高亮完成后 `::selection` 没去掉 / 高亮区域叠加

#### 实测

```
选中后:   { layers: 1, rects: 1 }
取消后:   { layers: 1, rects: 1 }   ← ❌ 旧选区还在
高亮后:   { selText: "Shangha", layers: 1 }  ← ❌ 蓝色选区叠在高亮上
```

#### 根因

`setSelectionShapes` **只设不清** —— `onSelectionChange(null)` 时没清 shape。

#### 修法

- 选区清空 → `setSelectionShapes(new Map())`
- 高亮后 → 清 shape + 关浮层

### 问题 3：⚠️ **不能调 `removeAllRanges()`**（踩坑记录）

第一版修法里，高亮后调了 `window.getSelection().removeAllRanges()`，
结果**用户再也选不了字**：

```
mousedown ✅  mouseup ✅  selectionchange ❌ (0 个)
```

**实测对照**：

| 做法                       | 之后还能选吗 |
| -------------------------- | ------------ |
| 同步调 `removeAllRanges()` | ❌ 选不中    |
| `setTimeout(0)` 延后调     | ❌ 选不中    |
| 从 `page.evaluate` 调      | ✅ 正常      |
| **完全不调**               | ✅ 正常      |

→ 在**点击浮层按钮的同步流程里**调 `removeAllRanges()`，
浏览器会认为"选区正在被改" → **后续拖动被浏览器吞掉**。

**而且根本不需要调**：
- 原生 `::selection` 的背景本来就是 `transparent` → 看不见
- 可见的蓝色块是**自绘层** → 清掉 shape 就没了

### 问题 4：宿主反馈被冲掉

`clearSelection()` 会发 `onSelectionChange(null)` → demo 的提示被重置成空
→ 用户刚点的"已高亮（pink）"没了。

**修**：新增 `clearState()` —— 只清包内部状态，**不通知宿主**。

### ⚠️ 重要：**我之前的性能测量是错的**

之前几轮 DEVLOG 里写"拖动 17.1ms/步，比无哨兵慢 7 倍"——

**这个测量方法有问题**。用的是 CDP `Input.dispatchMouseEvent`，
每次派发都有 **~17ms 的 RPC 往返**。

改用**页面内直接派发原生 MouseEvent** 后：

```
全部功能开启:  0.009 ms/步
移除哨兵:      0.005 ms/步
空白区域基线:  0.004 ms/步
```

→ 包里的选区处理**每步只花 0.009ms**（一帧预算是 16ms → **完全不是瓶颈**）。
所谓"卡"是**冷启动**（第一次拖动 17ms，之后 0.6ms）+ 测试工具的开销。

**教训**：性能测量必须排除工具开销，否则结论完全错。

（哨兵改 CSS 变量驱动 + 尺寸改 0 仍然保留 —— 它确实更稳，也顺手修了 `NotFoundError` 的隐患。）

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**337 passed**（新增 4 个回归测试）
- E2E：**12 套 106 项断言全通过**（新增 `e2e-selection-shape.mjs` 10 项）
- 视觉确认：大长方形消失；正文 3 行 = 3 条独立细条；高亮后无蓝色叠加

### 关键文件

```
src/core/selection/shape.ts       合并算法（剔除异常 + 视觉行分组 + 逐段合并）
src/hooks/useTextSelection.ts      哨兵改 CSS 变量驱动 + clearState
src/components/PdfViewer.tsx       选区清空时清 shape + 高亮后清理
scripts/e2e-selection-shape.mjs    选区形状 + 高亮清理 E2E（10 项）
```

---

## 第九轮：选区/高亮与文字对齐 + 浮层延迟（2026-11-17 上午）

用户反馈：**要和 `scpdf-text-layer__item` 对齐**、**现在特别卡**、**定位不准**。

> 先查了 pdf.js v6 的源码（`pdf.mjs` + `pdf_viewer.mjs` + `pdf_viewer.css`），
> 对比出 3 个关键差异。

### 问题 1：选区/高亮比文字高 11px、偏上 6px

#### 实测（真实 PDF，230%）

|                  | 值                        |
| ---------------- | ------------------------- |
| 浏览器选区矩形   | `y=231.92, h=44`          |
| 文字本身（span） | `y=237.92, h=33`          |
| **偏差**         | **偏上 6px，框高多 11px** |

#### 根因

浏览器的选区矩形 = **字体的自然行盒**（ascent + descent + lineGap），
而 span 的 box = `fontSize × line-height`。

**CSS 改不动它**（实测 7 种全无效）：

| 尝试                               | 选区高                    |
| ---------------------------------- | ------------------------- |
| `line-height: 1` / `0.9` / `0.62`  | 44 / 44 / 30px            |
| `height: 1em` + `overflow: hidden` | 44px                      |
| `display: inline` / `inline-block` | 44px                      |
| `transform: scaleY(0.65)`          | 20px ✅ 但**字被压扁** ❌ |

#### pdf.js v6 怎么做的

pdf.js v6 的 `DrawLayer` **也用 `range.getClientRects()`**（`pdf.mjs:4228`），
关键在 CSS：

```css
.textLayer {
  line-height: 1;
}
.textLayer :is(span, br) {
  position: absolute;
  white-space: pre;
  transform-origin: 0% 0%;
}
```

→ span 的行盒 = `fontSize` → **浏览器行盒和 span 的 box 对齐了**。

**本包也设了 `line-height: 1`，但没用** ——
因为 span 的 `top` = `基线 − ascent`（pdf.js 也一样），
浏览器的行盒从 top 往下 `fontSize` 高，
其**基线位置** = `top + 浏览器字体的 ascent'`（≠ 我们实测的 ascent）→ 差 6px。

#### 修法：**用文本项的基线裁剪**

```
水平：保留 getClientRects() 的 left/width（浏览器知道字距/kerning/连字）
垂直：用文本项的基线 + 字形的 ascent/descent 自己算
```

**实测效果**：

|                   | 之前             | 之后                     |
| ----------------- | ---------------- | ------------------------ |
| 选区 rect         | `y=231.92, h=44` | **`y=237.92, h=32.996`** |
| 与文字的 Δtop     | 6px              | **0.002px** ✅           |
| 与墨迹的 Δtop     | 10px             | **4px** ✅               |
| 与墨迹的 Δbottom  | 12px             | **7px** ✅               |
| 高亮 vs 文字 Δtop | 10px             | **0.0px** ✅             |

**新增** `src/core/selection/item-geometry.ts` + `clipToBaseline()`。

### 问题 2：transform 顺序反了

pdf.js v6：`transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))`
本包（旧）：`transform: scaleX(...) rotate(...)`

→ 反过来会**先横向拉伸再旋转**，对旋转文字（角度 ≠ 0）结果完全不同。
→ **已改成 `rotate() scaleX()`**（与 pdf.js 一致）。

### 问题 3：浮层延迟（27-33ms）

#### 实测（精确到 DOM 出现）

```
mouseup → 浮层 DOM 出现: 27.2ms
```

CPU profile：**86.7% idle** → 不是 JS 忙，是**渲染/合成**。

#### 根因：浮层要**两帧渲染**

1. 第一帧：渲染出来 → `getBoundingClientRect()` 量尺寸
2. 第二帧：算出位置 → 定位到正确的地方

#### 修法：**预先算尺寸**

弹层尺寸只跟**动作数量**有关（按钮固定 28px 宽）→ 可以预估：

```
width  = 4*2 + 1*2 + 按钮数*28 + 分裂按钮*16 + 2*(按钮数-1)
height = 4*2 + 1*2 + 28
```

→ **只渲染一帧**（`measured ?? estimatedSize`）。

**实测**：27-33ms → **21-25ms**。

### ⚠️ 又一次测量教训

这轮一开始我用 `waitForFunction` 测延迟，得到 **130-150ms** ——
那是 `waitForFunction` 的**轮询量化**（rAF / 100ms 间隔），不是真实延迟。

改用 **MutationObserver 打时间戳** → 真实值 **27ms**。

**教训**：测延迟要用 MutationObserver / PerformanceObserver 打点，
不能用 `waitForFunction`（它测的是"轮询发现"的时间）。

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**344 passed**（新增 `baseline.test.ts` 7 项）
- E2E：**12 套 106 项断言全通过**
  - `e2e-highlight.mjs` 的对齐断言改成**以文字本身为基准**
    （旧断言拿"浏览器选区矩形"当基准 = 认可了错的）
- 视觉确认：选区框紧贴文字；高亮块上边缘与文字完全对齐

### 关键文件

```
src/core/selection/item-geometry.ts  按文本项几何算选区（基线裁剪）
src/core/selection/shape.ts          clipToBaseline + 基线表类型
src/core/selection/extract.ts        高亮几何也走基线裁剪
src/hooks/useTextSelection.ts        接收 baselines
src/components/PdfViewer.tsx         baselinesByPage（useMemo）
src/components/SelectionPopover.tsx  预估尺寸 → 单帧渲染
src/components/TextLayer.tsx         transform 顺序改成 rotate() scaleX()
```

---

## 第十轮：选区跨行失效 + 链接吞掉拖选（2026-11-17 中午）

用户反馈（附 3 张截图）：**框选后是一大块**，缩放后定位跑偏，特别卡，一个都没解决。

这一轮挖出了 **4 个独立的根因**，每个都单独修。

---

### 根因 1：跨行拖选 → **自绘层完全没有数据**（用户看到的"那一大块"）

#### 实测

```
自绘层矩形数 = 0     ← 完全空！
浏览器 rect 数 = 255
```

用户看到的那一大块，是**浏览器原生 `::selection`**（因为自绘层没数据，
而原生背景只是"透明"不是"没有"）。

#### 根因

`useTextSelection` 里有一道校验：

```ts
const anchorElement = range.commonAncestorContainer instanceof Element ? ... ;
if (!anchorElement?.closest(TEXT_LAYER_CLASS)) {
  clearSelection();   // ← 直接放弃！
  return;
}
```

**跨行拖选时，`range.commonAncestorContainer` 是 `.scpdf-page`，不是 `.scpdf-text-layer`！**

```
ancClass: "scpdf-page"
ancInTextLayer: false     ← 校验失败 → 直接放弃
```

→ `onClientRects` 从没被调用 → 自绘层空 → 用户看到原生选区（那一大块）。

#### 修法

只要祖先里有**文本层或页面**就算合法（选到别的东西才拒绝）。

```ts
const inTextLayer = !!anchorElement.closest(TEXT_LAYER_CLASS);
const inPage = !!anchorElement.closest(PAGE_CLASS);
if (!inTextLayer && !inPage) { clearSelection(); return; }
```

---

### 根因 2：`height=0` 的矩形 → **合并算法把全部矩形判为异常**

#### 实测

```
rawCount: 255, minHeight: 0, limit: 0, normalCount: 1
```

浏览器偶尔会返回 **height=0 的矩形**（空白的行盒）。
而合并算法的"异常判据"用 `minHeight * 4` 当阈值 → 阈值 = 0
→ **254 个正常矩形全被判为异常** → 选区消失。

#### 修法

1. 先剔除 `height <= 0` / `width <= 0` 的退化矩形
2. 基准改成**截尾中位数**（trimmed median）

```ts
export function trimmedMedian(sorted: readonly number[]): number {
  if (sorted.length <= 1) return sorted[0] ?? 0;
  if (sorted.length < 4) return sorted[0] ?? 0; // 少数几个 → 丢掉最高的
  const trim = Math.floor(sorted.length / 4);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  return trimmed[Math.floor(trimmed.length / 2)] ?? 0;
}
```

为什么不用普通中位数：矩形**很少**时（2-3 个）中位数会被巨型矩形本身占据。
为什么不用平均数：平均数会被离群值拉偏。

---

### 根因 3：字形框用了**字体的自然行盒**，不是 **span 的盒子**

#### 实测

```
fontSize               = 20.62px   ← span 的 font-size
fontBoundingBoxAscent  = 22px      ← 字体的自然上伸（比 fontSize 大！）
fontBoundingBoxDescent = 5px       ← 字体的自然下伸
自然行盒                = 27px      ← 浏览器用它画选区矩形
span 的实际盒子          = 20.62px  ← font-size × line-height(1)
```

→ 用"基线 + ascent/descent"推算会偏 4px、高 27px。

#### 修法

**字形框 = span 的盒子**：`top = item.top`，`height = item.fontSize`。

实测 `item.top` 与渲染后的 `span.getBoundingClientRect().top` **完全相等** ✅

另外，选行时不能只取"最近的一行"：

```
选区矩形   y=452.8 h=27      (452.8..479.8)
上标 "*"   y=451.7 h=16      (451.7..467.7)  ← 基线更近，但盒子在选区上方
正文       y=456.8 h=20.6    (456.8..477.4)  ← 才是正确的行
```

→ 改成：**按距离过滤 → 按"盒子中心离矩形中心"排序 → 依次尝试，
第一个"盒子完全落在矩形内"的胜出**。

---

### 根因 4：**链接吞掉拖选**（缩放后才暴露）

#### 实测

```
初始    [DBG] mouseup target= scpdf-link     ← 选区出不来
放大后  （没有 mouseup 日志）                 ← 完全没选区
```

`.scpdf-link { pointer-events: auto }` → 链接矩形**接管鼠标事件**
→ 浏览器的拖动被当成"拖拽链接" → 文本层收不到选区。

摘要里正好有个 GitHub 链接（`https://github.com/datamillab/A2E`）在正文中间。
缩放后正文位置变了，拖选刚好落在链接上 → 选区彻底不出来。

#### 修法（跟 pdf.js v6 一致）

pdf.js 的 `.annotationLayer { pointer-events: none }` —— 链接层**不接管鼠标事件**。

本包：

1. `.scpdf-links` / `.scpdf-link` 都改成 `pointer-events: none`
2. 链接从 `<a>` 改成 `<span role="link" tabIndex={0}>`（`<a>` 会吞拖动）
3. 点击走**容器上的事件委托** + **按坐标命中**（`elementFromPoint` 也不行，
   它同样跳过 `pointer-events: none` 的元素）

```ts
const findLinkAtPoint = (clientX: number, clientY: number) => {
  for (const link of document.querySelectorAll<HTMLElement>('.scpdf-link')) {
    const rect = link.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
      return link;
  }
  return null;
};
```

→ 现在**既能点链接，又能从链接上拖选**（E2E 两条都验证）。

---

### 附带修的：缩放后基线表**没更新**

`handleTextItems` 原来用"数量相同 → 不更新"当优化：

```ts
if (existing && existing.length === items.length) return prev;   // ← 错！
```

缩放时 item **数量不变**但**几何全变** → 基线表停留在旧缩放级别
→ 选区裁剪用错基线 → **缩放后定位跑偏**（用户的原话）。

→ 改成比**几何指纹**（第 1 / 中间 / 最后三个 item 的 left/top/fontSize/text）。

---

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**349 passed**（新增 `baseline.test.ts` 9 项 + `shape.test.ts` 2 项）
- E2E：**13 套 118 项断言全通过**（新增 `e2e-selection-regression.mjs` 9 项）
- **选区与文字的对齐：Δtop = 0.01px，高度比 = 1.0**（fit / 放大 / 缩小 全一致）
- 视觉：fit 和放大两种状态下，选区块都**紧贴文字**

### 关键文件

```
src/hooks/useTextSelection.ts        允许 page 祖先 + 剔除退化矩形
src/core/selection/shape.ts          trimmedMedian + 按盒子中心排序 + 依次尝试
src/core/selection/baseline.test.ts  新增（9 项）
src/components/PdfViewer.tsx         基线表用 span 盒子 + 链接点击委托
src/components/LinkLayer.tsx         <a> → <span role="link">
src/styles/viewer.css                链接层 pointer-events: none
scripts/e2e-selection-regression.mjs 新增（跨行选区回归，9 项）
```

---

## 第十轮：浮层锚定 + 缩放保持选区 + 拖动中即出现 + 性能（2026-11-17 下午）

用户反馈（第九轮）：
- "缩放的时候浮层没跟着一起缩放"
- "缩小之后选择跑偏很厉害"
- "很卡特别特别卡" / "我需要鼠标开始框选之后立刻出现浮层"
- 滚动行为：**方案 A 跟随滚动**

---

### 上一轮先做的：把 bug 变成红色的测试

新增 `scripts/e2e-popover-anchor.mjs`（8 项断言），
断言的是**浮层与选区的间距**（而不是坐标）——间距在缩放/滚动前后应该一致。

初始结果 **4/8**（故意是红的）：

```
PASS 选中后浮层出现
PASS 浮层锚定在选区下方 - 间距 8px
FAIL **缩放后浮层仍锚定在选区上** - 间距 nullpx（基准 8px）
FAIL **缩小后浮层仍锚定在选区上** - 间距 nullpx（基准 8px）
FAIL **滚动时浮层跟随**（不消失、不跑偏） - 间距 nullpx → nullpx，浮层消失
FAIL **拖动中浮层已出现**（不用等松手） - 已选 4 字符
PASS **拖动中选区块已出现** - 3 个
```

> **之前的 E2E 全部只断言几何**（选区块位置对不对），
> **从没有断言过"浮层在不在、跟不跟得上"** —— 而用户抱怨的正是后者。

---

### 根因 1：浮层锚点是"存下来的坐标"

```ts
// PdfViewer.tsx（旧的）
const rect = domSelection.getRangeAt(0).getBoundingClientRect();
setPopoverAnchor({ left: rect.left, top: rect.top, ... });   // ← 算一次就再也不动
```

`position: fixed` 的坐标会随**滚动 / 缩放 / 容器尺寸变化**失效
→ 浮层跑到别处（实测偏 130px）。

**修法**：锚点**每次布局都从 DOM 选区现算**（`readLiveAnchor()`），
触发源：滚动（capture）/ resize / 100ms 校正定时器 / 宿主版本号。

---

### 根因 2：缩放会**静默销毁**浏览器选区

实测：

```
缩放前: selection = { len: 199, collapsed: false }
缩放后: selection = { len: 0,   collapsed: true  }
缩放期间 selectionchange 事件: []      ← 根本不触发！
```

原因：缩放 → 文本层**重渲染**（span 全被替换）→ 浏览器选区锚定的 DOM 节点没了
→ 浏览器**静默**清空选区（**不触发 `selectionchange`**）→ 浮层被关闭。

**修法**：新增 `useSelectionPreservation`：
1. 缩放**前**记住选区（用**字符偏移**，与缩放无关）
2. 缩放**后**按字符偏移**恢复**

### 三个踩过的坑（都是实测逼出来的）

**① 恢复太早** → 文本层还在分批重渲染 → 恢复完又被干掉：

```
100ms: len=199  ← 恢复了（此时文本层还是旧的）
200ms: len=0    ← 文本层重渲染 → 又被销毁了
```

→ 改成**持续重试**（每帧检查，掉了就再恢复），连续 10 帧稳定才收工。

**② "保存" effect 永远不执行**：
React effect 按声明顺序执行 → "恢复"effect 先跑并更新了 `lastScaleRef.current`
→ "保存"effect 再跑时 `lastScaleRef.current === scale` → **直接 return，不保存**。

→ 改成 `useLayoutEffect`（paint 前同步执行）+ 声明在"恢复"之前。

**③ `onRestored` 回调身份每次渲染都变** → 恢复循环的 cleanup 反复取消 rAF
→ 循环只跑一帧就停 → 选区恢复完又被重渲染干掉。

→ 用 `useCallback` 固定身份。

---

### 根因 3：拖动中**完全没有反馈**（"巨卡"的来源）

旧实现所有几何计算都挂在 **mouseup** 上：

```
mousedown ──────────────────── mouseup ──► 计算 ──► 出浮层
```

实测按住拖动 900ms：浮层=无、自绘块=0 → 手感"卡死"。

**修法**：几何计算抽成 `computeGeometry()`，
**mouseup 和 selectionchange 都调**；`selectionchange` 侧用 **rAF 节流**
（实测拖动 30 步触发 15 次 selectionchange）。

> pdf.js v6 的 `DrawLayer.#selectionChange()` 本来就是在 `selectionchange`
> 里实时画选区的 —— 我们之前只抄了一半。

---

### 根因 4：垂直定位用"容器"判定 → 误判"放不下"→ 乱翻

容器可能比窗口还高（内部滚动）：

```
容器可视区:  97..908    ← 908 > 视口 900
选区底部:    880
浮层高度:    38
```

按容器算：下方只剩 28px < 38 → **翻到上方** → 浮层跑到选区上面 130px。

**修法**：垂直边界改用**视口**，容器只做水平 clamp。

---

### 性能提优

用户要求"性能需要提优"。先测量，确认瓶颈在哪：

```
CPU profile:  89.4% idle, 我们的代码 0.1%
帧间隔:       p50=16.7ms  p95=16.9ms  长帧 0 个
```

→ **CPU 不是瓶颈**（满帧 60fps）。但拖动时**零反馈**才是"卡"的来源（根因 3）。
另外把几个 O(n²) 的算法也优化了（拖动时高频触发）：

| 位置                  | 旧                                                           | 新                                                             |
| --------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `collectPages`        | 每次 `querySelectorAll`（518 span）+ 518 次 `intersectsNode` | **按页分组 + 缓存**（MutationObserver 标脏），一页命中就 break |
| `clipToBaseline`      | 每个矩形都 `map`+`filter`+`sort` 整个基线表                  | **只保留最近 K=8 个候选**，只排这 8 个                         |
| `optimizeClientRects` | 全量双重循环 → 255 矩形 = **65025 次比较**                   | **先按行分桶**，只在桶内比较 → 几百次                          |

---

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**349 passed**
- E2E：**15 套 129/129 断言全通过**
  （新增 `e2e-popover-anchor.mjs` 8 项 + `e2e-selection-perf.mjs` 3 项）

### 性能实测（页面内原生事件，排除 CDP 往返）

```
拖动 40 帧:  p50=16.6ms  p95=16.9ms  max=18.2ms  >32ms 长帧 0 个   ← 满帧 60fps
mousedown → 浮层出现:  87~107ms（之前 261ms，且必须等松手）
```

### 用户报的问题逐条验证

| 反馈                     | 结果                                |
| ------------------------ | ----------------------------------- |
| 缩放时浮层没跟着缩放     | ✅ 间距 −126.4px → −129.6px（一致） |
| 缩小后选择跑偏           | ✅ −126.4px（一致）                 |
| 滚动时浮层               | ✅ 跟随，不消失                     |
| 鼠标开始框选立刻出现浮层 | ✅ 87~107ms，不用等松手             |
| 很卡                     | ✅ 满帧 60fps + 拖动中实时反馈      |

### 关键文件

```
src/hooks/useSelectionPreservation.ts  新增：缩放前后保持选区（字符偏移）
src/hooks/useTextSelection.ts          几何计算抽成 computeGeometry，selectionchange 也调（rAF 节流）
src/components/SelectionPopover.tsx    锚点实时计算 + 滚动/resize/定时校正
src/components/PdfViewer.tsx           缩放前保存选区 + 恢复后重开浮层 + 滚动不再隐藏浮层
src/core/selection/popover-position.ts  垂直边界改用视口
src/core/selection/shape.ts            候选表只留 K=8（不全量排序）
src/core/selection/optimize-rects.ts   按行分桶（O(n²) → O(n + Σ桶内²)）
scripts/e2e-popover-anchor.mjs         新增（8 项断言）
scripts/e2e-selection-perf.mjs         新增（3 项断言）
```

### 补充：第十一轮修的两个 bug（浮层实时锚定的实现缺陷）

上一轮的实现有两个真 bug，这轮修掉。

#### Bug A：缩放后恢复出"整页"选区（88 字符 → 2938 字符）

**根因（三个坑叠加）**：

1. **坐标系不一致** —— `offsetOf` 累加**所有页**的 span，`restoreSelection` 只在**一页内**找
2. **累加方式不一致** —— 一个按 `span.textContent`，一个按**文本节点**
3. **结束节点是元素** —— 选区结束在 span 边界时 `endContainer` 是元素 → 退回"span 末尾"
   （实测 `endOffset=3010`，而选区只有 88 字符）

**修法：不按偏移，按文字找。**
缩放前记住"选中了什么**文字**"+在哪一页，缩放后在这一页里**找到这段文字**→ 重新选中。
→ 稳定、无坐标系问题，也符合用户直觉。

#### Bug B：缩放后**重新框选**，浮层再也不出现

```
选中后         {len: 88, pop: true}
缩放后         {len: 88, pop: true}
缩放后重新选   {len: 88, pop: false}    ← 选区有了，浮层没了
```

**根因**：浮层的 `mousedown` 处理器在"点浮层外面"时 `onClose()`。
**重新框选的 mousedown 也落在外面** → 浮层被关 → 之后选区变化想重开，时机上没接上。

**修法**：按下时**不立即关闭**，`setTimeout(0)` 推迟 → 之后如果有新选区就不关（由选区变化决定开/关）。

#### 另外：恢复循环里绝不能再调 `save()`

它发生在重渲染之后（选区已被销毁）→ 会把好快照**覆盖成 null**。
实测日志：
```
[PRES] save() called, pending= true      ← 宿主显式调（好快照）
[PRES] save() called, pending= true      ← 循环里又调（覆盖成 null）❌
```

#### 验证

E2E **15 套 132/132**（`e2e-popover-anchor.mjs` 加到 11 项）

```
1-fit:        选区88字符 自绘8个 浮层间距8px ✅
2-zoomed:     选区88字符 自绘8个 浮层间距8px ✅
3-zoominout:  选区88字符 自绘8个 浮层间距8px ✅
4-scrolled:   浮层在 间距8px 选区88字符 ✅
```

---

## 第十二轮：全缩放矩阵验证 + 修"页居中选区被丢弃"（2026-11-17 傍晚）

用户要求："再全部验证一下缩放状态下选中是否准确 选中的时候的性能如何
高亮的状态是否准确 各个情况下你都验证一下"

新建 `scripts/e2e-zoom-matrix.mjs`（**49 项断言**），覆盖 **6 个缩放档位**
（fit / 50% / 75% / 100% / 150% / 200% / 250%），每档测 4 件事：
**选区精准度 / 高亮精准度 / 拖动性能 / 浮层锚定**。

### 🔴 真 bug：页居中时选区被**整段丢弃**

**实测**（100% 缩放，容器 1384px，页 612px）：

```
浏览器选区: { len: 26, clientRects: 1 }      ← 浏览器正常
自绘选区层: { layers: 0, rects: 0 }           ← ❌ 什么都没有
```

用户看到的现象：**低缩放下选中没反应**。

**根因**：`.scpdf-page` 用 `margin-inline: auto` **居中**
→ 页宽 < 容器宽时（低缩放 / 适合页面）页会**居中偏移**（实测 left = 386）
→ 而页框的 `left` 被**写死成 0**（**两处**）
→ 归页判定按**中心点**落在页框内：`681.5 > 0 + 612` → **不属于任何页**
→ 矩形被丢弃 → `byPage` 为空 → 返回 null → **自绘选区层为空**。

**修法**：**量**出页的真实 left（不靠算 —— 能自动处理 padding / 滚动条 / 居中规则变化）：

```ts
const [pageLeft, setPageLeft] = useState(0);

const measurePageLeft = () => {
  const pageEl = container.querySelector<HTMLElement>('.scpdf-page');
  if (!pageEl) return;
  // ⚠️ 用 offsetLeft，不要用 getBoundingClientRect() 相减
  //    （布局未稳时会算出错值：实测先算出 395，后面变成 8、0……）
  const left = Math.round(pageEl.offsetLeft - container.offsetLeft);
  setPageLeft((prev) => (Math.abs(prev - left) >= 1 ? left : prev));
};
```

**回归测试**：`extract.test.ts` 加 2 个用例（页居中时能归页 / 页外仍返回 null）。

### 验证工具：画布墨迹探针

新增 `scripts/e2e-canvas-ink-probe.mjs`。

**为什么必须跟"画布墨迹"比**：浏览器自己的选区 rect 高度 = 字体的**自然行盒**
（比文字本身高 ~30%）→ 拿它当基准会得出"偏了 7px"的假结论（之前踩过）。
pdf.js 把文字画在 canvas 上 → **canvas 的像素位置就是文字的真实位置**。

**两个关键设计**：

1. **逐行扫描** —— 选区矩形是逐行的，合并后上下相邻行的字会被算进来
2. **只扫"中间带"**（垂直 25%~75%）—— 选区是 em 盒，上下空白里可能有相邻行的字

**垂直方向不能直接比墨迹**：选区高度 = **em 盒**（= fontSize，和 pdf.js 的
`--font-height` 一致），墨迹高度 = **实际字形高度**（cap-height）。
大字号时两者差很多（28.69px 字号 → 墨迹只有 20px）—— 那是字体性质，不是选区不准。
→ 改成：**选区必须完全包含墨迹**（不切字形）+ 留白 ≤ em 盒的 60%。

### 实测结果（6 档全绿）

| 档位       | 选区 Δ左 | 选区 Δ右 | 高亮 Δ左 | 高亮 Δ右 | 切字形行数 |
| ---------- | -------- | -------- | -------- | -------- | ---------- |
| fit (230%) | 2.99     | 2.16     | 2.98     | 2.18     | 0          |
| 50%        | 2.68     | 2.80     | 2.67     | 2.83     | 0          |
| 100%       | 2.86     | 2.52     | 2.84     | 2.55     | 0          |
| 150%       | 2.15     | 2.99     | 2.14     | 2.02     | 0          |
| 200%       | 2.46     | 2.30     | 2.45     | 2.31     | 0          |
| 250%       | 0.53     | 2.73     | 0.52     | 2.75     | 0          |

**性能**（页面内原生事件，排除 CDP 往返）：全部档位
`p50 ≈ 17.5ms  p95 ≈ 18.5ms  长帧 0 个` → **满帧 60fps**。

**高亮的归一化往返精度**：

```
100%: 高亮 (205.02, 103.44, 201, 14.34)
      选区 (205.031, 103.445, 201.011, 14.346)   → Δ < 0.01px ✅
50%:  高亮 (102.50, 51.72, 100.52, 7.17)
      选区 (102.500, 51.723, 100.520, 7.173)     → Δ < 0.005px ✅
```

### 测试脚本本身踩的坑（记录）

1. **不能直接删 React 渲染的 DOM** → React 状态和 DOM 对不上 → 下次渲染清掉整个文本层
2. **候选 span 要逐个试** → PDF 左侧的**旋转戳**浏览器不创建选区，
   但它的 `getBoundingClientRect()` 看起来完全正常
3. **选区"太长"= 拖过整页** → 要拒绝并重试
4. **性能测试后坐标会过期** → 要重新找候选
5. **合成事件会让浏览器处于"正在拖选"状态** → 要先清场
6. **缩放后要等文本层重建完** → 否则查到 0 个

### 验证

- `pnpm verify`: **8 门禁全绿**
- `pnpm test`: **352 passed**（+3）
- E2E: **16 套 181/181 断言全通过**（新增 e2e-zoom-matrix 49 项）

---

## 第十三轮：固定 demo 端口（2026-11-18 上午）

用户反馈："你启动一下这个项目 启动在哪里 为什么你每次起的端口都不一样 固定一个端口"

### 端口为什么每次都不一样

**两个原因叠加**：

1. **`vite.config.ts` 没配 `server.port`** → Vite 默认用 **5173**，被占用就往后找
2. **Vite 默认会"偷偷换端口"** —— 5173 → 5180 → 5200 → 5201 …

而我自己为了避开占用，**每次手动换一个端口**（5180 / 5181 / 5200 / 5201），
再手动设 `E2E_BASE_URL` → 地址变得完全不可预测。

### 修法

**① `demo/vite.config.ts` 固定端口 + `strictPort`**

```ts
server: {
  port: 5180,
  strictPort: true,   // ← 关键：端口被占用时**直接报错**，不偷偷换
  host: '127.0.0.1',
  open: false,
}
```

**② 新增 `scripts/demo.mjs`**（`pnpm demo` 的入口）

- 打印固定地址（`http://127.0.0.1:5180`）
- 端口被占用时给出**明确的提示**（而不是让人猜）
- 统一用 `127.0.0.1`（不用 `localhost` → 避免 IPv6 `::1` 和 IPv4 `127.0.0.1` 的歧义）

**③ 新增 `scripts/e2e-base.mjs`** —— 所有 E2E 脚本的**唯一**基址来源

之前 **17 个脚本各自写了一个默认端口**：

```
5180 / 5181 / 5187 / 5190 / 5194 / 5196 / 5198 / 5200 …
```

→ 跑一次 E2E 有一半脚本连不上，除非手动设 `E2E_BASE_URL`。

现在全部统一到 `E2E_BASE_URL`（默认 `http://127.0.0.1:5180`），
**跑 E2E 不需要再手动设环境变量**。

### 验证

```
pnpm demo            → http://127.0.0.1:5180
pnpm e2e:all         → 目标 http://127.0.0.1:5180
                        16 套 181/181 断言通过（0 个套件失败）
```

### 追加：修"Vite 预打包缓存过期导致 demo 白屏"

启动 demo 时发现**白屏 + 500**：

```
Failed to resolve import "@scholar-space/pdf-viewer/styles.css" from "src/App.tsx"
```

**根因**：demo 消费的是**包的 `dist/`**（workspace 软链）。
在 demo **运行期间**执行 `pnpm build`（`dist/` 被删了重建）
→ Vite 的**预打包缓存**失效 → 之后所有请求都报"解析不了"。

（迷惑点：`require.resolve` 在 Node 侧是**能**解析的
→ 看起来像"文件不存在"，其实是 Vite 的预打包缓存过期了。）

**修法（两处）**：

1. `demo/vite.config.ts` 加 `optimizeDeps.exclude: ['@scholar-space/pdf-viewer']`
   → Vite **按源码直接服务** workspace 包 → dist 重建后不需要重启
2. `scripts/demo.mjs` **先构建包再起服务**
   → 每次 `pnpm demo` 都保证 `dist/` 是最新的

---
