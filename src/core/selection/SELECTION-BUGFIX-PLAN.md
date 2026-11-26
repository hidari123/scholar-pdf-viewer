# 选区 Bug 修复方案（DOM 顺序 + 垂直过滤解耦）

> 状态：**待评审** —— 源码未改动
> 依据：**真实 PDF 实测**（Playwright 驱动 demo  / `paper.pdf`  / 页 2）

---

## 一、结论先说

你判断得对 —— **"第二栏上面没选中"和"反着选只有 2 行"是同一个 bug**

而且根因不是"反着选"这个方向本身，而是：

> **垂直过滤（只看 y）和 DOM 顺序（文档序）是两个独立的轴，
> 但当前代码让垂直过滤在 DOM 裁剪【之后】又砍了一遍 → 误伤  **

实测证据（页 2 反向拖）：

```
鼠标:  右栏(top=275) 行尾 x=1448  ->  左栏(top=300) x=729   （往左、往下拖）

浏览器 Range: start=dom#463 "Celecoxib"(左栏)
              end  =dom#478 "t the proliferation and"(右栏)
-> 浏览器把方向【归一化】了  -> 永远 start < end
-> Range 覆盖 DOM 区间 [463..478]

原生: 192 字符 / 16 项
我们: 15 项  ❌ 丢了 1 项
  丢的是 dom#464 = "(a COX2 inhibitor) was saf"（右栏 top=224）
```

**为什么丢**：垂直过滤的下界 `fromY = 3793`（内容坐标）
→ dom#464 的内容坐标是 `3747` → 在下界之上 → **被丢掉** ❌
→ 但它**在 DOM 区间 [463..478] 里** → **应该保留**

---

## 二、两个 bug 的同一个根因

### 现象 A："第二栏上面部分没被选中"

跨栏拖（右栏 → 左栏）时：
- 起点在**右栏**，终点在**左栏**
- 浏览器的 Range = DOM 区间，**必然包含右栏从顶到终点的全部**
- 但我们的**垂直过滤**用**起点 y** 做下界
- → 右栏里**比起点高**的行（右栏的上半部分）**全被丢掉** ❌

> 实测（页 3  跨栏拖）：
>
> ```
> 浏览器给 10 个 rect（top = 350/350/370/370/390×6）
> 垂直过滤后只剩 6 个  -> top=350 和 370 那两行没了
> -> 那两行正是【右栏的上半部分】
> ```

### 现象 B："反着选只能显示 2 行"

往上拖时：
- 起点在**下面**，终点在**上面**
- 垂直过滤的"**只保留下界**"（`fromY = 起点y`）→ **比起点高的行全丢** ❌

> `useTextSelection.ts:848-851` 的注释写着"**上界不能用**"——
> 那个结论**只在"往下拖"时成立** ✅，往上拖就是错的 ❌

---

## 三、为什么"直接用 DOM 顺序"上次没成功

上一轮我同时改了两处（DOM 顺序 + 垂直过滤），结果出现新问题：

```
afterDomOrder: 7   （= Chrome 的 7  完美）
afterVertical: 37  （❌ 垂直过滤把范围又放宽了 ✅）
```

原因：
1. 我把**垂直过滤改成了双向区间**（`min(startY,endY)` ~ `max(startY,endY)`）
2. 但**过滤顺序**是"垂直过滤 → DOM 裁剪"→ 起点项被垂直过滤掉
3. → `clipByDomOrder` 找不到起点 → **退化成"全部保留"** ❌ → 多选 33 项 ❌

**教训**：
- **顺序必须反过来**：先 DOM 裁剪（决定语义），后垂直过滤（只修自动滚动的副作用）
- 而且"找不到起点就全保留"这个**兜底太危险** ❌ → 改成**收敛到最近的边界** ✅

---

## 四、修复方案

### 步骤 1：DOM 顺序裁剪（新增 `src/core/selection/dom-order.ts`）

**纯计算模块 / 零 DOM 依赖 / 好单测 **

```ts
export interface DomOrderItem {
  pageNumber: number; // data-page-number
  itemIndex: number; // data-item-index  （新增）
  rect: ClientRectLike;
}

/** 按【文档顺序】裁剪*/
export function clipByDomOrder(input: {
  items: readonly DomOrderItem[];
  start: DomOrderItem | null;
  end: DomOrderItem | null;
}): { kept: ClientRectLike[]; dropped: ClientRectLike[] };
```

**算法**：
1. 按 `(pageNumber, itemIndex)` 升序排（= 文本流顺序）
2. 找起点/终点的下标 `iStart` / `iEnd`
3. 保留 `[min, max]` 区间内的项

**关键兜底**（上次踩的坑）：
| 情况                            | 行为                                   |
| ------------------------------- | -------------------------------------- |
| 起点/终点不在文本层             | **全保留**（点在空白处  / 保守）       |
| **找不到起点**（被过滤掉了 ✅） | **退化到第 0 项** ✅ ❌ 不是全保留 ✅  |
| **找不到终点**                  | **退化到最后一项** ✅ ❌ 不是全保留 ✅ |

> 最后两条是这次新加的 —— 全保留会导致"多选几十项" ❌

### 步骤 2：文本层加 `data-item-index`（`src/components/TextLayer.tsx`）

```tsx
{items.map((item, index) => (
  <span
    data-page-number={pageNumber}
    data-item-index={index}   // ← 新增
    ...
```

- `items` 由 `layoutTextItems` 按 **PDF 原始顺序**产出 （= 文本流顺序）
- ⚠️ **不能用 `key` 代替**：key 里带位置和文本 → 缩放后会变
- ⚠️ **不能改 `items` 的顺序**：按 y 排序会让左右栏交替 → 跨栏就错了

### 步骤 3：管线顺序改成「先 DOM，后垂直」（`src/hooks/useTextSelection.ts`）

```
浏览器 rects
  → ① 【DOM 顺序裁剪】        ← 决定"选了哪一段"（语义）
  → ② 【垂直过滤】             ← 只修"自动滚动向前扩展"的副作用（修正）
  → ③ 【剔除离群项】           ← 整页矩形 / 旋转文字 / 竖排页边戳
  → ④ 基线裁剪 → 自绘
```

**关键**：① 必须在 ② 之前
→ 否则起点项被 ② 过滤掉 ✅ → ① 找不到起点 ✅ → 退化成全保留 ✅ ❌

### 步骤 4：垂直过滤改成双向区间（`useTextSelection.ts`）

```ts
// ❌ 现在（只保留下界 ✅ -> 往上拖就错 ✅）
const fromY = toContentY(dragStart.y, dragStart.scrollTop) - VERTICAL_TOLERANCE;
return r.top + r.height > fromY;

//  改成（双向）
const startY = toContentY(dragStart.y, dragStart.scrollTop);
const endY   = toContentY(dragEnd.y,   dragEnd.scrollTop);
const fromY  = Math.min(startY, endY) - VERTICAL_TOLERANCE;
const toY    = Math.max(startY, endY) + VERTICAL_TOLERANCE;
return r.top + r.height > fromY && r.top < toY;
```

⚠️ **必须用 `dragEnd.scrollTop`** （`dragEndRef` 里已记录）
→ 全部在**内容坐标**里算 → **自动滚动不影响**

### 步骤 5：剔除离群项（新增 `src/core/selection/filter-outliers.ts`）

替代 `drag-origin.ts` 里的行分段/空洞判断

| 保留 | 丢弃                          |
| ---- | ----------------------------- |
| 正文 | 整页矩形（`height > 页高/3`） |
|      | 旋转文字（超高）              |
|      | 竖排页边戳（水平离群）        |

**页边戳判据**：用 `columns.ts`（**已存在但是死代码 **）算栏
→ 矩形中心不在任何栏内 → 剔除

### 步骤 6：删掉 `drag-origin.ts`

它的"按行分段 + 空洞断开 + 核心段判定"三件事
→ 实测会把 **7 个视觉行分成 3 组** ✅ → **整行丢失 / 每行少选** ✅ ❌
→ 这些判断由 ① DOM 顺序做 → 更准

**保留** `drag-origin.test.ts` 里"剔除页边戳"的用例 → 迁到新模块

---

## 五、测试

### 单元测试

**`src/core/selection/dom-order.test.ts`**（新增）
| 用例           | 断言                            |
| -------------- | ------------------------------- |
| 单栏区间       | 区间内全保留  区间外全丢        |
| 反向拖动       | 与正向对称                      |
| 跨页           | 区间连续                        |
| 起点不在文本层 | 全保留                          |
| **找不到起点** | **退化到第 0 项**（不是全保留） |
| **找不到终点** | **退化到最后一项**              |
| **回归**       | 7 行 / 52 rect → **一个都不丢** |

**`src/core/selection/filter-outliers.test.ts`**（新增）
- 整页矩形剔除 / 旋转文字剔除 / 页边戳剔除
- 没传 `pageHeight` → 跳过该判断
- 没传 `bodyRange` → 跳过该判断
- **全被丢掉 → 返回原来的**（保守）

### E2E（新增 `scripts/e2e-selection-dom-order.mjs`）

**核心方法：用 Chrome 原生当 oracle **

⚠️ **比较粒度必须是【项】，不是【行】**
→ 浏览器对同一视觉行会给多个不同 top 的 rect （行盒 vs 字形盒）
→ 按 top 分桶 ✅ → 两边分桶方式不同 ✅ → 必然对不上 ✅ ❌
→ 唯一客观的粒度是**文本项**

| #   | 场景                | 断言                           |
| --- | ------------------- | ------------------------------ |
| 1   | **单栏多行拖选**    | 项级：丢 0  多 0               |
| 2   | **跨栏拖（右→左）** | 右栏上半部分被选中             |
| 3   | **反向拖（右→左）** | 选区行数 >= 3  （不再是 2 行） |
| 4   | **正向拖（左→右）** | 与 Chrome 一致                 |
| 5   | 页边戳页            | 选区不横跨整页                 |
| 6   | 跨页                | 两页内容都在  页眉未被误选     |

### 回归

- 已有 8 个选区 E2E 全要跑通
- `pnpm test`（当前 917 个）
- `pnpm verify`（9 道门禁）

---

## 六、改动清单

| 文件                                         | 类型     | 说明                        |
| -------------------------------------------- | -------- | --------------------------- |
| `src/components/TextLayer.tsx`               | 改       | 加 `data-item-index`        |
| `src/core/selection/dom-order.ts`            | **新增** | 文档顺序裁剪（纯计算）      |
| `src/core/selection/dom-order.test.ts`       | **新增** | 单测                        |
| `src/core/selection/filter-outliers.ts`      | **新增** | 离群项过滤                  |
| `src/core/selection/filter-outliers.test.ts` | **新增** | 单测                        |
| `src/core/selection/drag-origin.ts`          | 删       | 逻辑迁到上面两个            |
| `src/core/selection/drag-origin.test.ts`     | 删       | 迁到新模块                  |
| `src/core/selection/columns.ts`              | 改       | 从死代码接进链路            |
| `src/hooks/useTextSelection.ts`              | 改       | 换管线 + 垂直过滤双向       |
| `src/hooks/useTextSelection.test.ts`         | 改       | mock 要补 `data-item-index` |
| `scripts/e2e-selection-dom-order.mjs`        | **新增** | E2E（Chrome 为 oracle）     |

---

## 七、分步提交（每步可独立测试、可独立回退）

```
1) feat(selection): 文本层加 data-item-index
2) feat(selection): 新增 dom-order.ts + 单测
3) feat(selection): 新增 filter-outliers.ts + 单测
4) refactor(selection): useTextSelection 切到新管线（先 DOM 后垂直）
5) feat(selection): 垂直过滤改成双向区间
6) feat(selection): columns.ts 接入（页边戳剔除）
7) test(selection): 新增 e2e-selection-dom-order.mjs
8) chore(selection): 删除 drag-origin.ts
```

**第 4 步和第 5 步必须分开提交**
→ 上次就是一起改才分不清是哪个引起的 ✅ ❌

---

## 八、风险

| 风险                         | 对策                                                    |
| ---------------------------- | ------------------------------------------------------- |
| `data-item-index` 缩放后变化 | 索引只需**同一时刻自洽**  缩放时 rect 和 items 一起重算 |
| 宿主没传 `baselines`         | 页边戳剔除退化为"用拖动 x 范围判断"  保守               |
| `computeColumns` 误判单栏    | 已有"单栏快速判断"  + 加"找不到栏就不剔除"兜底          |
| 改动面大                     | 分步提交  每步跑 `verify` + 全部选区 E2E                |
| 上次的"多选 33 项"           | 兜底改成"退化到边界"  + E2E 断言"多选 0"                |

---

## 九、需要你确认

1. **第 4、5 步分开做** 你同意吗？（上次一起改 → 分不清）
2. **E2E 用 Chrome 原生当 oracle** 同意吗？（唯一客观标准）
3. **`drag-origin.ts` 直接删** 还是保留但不再调用？
4. **是否顺手修 `CHANGELOG.md` 版本号**（`0.2.0` vs `package.json` 的 `0.1.0`）？
