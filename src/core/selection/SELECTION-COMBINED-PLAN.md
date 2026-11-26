# 选区整体方案：字符级精度 + 反向选择

> 状态：**待评审** —— 源码未改动（已回退到 `f408667` 的选区逻辑 ✅）
> 依据：**真实 PDF 实测**（Playwright 驱动 demo / `paper.pdf`）

---

## 一、两个需求

| # | 需求 | 现状 |
|---|---|---|
| **A** | **字符级选框** —— 选一个字符不能涂一整块 | 已回退 ✅ 正常 |
| **B** | **反向选择** —— 从后往前选要正常 | ❌ 边界项丢失 |

---

## 二、两个需求是【正交】的

### 实测证据

```
【A】拖 30px 到 "ts in ovarian cancer" 正中间
  Chrome 选: "a" (1 字)
  Range 矩形:  [{"left":1168, "w":25}]   ← 字符级 ✅
  我们画的:    [{"left":1168, "w":25}]   ← 一致 ✅

【B】反向拖（右栏行尾 x=1425 -> 左栏 x=152）
  Range: start=dom#961(右栏 top=417) end=dom#968(左栏 top=485)
  Chrome 命中 8 项 | 我们覆盖 6 项 | 丢 2 ❌
  丢的是: dom#961【起点项】+ dom#968【终点项】❌
```

**结论**：
- **矩形来源**（`range.getClientRects()` ✅）决定**涂多准** —— 已经是字符级 ✅
- **DOM 顺序**决定**选哪一段** —— 反向时丢了边界项 ❌

两者是**不同的轴** ✅ -> 可以合起来 ✅

---

## 三、反向选择的根因（精确定位）

### 关键事实

**浏览器的 Range 永远 `start < end`**（文档顺序），与拖动方向无关 ✅

反向拖（右栏 -> 左栏）时：
```
鼠标起点: 右栏 top=417  ✅
Range.start: dom#961 = 【左栏】top=485  ✅  <- 浏览器归一化了 ✅
Range.end:   dom#968 = 【右栏】top=417  ✅
```

**所以：反向拖时，浏览器的"起点项"在 DOM 上是【靠后】的那个 ✅**

### 丢失的机制

浏览器**不给边界项的 rect** ✅（只给部分字符的 ✅）

```
浏览器给的 raw rect top 范围: 436 .. 462
起点项 dom#961 的 rect top=417  ❌ 不在里面
终点项 dom#968 的 rect top=485  ❌ 不在里面
```

`fillMissingRects` 会**补**上它们 ✅（补的是整个项的 rect ✅）
**但补上来之后，被后面的过滤弄丢了** ✅

### 丢在哪：两个地方

#### ① 垂直过滤的"只保留下界"

```ts
// useTextSelection.ts:852
const fromY = toContentY(dragStart.y, dragStart.scrollTop) - VERTICAL_TOLERANCE;
return r.top + r.height > fromY;
```

反向拖时，鼠标起点 y=426（**靠下**）✅
→ 起点项 top=417（**比起点更靠上**）✅
→ `417 > 426` ❌ -> **被丢掉** ✅ ❌

#### ② `drag-origin.ts` 的"按行分段 + 核心段判定"

终点项 dom#968 补进来后 ✅
-> 分行时因为 top=485 单独成组 ✅
-> 核心段判定：`segLeft(146) <= to(1425)` ✅ -> 是核心 ✅
-> -> **理论上应该保留** ✅
-> -> 但实测丢了 ✅ -> 说明**分行的垂直重叠**把它归到了别的组 ✅

---

## 四、方案

### 核心思路：**用 DOM 顺序决定"选哪一段"，用 Range 矩形决定"涂多准"**

```
浏览器 Range
  -> ① DOM 顺序裁剪（项级）      <- 解决 B ✅
  -> ② 矩形用 range.getClientRects()（字符级） <- 解决 A ✅
  -> ③ 离群项过滤（整页矩形 / 旋转文字 / 页边戳）
  -> ④ 基线裁剪
```

### 步骤 1：DOM 顺序裁剪模块（新增）

**位置**：`src/core/selection/dom-order.ts`（纯计算 ✅ 好单测 ✅）

```ts
export interface DomOrderItem {
  pageNumber: number;   // data-page-number ✅
  itemIndex: number;    // data-item-index ✅（新增 ✅）
  rect: ClientRectLike;
}

/** 按【文档顺序】裁剪 ✅ */
export function clipByDomOrder(input: {
  items: readonly DomOrderItem[];
  start: DomOrderItem | null;
  end: DomOrderItem | null;
}): { kept: ClientRectLike[]; dropped: ClientRectLike[] };
```

**算法**：
1. 按 `(pageNumber, itemIndex)` 升序排（= 文本流顺序 ✅）
2. 找起点/终点的下标 ✅
3. 保留 `[min, max]` 区间 ✅ -> **反向自动对称** ✅

**兜底**（关键 ✅）：
| 情况 | 行为 |
|---|---|
| 起点/终点不在文本层 | 全保留（点在空白处 ✅）|
| **找不到起点** | **退化到第 0 项** ❌ 不是全保留 ✅ |
| **找不到终点** | **退化到最后一项** ✅ |

> "找不到时全保留"会导致多选几十项 ✅ -> 必须收敛 ✅

### 步骤 2：文本层加 `data-item-index`

**位置**：`src/components/TextLayer.tsx`

```tsx
{items.map((item, index) => (
  <span
    data-page-number={pageNumber}
    data-item-index={index}   // <- 新增 ✅
```

- `items` 是 `layoutTextItems` 的产出 ✅ = **PDF 文本流顺序** ✅
- ⚠️ **不能用 `key` 代替** ✅（key 含位置 ✅ -> 缩放后会变 ✅）
- ⚠️ **不能按 y 排序** ✅（双栏要左栏全部再右栏 ✅）

### 步骤 3：矩形粒度 —— 字符级

**位置**：`src/hooks/useTextSelection.ts`

**关键**：`collectDomOrderItems` 现在用 `span.getClientRects()`（项级 ❌）
-> 要用 **Range 的矩形** ✅（字符级 ✅）

**做法**：
1. DOM 顺序裁剪**先**跑 ✅ -> 得到该项区间 ✅
2. 对区间内的**每一项** ✅ -> 用 Range 的字符级矩形 ✅
3. Range 的矩形怎么归属到项 ✅？
   -> **按矩形中心落在哪个项的范围内** ✅（简单 ✅ 够用 ✅）

**兜底**：某项没分到矩形 ✅ -> 用该项自己的矩形 ✅

### 步骤 4：边界项特殊处理

**边界项是"部分选中"** ✅ -> 浏览器不给完整 rect ✅

**做法**：
1. 起点项 / 终点项 ✅ -> 在项内部建 Range ✅
2. `setStart(textNode, startOffset)` ✅ -> `getClientRects()` ✅
3. 拿到**精确到那几个字**的矩形 ✅

> ⚠️ 这一步同时解决 A 和 B ✅

### 步骤 5：垂直过滤改成双向区间

**位置**：`src/hooks/useTextSelection.ts:852`

```ts
// ❌ 现在（只保留下界 -> 反向拖丢起点项 ✅ ❌）
const fromY = toContentY(dragStart.y, dragStart.scrollTop) - VERTICAL_TOLERANCE;
return r.top + r.height > fromY;

// ✅ 双向区间
const startY = toContentY(dragStart.y, dragStart.scrollTop);
const endY   = toContentY(dragEnd.y,   dragEnd.scrollTop);
const fromY  = Math.min(startY, endY) - VERTICAL_TOLERANCE;
const toY    = Math.max(startY, endY) + VERTICAL_TOLERANCE;
return r.top + r.height > fromY && r.top < toY;
```

**必须用 `dragEnd.scrollTop`** ✅（`dragEndRef` 里已记录 ✅）
-> 全部在**内容坐标**里算 ✅ -> 自动滚动不影响 ✅

### 步骤 6：剔除离群项

**位置**：新增 `src/core/selection/filter-outliers.ts`

| 保留 | 丢弃 |
|---|---|
| 正文 | 整页矩形（`height > 页高/3` ✅）|
| | 旋转文字（超高 ✅）|
| | 竖排页边戳（水平离群 ✅）|

**不做分行** ✅ -> 不依赖几何启发式 ✅

### 步骤 7：`drag-origin.ts` 的处理

它的"按行分段 + 核心段判定" ✅
-> DOM 顺序裁剪**完全替代**了它 ✅
-> **删除** ✅

**但要先确认** ✅：它还有没有别的用途 ✅
-> 查了 ✅ -> 只被 `useTextSelection` 调用 ✅ -> 可以删 ✅

---

## 五、改动清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `src/components/TextLayer.tsx` | 改 | 加 `data-item-index` ✅ |
| `src/core/selection/dom-order.ts` | **新增** | DOM 顺序裁剪 ✅ |
| `src/core/selection/dom-order.test.ts` | **新增** | 单测 ✅ |
| `src/core/selection/filter-outliers.ts` | **新增** | 离群项过滤 ✅ |
| `src/core/selection/filter-outliers.test.ts` | **新增** | 单测 ✅ |
| `src/hooks/useTextSelection.ts` | 改 | 换管线 + 字符级矩形 + 双向垂直 ✅ |
| `src/hooks/useTextSelection.test.ts` | 改 | mock 补 `data-item-index` ✅ |
| `src/core/selection/drag-origin.ts` | 删 | 逻辑迁到上面 ✅ |
| `src/core/selection/drag-origin.test.ts` | 删 | 迁到新模块 ✅ |
| `scripts/e2e-selection-dom-order.mjs` | **新增** | E2E ✅ |

---

## 六、测试

### 单测

**`dom-order.test.ts`**
| 用例 | 断言 |
|---|---|
| 单栏区间 | 区间内保留 ✅ 区间外丢弃 ✅ |
| **反向拖选** | **与正向完全对称** ✅ |
| 跨栏 | 区间内全保留 ✅ |
| 跨页 | 区间连续 ✅ |
| 起点不在文本层 | 全保留 ✅ |
| 找不到起点/终点 | 退化到边界 ✅ |
| **52-rect 回归** | **一个都不丢** ✅ |

**`filter-outliers.test.ts`**
- 整页矩形 / 旋转文字 / 页边戳剔除 ✅
- 缺参数跳过 ✅
- 全丢兜底 ✅

### E2E（Chrome 原生当 oracle）

**比较粒度必须是【项】** ✅ 不是【行】✅
（浏览器对同一视觉行会给多个 top 不同的 rect ✅）

| # | 场景 | 断言 |
|---|---|---|
| 1 | **选 1 个字符** | 涂的宽度 ≈ Chrome ✅（不是整块 ✅）|
| 2 | **反向拖** | 项集合 == Chrome ✅ |
| 3 | 跨栏拖 | 项集合 == Chrome ✅ |
| 4 | 正向拖 | 项集合 == Chrome ✅ |
| 5 | 页边戳页 | 不横跨整页 ✅ |
| 6 | 跨页 | 两页都在 ✅ |

### 回归

- 已有 8 个选区 E2E 全要跑通 ✅
- `pnpm test` ✅ / `pnpm verify`（9 门禁 ✅）

---

## 七、分步提交

```
1) feat(selection): 文本层加 data-item-index
2) feat(selection): 新增 dom-order.ts + 单测
3) feat(selection): 新增 filter-outliers.ts + 单测
4) refactor(selection): 换管线（DOM 裁剪 + 字符级矩形）
5) fix(selection): 垂直过滤改双向区间
6) fix(selection): 边界项用字符级矩形
7) test(selection): 新增 e2e-selection-dom-order.mjs
8) chore(selection): 删除 drag-origin.ts
```

**第 4、5、6 步必须分开** ✅
-> 上次一起改 ✅ -> 分不清是哪个引起的 ✅ ❌

---

## 八、风险

| 风险 | 对策 |
|---|---|
| DOM 顺序裁剪后**边界项**没矩形 | 步骤 4 专门处理 ✅ |
| 字符级矩形**跨栏归属**错 | 按中心点归属 ✅ + 回退项级 ✅ |
| 垂直过滤双向后**放宽太多** | 用内容坐标 ✅ + 20px 容差 ✅ |
| 基线裁剪把字符级矩形**拉回整行** | 部分选中的项**跳过**基线裁剪 ✅ |
| `drag-origin.ts` 删了**别处还在用** | 先 grep 确认 ✅（已确认 ✅）|

---

## 九、需要你确认

1. **分 8 步提交** ✅ —— 同意吗？（第 4/5/6 步分开 ✅）
2. **基线裁剪跳过"部分选中"的项** ✅ —— 同意吗？
   - 代价：部分选中时高亮块会比整行选中时"高一点" ✅
3. **删掉 `drag-origin.ts`** ✅ —— 同意吗？
4. **要��修 `CHANGELOG.md` 版本号**吗？（`0.2.0` vs `package.json` 的 `0.1.0` ✅）
