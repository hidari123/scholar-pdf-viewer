# 第四轮修复方案（高亮框 / 选区叠涂 / 缩放崩溃 / 选区浮层）

> 排查时间：2026-11-16 · 全部基于**真实 PDF 实测**（`Agent引擎.pdf`，18 页，230% 缩放）
> 状态：**只给方案，未写实现**

---

## 摘要

| #   | 问题                           | 根因                                                                                    | 修复方向                                  |
| --- | ------------------------------ | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | 高亮有黑框 / 缩放下定位不对    | **`<button>` 的浏览器默认样式**（`border: 2px outset` + `padding: 1px 6px`）            | CSS reset                                 |
| 2   | 选区叠涂仍在 / 框选多选一点    | `line-height: 0` 让选区 rect **上偏 22px**，且**每处仍涂 2 次**（浏览器 fallback 行盒） | 改用 pdf.js v6 的 **SVG clipPath 覆盖层** |
| 3   | 缩放时页面消失                 | `insertBefore` 的**引用节点**可能不属于目标父节点 → `NotFoundError`                     | 加 `contains()` 校验 + 兜底               |
| 4   | 要 scholar-club 那样的选区浮层 | ——                                                                                      | 自研定位 + **可注入的动作注册表**         |

**注意**：问题 1 和 2 的根因**都是上一轮的"修复"引入的**（`<button>` 默认样式从未被 reset；`line-height: 0` 是我为了修叠涂加的）。这轮要**换方案**，不是打补丁。

---

## 问题 1：高亮的黑框 + 缩放定位

### 1.1 实测：几何是准的，**错的是渲染**

```
选区(视口):  { l: 457.7, t: 328.9, w: 252,  h: 44 }
高亮(视口):  { l: 457.7, t: 328.9, w: 252,  h: 44 }
Δleft = 0.0   Δtop = 0.0   Δw = 0.0   Δh = 0.0     ← 完全对齐 ✅
```

缩放后也正确（230% → 250%，高亮宽 252 → 273.9 = ×1.088 ✅）。

**所以"定位有问题"是视觉错觉**，来自下面这个：

```js
// 实测 computed style
{
  tagName: "BUTTON",
  border: "2px outset rgb(0, 0, 0)",     // ← 黑框！
  padding: "1px 6px",                    // ← 让内容区偏移
  boxSizing: "border-box"                // ← 盒模型被 border 吃掉
}
```

**根因**：高亮渲染成 `<button>`（为了能点、能被 a11y 识别），
但 **CSS 从来没有 reset 浏览器对 button 的默认样式**。

后果：
- `border: 2px outset` → **可见的黑框**（截图里每个高亮都有一圈深蓝/黑边）
- `box-sizing: border-box` + `padding` → **可见的高亮区域比几何框小 2px**，且内容区从内侧开始 → 看起来"没对齐"
- `outset` 边框有 3D 立体感 → 视觉上更"脏"

### 1.2 修复

**在 `.scpdf-annotation` 里 reset button 默认样式**：

```css
.scpdf-annotation {
  /* --- reset 浏览器默认 button 样式 --- */
  border: none;
  padding: 0;
  margin: 0;
  background: none;      /* 背景由 --mine/--others 给 */
  font: inherit;
  appearance: none;
  -webkit-appearance: none;
  box-sizing: content-box;   /* 让 width/height 就是可见区域 */
  /* --- 原有样式 --- */
  position: absolute;
  ...
}
```

> **`box-sizing: content-box`** 很关键：`border-box` 会让 `width: 252px` 变成
> "内容 248px + border 4px"，而 `content-box` 让 252px 就是**全部可见区域**。

**验证**：实测（注入 `border: none; padding: 0`）→ 黑框消失，高亮干净贴合文字。

### 1.3 激活态的 outline 保留

`.scpdf-annotation--active` 的 `outline: 2px solid` 是**故意**的（表示"当前选中的高亮"），
但它不是黑框，保留。用户说的"黑框"是 button 默认 border。

> **决策点**：激活态要不要也改成不显示 outline？
> 建议保留 —— 它是"哪个高亮被选中"的视觉标识。

---

## 问题 2：选区叠涂 + 框选多选一点

### 2.1 实测：`line-height: 0` 是罪魁祸首

**上一轮我用 `line-height: 0` 修叠涂，实测数据：**

| line-height             | 选区 top 相对 span top       | 选区高度 | 叠涂次数 |
| ----------------------- | ---------------------------- | -------- | -------- |
| **`0`（上一轮的做法）** | **−21.9px**（向上偏 22px）❌ | 44px     | **1** ✅ |
| **`normal`**            | **+0.1px**（完美）✅         | 44px     | **2** ❌ |
| `1`                     | −5.9px                       | 44px     | 2 ❌     |
| `1.15`                  | −3.9px                       | 44px     | 2 ❌     |

**两个问题是一对**：
- `line-height: 0` → 行盒归零 → 叠涂次数 = 1 ✅，但浏览器 fallback 到默认行盒 → **选区框上偏 22px** ❌（这就是"上下多框选一点"）
- `line-height: normal` → 选区框完美 ✅，但同行不同字号产生多个行盒 → **叠涂 2 次** ❌

**实测选区高度 44px vs 字号 16.1px** → 选区框是字号的 2.7 倍 → 肉眼就是"框粗了"。

> 我上一轮的 `line-height: 0` 是**治标**：它把行盒压扁了，但浏览器的选区矩形
> 仍然用默认行盒（44px）→ 只是位移了，没有真正解决。

### 2.2 正确的解法：pdf.js v6 的 `selectionRendering`

pdf.js v6 就是这么解决的（`pdf_viewer.css:765` + `:6341`）：

```css
/* 关掉浏览器原生选区 */
.textLayer.selectionRendering ::selection {
  background: transparent;
  color: transparent;
}

/* 用 SVG clipPath 画覆盖层 —— 每个像素只画一次 */
.pdfViewer .page .selection {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  background: rgb(0 90 255 / 0.22);
}
```

**机制**：
1. `::selection` 背景设成透明 → 浏览器不再画那些重叠的矩形 → **不可能叠涂**
2. 用 `range.getClientRects()` 拿到选区的形状 → 转成 SVG `<clipPath>` 的多个 `<rect>`
3. 画一个覆盖整个页面的矩形，用 `clip-path` 挖出选区形状 → **每处只画一次**

### 2.3 **已实测验证**（我在页面上手工注入了这个方案）

```
选区 rect 数: 26
截图: e2e-shots/svg-selection.png
```

**结果**：选区**均匀**、无阶梯、**贴合文字**、无深浅不一 ✅

### 2.4 实施要点

**新增** `src/components/SelectionLayer.tsx`：

```tsx
// 每页一个 SVG 覆盖层
<svg className="scpdf-selection-layer" width="100%" height="100%">
  <defs>
    <clipPath id={`scpdf-clip-${pageNumber}`} clipPathUnits="userSpaceOnUse">
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} />
      ))}
    </clipPath>
  </defs>
  <g clipPath={`url(#scpdf-clip-${pageNumber})`}>
    <rect x="0" y="0" width="100%" height="100%" className="scpdf-selection-layer__fill" />
  </g>
</svg>;
```

**坐标**：clipPath 用**页内坐标**（相对页面元素），所以要减去页面的 offset。

**CSS**：
```css
.scpdf-selection-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2; /* 在 canvas 之上, 在 annotation 之下 */
}
.scpdf-selection-layer__fill {
  fill: var(--scpdf-selection-color, rgba(0, 90, 255, 0.22));
  mix-blend-mode: multiply; /* 文字仍然清晰 */
}
```

**JS 侧**：
- `useTextSelection` 里，除了算归一化几何，**额外**把选区的**页内矩形**报给宿主
- `PdfViewer` 收集 → 按页分组 → 传给 `Page` → `Page` 渲染 `SelectionLayer`

**CSS 侧**：
```css
/* 关掉原生选区（由 SelectionLayer 接管） */
.scpdf-text-layer ::selection {
  background: transparent;
}
```

### 2.5 代价与取舍

|                | `line-height: 0` | SVG clipPath           |
| -------------- | ---------------- | ---------------------- |
| 叠涂           | ✅ 1 次          | ✅ 1 次                |
| 选区框贴合     | ❌ 上偏 22px     | ✅ 精确                |
| 实现复杂度     | 一行 CSS         | 需要 SVG 层 + 坐标换算 |
| 浏览器原生选区 | 保留             | 保留（只是不画背景）   |
| 复制文本       | ✅               | ✅（不影响）           |

**决策：改用 SVG clipPath**。理由：
1. `line-height: 0` 的"叠涂修复"是**假象** —— 它用"框上移"换来了"只涂一次"，代价是选区框不准（用户明确抱怨了）
2. 用户要"和 WPS 一样" → WPS/Acrobat 的选区就是**自绘**的
3. pdf.js v6 已经验证过这条路

> **⚠️ 实施后必须重测**：
> - `e2e-selection-align`（选区起点 Δ）
> - `e2e-highlight`（叠涂次数 = 1）
> - 复制文本是否正常
> - Firefox（Safari 用 `-webkit-` 前缀）

### 2.6 备选（如果 SVG 方案出问题）

保持 `line-height: normal`（选区框准），
把 `::selection` 的不透明度降到 **14%** → 涂两次 ≈ 26%，视觉差异不大。
**但这是治标**，且单涂的地方会太淡。

---

## 问题 3：缩放时 `insertBefore` 崩溃

### 3.1 复现的错误

```
Uncaught NotFoundError: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
```

**我复现出了完全一样的错误信息**（`ok3`），触发条件：

```js
layer.insertBefore(end, other);   // other 属于**别的** parent
→ THROW: NotFoundError: ... is not a child of this node.
```

### 3.2 根因

`useTextSelection.ts:252`：

```ts
const endContainer =
  range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;

endContainer.parentElement?.insertBefore(end, endContainer.nextSibling);
```

**两个隐患**：

**隐患 A：跨页时把哨兵搬到了别的页**
实测：
```
startLayerIsL1: true
endContainerInL2: true      ← 选区结束在第 2 页
endStillInL1: false         ← 但哨兵被搬到了第 2 页的 text layer！
```
→ 第 1 页的哨兵丢失，第 2 页多了一个 → **哨兵完全失去意义**

**隐患 B：引用节点可能不属于目标父节点**
`endContainer.nextSibling` 在 React 重渲染（缩放 → 所有 span 的 key 变了 → 全部重建）
之后可能指向**另一个 parent** 的节点 → `insertBefore` 抛 `NotFoundError`

**为什么"页面有时候会消失"**：
异常在 `selectionchange` 事件处理器里抛出 → **未捕获** →
React 的错误边界把整棵树 unmount → 页面消失。

### 3.3 修复

```ts
const onSelectionChangeEvent = () => {
  // ... 取 range / textLayer / end 不变

  const endContainer =
    range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement;
  if (!endContainer) return;

  const parent = endContainer.parentElement;
  if (!parent) return;

  // ⚠️ **必须校验引用节点属于同一父节点**（否则 insertBefore 抛 NotFoundError）
  const reference = endContainer.nextSibling;
  if (reference && reference.parentElement !== parent) {
    parent.appendChild(end); // 降级：直接放到末尾
    return;
  }

  // ⚠️ **哨兵只能在选区所在的 text layer 内移动**
  if (!textLayer.contains(endContainer)) {
    return; // 跨页 → 不动（每页各有自己的哨兵）
  }

  parent.insertBefore(end, reference ?? null);
};
```

**另外两处加固**：
1. **`TextLayer` 的哨兵加 `key`** → React 重渲染时不会"错位重建"
2. **哨兵只在 `endContainer` 所属的 text layer 里找**，不是从 `startContainer` 的 layer 找
   → 跨页时每页各自守自己的边界

3. **兜底**：在 `window.addEventListener('error')` 里捕获？
   ❌ **不做** —— 掩盖问题。正确的做法是**不抛异常**。

> **决策**：修 `insertBefore` 的调用条件 + 哨兵加 key + 哨兵按页隔离。
> 不加全局错误兜底（那是掩盖）。

---

## 问题 4：选区浮层（scholar-club 那种）

### 4.1 调研：原 scholar-club 怎么做的（**以及为什么做得不好**）

**位置**：`src/pages/Chat/PdfSection/PageCom/hooks/useTextSelection.ts` + `TextSelectionPopover/`

**核心问题（它自己的项目文档也记了，缺陷 B2）**：

```ts
// useTextSelection.ts:75-129
let popoverY = lastRect.bottom + window.scrollY; // ← 视口坐标 + window.scrollY
if (popoverY + 50 > windowHeight) {
  popoverY -= 50; // ← 假"翻转"
}
popoverPosition.current = { top: popoverY, left: popoverX };
```

| 问题               | 说明                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| **坐标系错**       | `getClientRects()` 是**视口**坐标，却加 `window.scrollY` 当**文档**坐标用 → 弹层漂移 |
| **不跟随内部滚动** | PDF 在**内部容器**里滚，`window.scrollY` 根本不是那个滚动量 → 弹层不动               |
| **没有真翻转**     | 永远在下方；"翻转"只是 `popoverY -= 50` 这个魔法数字                                 |
| **魔法数字**       | `popoverWidth = 200`（实际 350-400）、`50`（弹层高度，从来没量过）                   |
| **位置不更新**     | 只在 mouseup 算一次；缩放/滚动/resize 都不重算                                       |
| **没有 Esc**       | 只有 `mousedown` 关闭                                                                |
| **死代码**         | `document.createElement('div')` 创建后直接丢弃                                       |
| **绕过 antd**      | 用 `overlayStyle` 覆盖了 antd 的定位引擎，连箭头都对不齐                             |

**它自己的计划文档已经写了正确做法**（`PdfNpmPackagePlan.md` §6.5）：

```
弹层定位（相对滚动容器，修 B2）：
  top  = rect.bottom - containerRect.top + container.scrollTop
  left = rect.centerX - containerRect.left + container.scrollLeft
  clamp 到容器可视区（左右 8px 边距；底部越界则翻转到选区上方）
关闭：mousedown 落弹层外 / Esc / file 变化
```

### 4.2 我们的实现方案（比它好的地方）

#### (a) 定位：自研，不依赖任何 UI 库

**用 `position: fixed` + 视口坐标**（比它的"文档坐标 + absolute"简单得多）：

```ts
// 选区矩形本来就是**视口坐标**（getClientRects）
// → fixed 定位直接用，不需要任何 scroll 换算！
const rect = selectionRect; // 视口坐标

// 理想位置：选区下方，水平居中
let top = rect.bottom + GAP;
let left = rect.left + rect.width / 2 - toolbarWidth / 2;

// 翻转：上方空间不够 → 放到上方
if (top + toolbarHeight > containerRect.bottom) {
  const above = rect.top - GAP - toolbarHeight;
  if (above >= containerRect.top)
    top = above; // 上方也放得下 → 真的翻转
  else top = Math.max(containerRect.top, rect.bottom + GAP); // 都放不下 → 放下方 + clamp
}

// 水平 clamp（用**实测**的弹层宽度，不猜）
left = Math.max(
  containerRect.left + MARGIN,
  Math.min(left, containerRect.right - toolbarWidth - MARGIN),
);

// 垂直 clamp
top = Math.max(
  containerRect.top + MARGIN,
  Math.min(top, containerRect.bottom - toolbarHeight - MARGIN),
);
```

**关键改进**：
1. **`position: fixed`** → 坐标就是视口坐标 → **不需要 scroll 换算** → 天然不漂移
2. **实测弹层尺寸**（`ResizeObserver` 或 mount 后 `getBoundingClientRect()`）→ 不用魔法数字
3. **真翻转**（先试下方，再试上方）
4. **容器相对 clamp** → 不会跑出 PDF 区域

**用 `fixed` 而不是 `absolute` 的代价**：弹层不随页面滚动 → 但 PDF 在内部容器里滚，
用户滚动 PDF 时选区会移走 → **这时应该直接隐藏弹层**（而不是跟着跑）。
→ **滚动时隐藏**（这正是 pdf.js 的做法）。

#### (b) 关闭条件（比它全）

| 触发                                        | 说明                             |
| ------------------------------------------- | -------------------------------- |
| `mousedown` 在弹层外                        | 标准做法                         |
| `Esc`                                       | 它**没有**，我们加               |
| 选区被清空（`selectionchange` → collapsed） | 它**没有**，我们加               |
| 滚动 / 缩放 / 翻页 / 换文档                 | 它**没有**，我们加（位置失效了） |
| 点击已有高亮                                | → 切换到"编辑高亮"模式           |

#### (c) 内容：可注入的**动作注册表**

**这是最关键的改进** —— 原项目是硬编码 JSX，我们做成**配置驱动**。

```ts
/** 选区浮层的动作 */
export interface SelectionAction {
  /** 唯一 key */
  key: string;
  /** 显示的图标（内置图标名，或自定义 ReactNode） */
  icon?: SelectionActionIcon | ReactNode;
  /** 提示文案 */
  label?: string;
  /** 点击回调（拿到选中的文本与几何） */
  onSelect?: (ctx: SelectionActionContext) => void;
  /** 显示条件（不满足就不显示） */
  when?: (ctx: SelectionActionContext) => boolean;
  /** 分组（组之间加分隔线） */
  group?: string;
  /** 排序（小的在前） */
  order?: number;
}
```

**内置图标**（包内提供，纯 SVG，无第三方依赖）：

```ts
export type SelectionActionIcon =
  | 'highlight' // 高亮笔
  | 'copy' // 复制
  | 'translate' // 翻译
  | 'note' // 笔记
  | 'ask' // 提问
  | 'explain' // 解释
  | 'delete'; // 删除
```

**内置动作**（包提供默认实现，宿主可覆盖/追加）：

| key         | 图标   | 行为                                                       |
| ----------- | ------ | ---------------------------------------------------------- |
| `highlight` | 荧光笔 | **打开颜色下拉**（内置 6 色 + 自定义）→ 触发 `onHighlight` |
| `copy`      | 复制   | `navigator.clipboard.writeText(text)`                      |
| `translate` | 翻译   | 触发 `onTranslate`（默认无操作 → 不显示）                  |
| `note`      | 笔记   | 触发 `onNote`                                              |
| `ask`       | 提问   | 触发 `onAsk`                                               |
| `explain`   | 解释   | 触发 `onExplain`                                           |
| `delete`    | 删除   | 触发 `onDeleteHighlight`（仅选中已有高亮时显示）           |

> **边界（很重要）**：包**只提供 UI + 事件**，**不做**翻译/提问/笔记的业务。
> 宿主不传 `onTranslate` → 这个按钮**不显示**（符合用户要求："如果宿主没配，就不展示"）。

#### (d) 颜色下拉（内置）

原项目有两种 UI（新高亮用 Dropdown.Button，编辑用内联色块）→ **不统一**。
我们统一成**一个下拉**：

```
[🖍] [📋] [🌐] [💬]  │  [▼]
                     └─ 色块网格: ●●●●●● + [自定义色]
```

- 点主按钮 = 用当前颜色高亮
- 点箭头 = 展开色板
- 色板 = 6 个预设 + 一个"自定义"（`<input type="color">`）

**颜色数据来源**：
- 包内 `DEFAULT_HIGHLIGHT_PALETTE`（6 色）
- 宿主可传 `highlightPalette` 覆盖/扩展（与现有 prop 一致）

#### (e) 视觉设计

参考 scholar-club 但**做得更精致**：

```
┌─────────────────────────────────┐
│  🖍  │  📋  │  🌐  │  💬  │  ▼   │   ← 圆角 8px, 白底, 阴影, 分组分隔线
└─────────────────────────────────┘
      ↑ 4px 间距的小箭头（指向选区）
```

- 圆角 8px、`box-shadow: 0 4px 16px rgba(0,0,0,.12)`
- 按钮 28×28，图标 16px，hover 浅灰底
- 选中态用主题色
- **小箭头**：指向选区中心（CSS 伪元素，位置跟着浮层走）
- 暗色主题跟随

### 4.3 API 设计

```tsx
<PdfViewer
  // 现有的...
  selectionActions={[
    // 宿主自定义（覆盖内置的 translate）
    {
      key: 'translate',
      icon: 'translate',
      label: '翻译',
      onSelect: ({ text }) => openTranslate(text),
    },
    // 宿主新增
    {
      key: 'summary',
      icon: <MyIcon />,
      label: '总结',
      order: 10,
      onSelect: ({ text, rects }) => summarize(text, rects),
    },
  ]}
  // 快捷方式（等价于上面的写法）
  onTranslate={({ text }) => openTranslate(text)}
  onNote={({ text }) => addNote(text)}
  onAsk={({ text }) => ask(text)}
  onExplain={({ text }) => explain(text)}
/>;
```

**规则**：
- 宿主传了 `onTranslate` → 显示"翻译"按钮
- 没传 → **不显示**
- `selectionActions` 里的项**覆盖**同名内置项
- `selectionActions` 为 `undefined` → 只显示内置的"高亮 + 复制"

### 4.4 新增文件

```
src/components/SelectionPopover.tsx      浮层组件（portal + fixed 定位）
src/components/SelectionPopover.css?     （并入 viewer.css）
src/core/selection/actions.ts            动作类型 + 内置图标 + 默认动作
src/core/selection/icons.tsx             内置 SVG 图标
src/hooks/useSelectionPopover.ts         定位逻辑（测量的、翻转的、clamp 的）
src/hooks/useSelectionPopover.test.ts
```

---

## 实施顺序与验证

| 步骤   | 内容                                           | 风险   | 验证                                     |
| ------ | ---------------------------------------------- | ------ | ---------------------------------------- |
| **S1** | reset button 默认样式（去黑框）                | 低     | E2E：computed `border-width = 0px`；截图 |
| **S2** | 修 `insertBefore` 崩溃 + 哨兵加 key + 按页隔离 | 低     | E2E：跨页选择 + 缩放，无 JS 错误         |
| **S3** | 改用 SVG clipPath 选区层                       | **中** | E2E：叠涂 = 1；选区起点 Δ；复制正常      |
| **S4** | 选区浮层（定位 + 动作注册表 + 色板）           | 中     | 新 E2E：定位/翻转/clamp/关闭             |

**回归**：现有 9 套 E2E（73 项断言）必须全绿。

---

## 需要你确认

1. **问题 2 换方案**：改用 SVG clipPath（pdf.js v6 的做法）？
   → 代价是要多写一个 SVG 层；收益是选区框精确 + 不叠涂。
   → 备选：保留 `line-height: normal`，把 `::selection` 降到 14% 妥协。

2. **浮层的动作清单**：内置哪些？
   → 我建议：🖍高亮（带色板）· 📋复制 · 🌐翻译 · 💬提问 · 📝笔记 · 🗑删除（编辑高亮时）
   → 翻译/提问/笔记宿主不配就不显示。

3. **浮层位置**：选区**下方**优先，空间不够翻到**上方**（你原话）。
   → 水平方向居中对齐选区，并 clamp 在 PDF 容器内。

4. **弹层里要不要"复制"按钮**？原 scholar-club **没有**（靠浏览器原生复制）。
   → 我建议**有**（更方便），但可以做成可选。

5. **滚动时**：隐藏浮层（推荐，pdf.js 做法）还是跟随滚动（保持相对选区位置）？
   → 我建议**隐藏**（跟随要每帧重算，且内滚容器用 fixed 不好做）。
