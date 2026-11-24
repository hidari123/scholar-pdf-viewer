# 第 15 轮 · ③ 搜索高亮定位不准（bug）

> 本轮记录已从 `DEVLOG.md` 拆出。

# 第 15 轮 · ③ 搜索高亮定位不准（bug）

> 用户反馈："搜索功能高亮定位不准确 这个是个bug 有的不准"

## 实测出来的根因（2 个）

在真实 arXiv PDF（`demo/public/samples/local.pdf`，18 页）上量出来：

```
索引的项: 161 个 → 文本 3010 字符
渲染的项: 112 个 → 文本 2553 字符
差: 457 字符
```

### 根因 1：旋转文字

- 渲染侧 `layoutTextItems` 会跳过**旋转文字**（图里的标签、页边戳）
- 索引侧 `selectSearchItems` 只跳过"空项 / 没有 transform 的项" → **旋转文字被收进去了**
- → 渲染文本比索引文本**少 457 字符** → 从那一点开始**偏移全错位**
- → 高亮跑到别的字上 ❌

### 根因 2：pdf.js 会"合并" item

- `getTextContent()` 默认会 `combineTextItems`
- 合并与否取决于 `item.fontName` / `item.height` 等字段
- 宿主给索引的那次调用如果**丢了字段**（demo 里就没传 `fontName`）
- → **两次调用的 item 边界不一样** → 索引 161 项 vs 渲染 112 项
- → 光靠"下标对齐"永远对不上

## 修法

### ① 索引也跳过旋转文字（`src/core/search/align.ts`）

- `selectSearchItems(items, { viewport })` 新增 `viewport` 选项
- 新增 `isRotatedItem(item, viewport)` —— 判据和渲染侧 `isRotatedAngle` **完全一致**（1°）
- `PdfSearch.buildIndex` 新增 `viewport?: (pageNumber) => viewport` 选项
- → 索引文本和渲染文本**完全一致**（实测 2553 = 2553 ✅）

### ② 渲染侧按"字符位置"映射，不靠下标（`src/core/search/align.ts`）

- 新增 `mapOffsetToRenderedByText(renderedTexts, start, length)`
- → 把渲染的项按**字符数**累加 → 每个项覆盖一段字符区间
- → 命中的字符偏移落在哪一段 → 就是哪个项
- → **不依赖索引的项边界** → 两边切分不同也不影响 ✅
- `highlight.ts` 的 `mapRangeToItemsByText` 改用它

### ③ 索引变化要通知（`src/core/search/search.ts`）

- `PdfSearch` 新增 `subscribeIndexChange(listener)` + `getIndexVersion()`
- → 索引是**异步**建的 → 组件第一次渲染时索引可能还是空的
- → 组件订阅 → 索引一变就重渲染 ✅
- `PdfViewer` 新增 `searchIndexVersion` state + 订阅 effect

### ④ `alignRenderedToIndex`（按内容对齐的兜底）

- 索引项和渲染项**边界不同**时，按**文本内容**对应
- 优先"完全相同" → 再"包含" → 再"被包含"
- 找不到就跳过（**宁可漏画，也不要画到错的字上**）

## 踩过的坑：验证方法本身是错的 ⚠️

第一版 E2E（`scripts/e2e-search-accuracy.mjs`）用"和高亮矩形有重叠的 span 的文字"来判断对错 →
**永远对不上**，因为：

- 文本层的 span 是**按屏幕坐标排序**的
- 高亮矩形是按**字符比例**裁出来的
- → 一个 span 可能被多个高亮矩形盖住 → 拼出来的文字是乱的

**正确做法**：按**比例**算出"命中落在 span 的哪个字符" → 再看那几个字符是不是关键词。

改完之后才看到真实结果（5/5、30/30、30/30、37/37）。

## 影响

- `Page` 的 `onTextItems` 改用 `layoutTextItemsWithIndexOffsets`（**不排序**，保持 PDF 顺序）
- `Page` 新增 `onIndexOffsets` / `indexItemTexts` 两个 props
- `PdfViewer` 的 `searchRectsByPage` 改成"先算 `searchOffsetsByPage` → 再 `hitsToRects`"
- `src/core/search/item-alignment.ts` → 改名 `src/core/search/align.ts`（职责更清楚）

## 验证结果

```
搜索 "Auditing":   5 个高亮， 5 个命中位置正确
搜索 "Agent":     30 个高亮，30 个命中位置正确
搜索 "benchmark": 30 个高亮，30 个命中位置正确
搜索 "harness":   37 个高亮，37 个命中位置正确
结果：5/5 通过
```

- `pnpm verify`: **8/8 全绿**
- `pnpm test`: **454 passed**（37 个文件）
- E2E: **337/337 —— 0 个套件失败**（25 个套件）
- 截图确认："An End-to-End **Agent** Auditing Engine" 的 "Agent" **精确高亮** ✅
- 提交：`a00f4dc`

## 为什么这么做

搜索高亮是"字符偏移"→"矩形"的转换，**偏移是相对索引文本的**。
只要索引文本和渲染文本不是同一份，偏移就必然错位。

实测证明这两者会不一致（pdf.js 的 item 合并 + 旋转文字跳过），
所以不能假设它们一样 → 必须**主动对齐**：

1. 让索引用**同样的判据**跳过旋转文字（治本）
2. 映射时按**字符位置**而不是项下标（治标但更稳）
3. 索引异步建好要**通知**组件重算（否则永远算不对）

---
