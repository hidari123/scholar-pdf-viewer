# 第 14 轮：4 个用户反馈（全部修完 + 测试 + 提交）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 第 14 轮：4 个用户反馈（全部修完 + 测试 + 提交）

用户提了 4 个问题（带截图）：

1. **多行选择中间漏选**（用户特别强调"尤其是第一条 认真排查问题"）
2. **导出带高亮的 PDF 后 hover 出现乱码批注**
3. **高亮浮层改成 4 个按钮**（添加批注 / 选颜色 / 复制 / 删除）+ WPS 式小便签批注
4. **打印预览效果还是不对**

---

### ① 多行选择"中间有的没有底色"（认真排查，挖出 4 个根因）

用户原话：

> "现在选择文字的时候如果选择了多行 中间有的会没有底色，就是看起来漏选了一些地方，
> 如图，这个问题还没修复，高亮就没这个问题。"

**截图分析**：图里是真实 PDF（arXiv 论文）的 **figure caption** —— 一段混合字号的正文
（普通 20.6px + 上标 16px + 粗体）。

**用户说的"高亮就没这个问题"是对的** —— 高亮走的是 `AnnotationLayer` +
归一化的 `NormPosition`，而**选区**走的是 `buildSelectionShapes` → `clipToBaseline`
→ `optimizeClientRects` 这条路。

#### 复现与量化

写了临时脚本，模拟"拖选多行"，然后**逐个 span 算覆盖率**（用 span 自己的
`getBoundingClientRect` 和自绘矩形做交集）：

```
修复前: 26 个被选中的 span 里 9 个漏选（0% 覆盖）
  944,1530 " "                        ← 距拖动终点 473px
  953,1530 "(a)"                      ← 482px
  985,1530 "An Agent Task Protocol"   ← 514px
  1066,1598 "correctness"             ← 595px
  166,1621 "only about 0.42–0.77…"   ← 整行都没了
```

#### 根因 1：`filterByDragOrigin` 的距离阈值把**行尾**丢掉了

浏览器把选区**扩展到整行**（不只是行首，还有行尾）：

```
拖动:  x=171 → 471
选区:  x=166 → 1242     ← 整行！
```

→ 之前按"离拖动范围 ≤ 450px"过滤
→ **行尾离拖动终点 473~635px** → 被丢掉 → **行尾整段没底色** ❌

**修法**：改成按**"同一视觉行内的连续性"**判断 —— 看的是**段与段之间的空隙**，
不是段与拖动范围的**距离**。

**阈值怎么定**（实测扫了 6 页共 **1478 个 span 间隙**）：

```
  0- 49px: 1302 个   ← 正常词距
 50- 99px:   91 个
100-149px:   28 个
150-199px:    6 个
250-399px:    3 个
──────────────────── ← 明显的断层
750-949px:   48 个   ← 页边戳（逐字符竖排）
```

→ 正常文字的词距最大 ~200px，页边戳是 750px+
→ 阈值取 **400px**（在断层中间，很安全）

#### 根因 2：行分组的 key 用错了 → 同一行被拆成两组

浏览器的每个 span 会给**两个** rect：

```
166,1526 106x27   ← 行盒（高 27）
166,1530 106x21   ← 字形盒（高 21）
```

→ 它们的**中点**差 5px → 用中点分组 → **同一行被拆开** ❌
→ 后果：行首的延伸和正文分到两组 → 互相看不到 → **行首被丢掉**

→ 改成按**垂直重叠**分组（不再用中点）。

#### 根因 3（最隐蔽）：`mouseup` 监听在容器上，**根本没触发**

```
浏览器原生 rects（21 个）: 605,381 / 613,381 / 637,385 …
自绘 rects（8 个）:         238 / 381 / 385       ← 378 那行没了
```

→ `mouseup` 监听在 **容器**上 → 拖动结束时鼠标已经不在容器里了 → **没触发**
→ `computeGeometry` 永远停留在 `selectionchange` 的那一次
→ 而那一次的 Range **还没稳定**（实测只有 1 个矩形）
→ **部分行没底色** ❌

**修法**：

- `mouseup` 监听改到 **document**（一定能收到）
- 再**延后一帧 + 一个宏任务**再算（此时浏览器的 Range 已经稳定）

#### 根因 4：浏览器在选区边界处**不产生 client rect**

```
浏览器原生 rects: 605,381 8x17 / 613,381 5x17 / 637,385 149x23 …
被选中的 span:    787,381 8x17   ← "Zhang*" 的星号
```

→ `range.intersectsNode(span)` 说它**被选中了**
→ 但 `getClientRects()` **没给它任何矩形** → 自绘层漏掉这一小块 ❌

**修法**：新增 `fillMissingRects()`

→ 找出所有 `intersectsNode` 为真的 span
→ 找出**没有对应 client rect** 的
→ 用它自己的 `getBoundingClientRect()` **合成一个矩形**

→ 我们本来就有每个字的确切位置（文本层）→ **补出来的比浏览器的更准**

#### 结果

```
修复前: 26 个 span 里 9 个漏选
修复后: 26 个 span 里 0 个漏选
        （最后 1 个是浏览器自己只选了 304px → 我们画得和浏览器完全一致）
```

**测试**：

- 单测（`src/core/selection/drag-origin.test.ts`，13 项）
- E2E（`scripts/e2e-selection-line-end.mjs`，4 项）

---

### ② 导出 PDF 的批注文字乱码（hover 弹乱码）

用户原话：

> "导出带高亮的pdf之后 hover到pdf的高亮上会出来乱码批注 明明没有批注"

**根因**：`PDFHexString.of()` 把字符串**当原始字节**写进 PDF：

```ts
dict.set(PDFName.of('Contents'), PDFHexString.of(contents)); // ❌
```

实测（pdf-lib）：

```
PDFHexString.of('中文测试 Hello')       → <中文测试 Hello>          ← ❌
PDFHexString.fromText('中文测试 Hello') → <FEFF4E2D65876D4B8BD5002…>  ← ✅
```

- `of()` 把 JS 字符串**当成字节序列**直接写进 PDF
- 阅读器按 **PDFDocEncoding** 解码 → 中文全部变成乱码
- `PDFString.of()` 也不行（literal string，同样按 PDFDocEncoding 解码）

**修法**：用 `PDFHexString.fromText()`（**UTF-16BE + BOM**）。

**测试**：

- 单测（`src/core/export/export-pdf.test.ts`，10 项）
- E2E（`scripts/e2e-export-pdf-encoding.mjs`，7 项）

```
/Contents 原始值: <FEFF006E00200045006E0064002D0074006F002D0045006E0064>
PASS **是 UTF-16BE + BOM**（FEFF 开头 → 阅读器能正确识别中文）
```

---

### ③ 高亮浮层改 4 个按钮 + WPS 式小便签批注

用户原话：

> "pdf高亮区域选中后目前三个选项里面 第一个是高亮 但是没有什么效果
> 可以改成四个按钮 第一个是添加批注 具体添加方式和wps的批注一样
> 也是加一个小便签纸一样的在上面 hover会展示出来
> 第二个是选择高亮颜色 第三个是复制 第四个是删除"

#### 改动

**① 4 个按钮，顺序严格按用户要求**

```
添加批注 / 选择高亮颜色 / 复制 / 删除
```

`buildHighlightActions()` 重写：`order` 10 / 20 / 30 / 40，标签中文。

**② "选择高亮颜色"之前"没有什么效果" —— 现在能用了**

**根因**：颜色下拉只在 `BUILTIN_ACTION_KEYS.highlight`（**选区**浮层的 🖍）时展开，
**高亮浮层**的换色按钮走不到那个分支 → 点它什么都不会发生。

**修法**：

- 判断条件覆盖**两个** key（`highlight` + `highlight-color`）
- **主按钮**现在也直接展开下拉（之前只有小箭头能展开）
- 小箭头的 `aria-label` 改成"展开颜色下拉"（和主按钮区分开）

**③ WPS 式小便签批注**

- **新增** `src/core/annotation/sticky-note.ts`（纯逻辑，零 React）
  - `AnnotationRecord`（id / highlightId / content / position / createdAt）
  - `stickyNotePosition()` —— 默认放在高亮的**右上角**（WPS 的做法）
- **新增** `src/components/StickyNoteLayer.tsx`
  - 高亮旁边渲染一个**小便签图标**（纸片 + 折角的 SVG）
  - **hover** → 显示**便签内容**（带边框 + 阴影的纸片）
  - 内容用 `visibility` 而不是 `display:none` → 保留在无障碍树里（读屏能读到），
    但 `visibility:hidden` 时**不接收鼠标事件** → 不会挡住下面的文字 ✅
- **新增** `PdfViewer` 的 props
  - `onHighlightComment?: (id: string) => void` —— 抛事件（宿主弹编辑框 + 存）
  - `stickyNotes?: AnnotationRecord[]` —— **受控**（包不存数据）
  - `onAnnotationClick?: (annotation: AnnotationRecord) => void`

⚠️ **包的边界**：批注内容怎么编辑、怎么存 → 宿主的事（换后端不用改包）。

**测试**：

- 单测（`src/core/selection/highlight-actions.test.ts`，9 项 +
  `src/core/annotation/sticky-note.test.ts`，4 项）
- E2E（`scripts/e2e-highlight-actions4.mjs`，12 项）

```
浮层按钮: ["添加批注","选择高亮颜色","展开颜色下拉","复制","删除"]
PASS **顺序是：添加批注 / 选择高亮颜色 / 复制 / 删除**
PASS **"选择高亮颜色"能展开颜色下拉**（之前"没有什么效果"） - 0 → 1
PASS **点了"添加批注" → 出现小便签** - 1 个
PASS **hover 小便签 → 显示批注内容**（WPS 的行为）
```

**顺带修了 2 个被我的改动打破的旧测试**
（`e2e-selection-popover.mjs` / `e2e-selection-shape.mjs` 用 `aria-label` 定位箭头按钮
→ 箭头改名后失效 → 改成用 **class** 定位）

---

### ④ 打印预览（18 页的 PDF 曾被印成 33 页，且内容被裁掉）

用户原话：

> "目前的打印预览效果还是不对"

**这次挖出了 6 个叠加的 bug**（每一个都会让预览坏掉）。

#### ① 打印变量**只在 `print()` 里写** → Ctrl+P 拿不到

打印 CSS 依赖 `--scpdf-print-scale` / `--scpdf-print-page-height`，
但之前**只在点工具栏打印按钮时**才写。

→ 用户按 **Ctrl+P**（浏览器的打印预览）**不会走 `print()`**
→ 变量是空的 → `scale(1)` + `height: 0` → **页被裁掉 / 消失** ❌

**修法**：改成 **effect 一直维护**（页尺寸变化时更新），打印完**不再恢复**
（这些变量只在 `@media print` 里用 → 屏幕显示不受影响）。

#### ② CSS 变量名和 JS 写的**对不上**

```
JS 写的是: --scpdf-print-page-height
CSS 读的是: --scpdf-page-height      ← ❌ 名字不一样
```

→ 变量**永远取不到** → 布局盒没被缩掉 → **一堆空白页** ❌

#### ③ 缩放算的是"物理比例"，却乘到了**屏幕像素**上

```
屏幕上的页: 1407.6 × 1821.6 px      ← "适合宽度"的缩放（2.3×）
PDF 物理尺寸: 216 × 279 mm
A4 可打印区: 703 × 1032 px

旧做法（物理比例 0.861）: 1213 × 1569 px = 322 × 415 mm
  → 远超 A4 → **18 页印成 33 页**（每页溢出到第二张纸）❌

正确做法: min(703/1407.6, 1032/1821.6) = 0.499
  → 703 × 909 px = 186 × 240 mm → **正好落在 A4 可打印区里** ✅
```

**新增** `computePrintScaleForRender()`（按**渲染后的像素**算缩放）。

#### ④ 内联样式盖过打印 CSS

- `.scpdf-pages` 的 `height` 是内联的（`pageTops.at(-1)`）→ `height: auto` **没生效**
  → 容器仍占 **33093px** → 打印机按 1033px 一页切 → **33 页** ❌
- `.scpdf-page` 的 `width`/`height` 也是内联的 → 打印规则**盖不过** ❌

**修法**：打印 CSS 里该用 `!important` 的地方都用上。

#### ⑤ `transform: scale()` + `calc()` → **缩了两次**

```
transform: scale(s)  → 视觉缩了，但**布局盒不变** → 每页后面多一截空白
width/height: calc(W × s) → 布局盒也缩 → 视觉 = W × s × s（实测 351px，缩过头）
```

**修法**：改用 **`zoom`**（同时改布局盒和视觉）→ 只缩一次。

#### ⑥ `zoom` 加在**页**上 → canvas 被继承又缩一次

```
zoom 加在 .scpdf-page 上:
  → 页 = 351px，canvas = 703px  → **canvas 比页还宽** → 右边被裁掉 ❌
  → 截图上表现为标题只显示 "An End-to-End A"

zoom 加在 .scpdf-pages 上:
  → 整个内容树只缩一次 ✅
  → 页 = 703px，canvas 也 = 703px ✅
```

#### 结果

```
修复前: 原 PDF 18 页 → 打印出来 33 页（大半是空白），内容被裁掉
修复后: 原 PDF 18 页 → 打印出来 18 页 ✅，内容完整 ✅
```

**测试**：E2E（`scripts/e2e-print-preview.mjs`，7 项）+ 单测
（`src/core/print/index.test.ts`，16 项）

---

## 本轮汇总

| 项                      | 提交      | 测试             |
| ----------------------- | --------- | ---------------- |
| ① 多行选择漏选          | `54e4988` | 单测 13 + E2E 4  |
| ② 导出 PDF 批注乱码     | `2fdd3fd` | 单测 10 + E2E 7  |
| ③ 4 个按钮 + 小便签批注 | `3713538` | 单测 13 + E2E 12 |
| ④ 打印预览              | `440feef` | 单测 16 + E2E 7  |

**最终状态**：

- `pnpm verify`: **8/8 全绿**
- `pnpm test`: **439 passed**（36 个文件）
- E2E: **337/337 —— 0 个套件失败**（25 个套件）

---
