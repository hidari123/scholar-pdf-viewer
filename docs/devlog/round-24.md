# 第 24 轮：修 7 个用户反馈的 bug（2026-11-23） / ① 文字颜色完全失效（**根因在第 24 轮漏掉了**）

> 本轮记录已从 `DEVLOG.md` 拆出。

# 第 24 轮：修 7 个用户反馈的 bug（2026-11-23）

用户提了 7 个问题（其中问题 1 被要求"再做一遍"、问题 7 被澄清"是跨页后的工具栏定位"）。
**每个问题一个 commit**，共 7 个 commit。

| commit    | 修的问题                                          |
| --------- | ------------------------------------------------- |
| `f9d810e` | ① 中英文混杂 + "语言自己会动来动去"（4 个真 bug） |
| `5572f52` | ⑥ 文字颜色 / 清空格式                             |
| `d9abd77` | ② 高亮块被"选中" + ④a 光标不变小手                |
| `9102fc0` | ⑦ 跨页选区后浮层定位跑偏 + 往下滚会消失           |
| `bd4efb6` | ③ 批注时"选中效果"消失                            |
| `7812ec1` | ⑤ 批注框贴着屏幕右边                              |
| `17d26bf` | ④b/④c 目录/链接点了没反应 + 跳转两次              |

## ① 中英文混杂 + "语言自己会动来动去"

### 真 bug 1：SVG 的 `<title>` 是英文图标名

用户贴的 DOM（**关键线索**）：

```html
<button title="添加高亮" aria-label="添加高亮">
  <svg aria-hidden="true"><title>highlight</title>...</svg>
</button>
```

-> `Icon.tsx`：`const label = title ?? name;` -> **没传 title 时用【图标名】** ❌
-> **同一个按钮里有两个 title** ❌
-> 浏览器/AT/扩展**可能取 SVG 的那个** -> 悬浮显示英文 ❌

**更糟的是它会"跳来跳去"**：

-> 图标几何数据是**懒加载**的 -> **没加载完时整个 SVG 都不渲染** ❌
-> DOM 里**一会儿有 `<title>`、一会儿没有** -> tooltip 的来源在两个值之间切 ❌
-> 用户反馈："第一次悬浮上去显示中文 鼠标移开再上去就英文了"

**修法**：没传 `title` 就不渲染 `<title>`；Toolbar 的 10 个图标**都传上本地化 title**。

### 真 bug 2：`messages` prop **不绑 locale**

-> `resolveMessage` 第 1 层是 `overrides?.[key]`（**不带 locale 判断**）❌
-> 实测：`en + overrides` 依然返回**中文** ❌
-> 切语言 -> **被覆盖的 key 还是中文** -> **中英文混杂** ❌
-> 宿主每次切换重建 `messages` -> **新引用** -> 重新渲染 -> **tooltip 跳来跳去** ❌

**修法**：`messages` 改成**按语言绑定**（和 `locales` 同一个概念），新增类型 `LocaleMessagesMap`。

### 真 bug 3：高亮浮层的 5 个按钮**硬编码中文**

-> `highlight-actions.ts` 写死了"添加批注/选择高亮颜色/复制/删除/更多" ❌
-> **高亮浮层永远中文，选区浮层永远英文** -> **两个浮层并排 = 混杂**

**修法**：改成 **key -> MessageKey 的映射**，新增 5 个 i18n key（zh/en/ja/fr 四套齐全）。
**没传 `t` -> 退化成 key（不是中文）**（宁可显示 key，也不显示错语言）。

### 真 bug 4：审计工具 `audit-i18n.mjs` **漏报**

-> 旧版的 `labelRe` **只匹配"引号字面量"** ❌
-> 而源码写的是**计算属性**（`label: HIGHLIGHT_ACTION_LABELS[...]`）-> **匹配不到** ❌
-> 实测：旧版报"0 个硬编码"，源码里**实际有 5 处中文** ❌

**修法**：改成**扫所有 CJK 字符串字面量** + 加**交叉校验**（每个 key 必须在五张表里都存在）。
**实测**：注入旧代码后能抓到那 2 处中文（旧版抓不到）。

### 顺带清理

- 删掉死代码 `BUILTIN_ACTION_LABELS` / `useMessages` / `resolveIcon`
- demo 的宿主 UI（20 处硬编码中文）-> **接上 demo 自己的 i18n**

## ⑥ 文字颜色 / 清空格式

-> `execCommand('foreColor')` 生成 **`<font color>`** -> **不在白名单** -> **颜色被剥掉** ❌
-> **实测确认**：`execCommand('styleWithCSS', false, 'true')` **先调一次** -> 生成 **`<span style>`**
（⚠️ 第 4 个参数在 Chrome 里**不生效**，必须单独调一次）
-> `removeFormat` 之前"没反应"是因为**颜色本来就没生效**

## ② 高亮块被"选中" + ④a 光标不变小手

### ②

-> `::selection` 的重置**只覆盖了 `.scpdf-text-layer`** ❌
-> 高亮块在 **`.scpdf-annotations`**（**兄弟节点**）-> **不继承** ❌
-> **实测排除法**：`pointer-events: none` 的元素**不会**匹配 `:hover` -> 不是 hover 那条路
-> **修法**：**重置整个根节点** `.scpdf-root ::selection` + 编辑器**例外恢复**

### ④a

-> 文本层是 `inset: 0`（铺满整页）-> **子元素的显式 cursor 覆盖继承值** ❌
-> JS 里 `cursor = ''`（**空字符串 = 清掉内联样式**）❌
-> **修法**：文本层 `cursor: inherit` + 容器 `cursor: text` + JS 离开链接时设 `'text'`

**实测**：链接上 `pointer` / 文字上 `text`

## ⑦ 跨页选区后浮层定位跑偏 + 往下滚会消失

-> 之前用 `getBoundingClientRect()` -> **跨页返回并集矩形**（实测 `top=-1571, bottom=2247`）❌
-> 定位算出来 `top=954`（**贴视口底**，和选区完全脱节）❌

**修法**：

- `readLiveAnchor()` 改成读 `getClientRects()` 的**【最后一个】**（用户最后选到的那一行）
- 新增**吸附（sticky）模式**：选区滚出视野 -> 浮层吸到容器边缘（**不消失**）

**实测**（跨页拖选 + 三段滚动）：

| 状态     | 最后一行 rect | 浮层 top | placement      |
| -------- | ------------- | -------- | -------------- |
| 刚选完   | `-912..989`   | 954      | bottom         |
| 滚 600   | `-1512..389`  | **397**  | bottom         |
| 再滚 900 | `-2412..-511` | **124**  | **sticky-top** |

（修复前是 `954 -> 954 -> 744`，**不跟**选区走）

## ③ 批注时"选中效果"消失

-> 编辑器 `focus()` -> **浏览器塌缩原生选区** -> `selectionchange` -> `setSelectionShapes(new Map())` ❌
-> 而**原生 `::selection` 是 transparent**（我们自己关的）-> 用户**只看得到自绘层** -> 一擦就没 ❌

**修法**：打开批注时**冻结**一份形状；批注期间不清；**点 X 取消** -> 清掉（用户要的"取消就把高亮取消掉"）。

**⚠️ 实现陷阱**：必须用 **ref**，不能加进 `handleSelectionChange` 的依赖数组
（会让 `useTextSelection` 反复解绑/重绑 document 监听器）。

**实测**：选中 `shapes=1` -> 批注中 `shapes=1` -> 取消后 `shapes=0`

## ⑤ 批注框贴着屏幕右边

-> `safeMargin = margin * 2 = 24`（480px 弹窗 + 24px 边距 = **几乎贴边**）❌
-> 锚点靠右时用**左边缘**对齐 -> **必然贴边** ❌

**修法**：

- 安全边距**跟视口宽度成比例**：`max(48, min(96, round(vw * 0.06)))`
- **锚点靠右时按右边缘对齐**（弹窗向左展开）
- CSS 宽度 `min(480px, calc(100vw - 96px))`

**⭐ 顺带把定位逻辑抽成纯函数**（`core/selection/dialog-position.ts`）——
之前内嵌在组件里 -> jsdom 没布局 -> **没法单测** -> 现在 **12 条单测**

**实测**：最靠右的行 **rightGap 24px -> 264px**

## ④b/④c 目录/链接点了没反应 + 跳转两次

### 关键发现：内部链接**从来就没跳成功过**

-> PDF 里的链接**大量是"命名目标"**（实测 demo 样张：`"section.1"` / `"section.2"`）
-> 命名目标要 `getDestination()`（**异步**）才能展开 ❌
-> 而之前**只用同步的** `pageRefToNumber` -> **永远解析不出来** ❌

**修法**：新增 `resolveRefAsync`（**优先用宿主的 `resolvePageRef`**）。

**实测**：

|        | scrollTop        | 页码                   |
| ------ | ---------------- | ---------------------- |
| 修复前 | 1900 -> 1900     | 1 -> 1（**没反应**）❌ |
| 修复后 | 1900 -> **3850** | 1 -> **3**             |

### 新的 `onInternalLink` 契约（用户明确要求）

> "包都自动跳 但是提供取消回调给宿主 宿主可以自己控制不让他跳"

```ts
onInternalLink?: (ctx: {
  dest: string | unknown[];
  targetPage: number | null;   // **目标页**（之前给的是"链接所在页"，没用）
  currentPage: number;
  targetY: number | null;      // 目标在页内的 y 坐标
  cancel: () => void;          // **取消这次跳转**
}) => void;
```

-> **跳转只有一个执行者** -> 不会跳两次
-> **幂等锁**：同一目标页 200ms 内只跳一次
-> **目标页 == 当前页** -> 照样跳，而且滚到**那一行**（用 `targetY`）
-> 解析不出来 -> **toast 提示**（不静默）

**实测**：`不取消 -> 跳了=true` / `取消后 -> 跳了=false`

### 目录的静默失败

-> 之前 `pageRefToNumber={... ?? (() => null)}` -> **内联箭头** -> 每次渲染新函数 + **永远返回 null** ❌
-> 现在用**稳定的** `resolveRefSync` + **完全解析不出来时显示提示**

## 顺带修的 E2E（**测试自己有 bug**）

-> 4 个 E2E 用 `select[aria-label="语言"]` 找语言下拉框 ❌
-> **aria-label 现在也是本地化的** -> en 模式下是 "Language" -> **找不到** ❌
-> 改成 `select:has(option[value="en"])`（**语言无关**）
-> `e2e-popover-anchor.mjs` 用**并集 bbox** 测间距 -> 浮层改锚点后**误报** ❌ -> 改成**最后一个 client rect** ✅

## 体积

- 主入口 **32.83 / 33 kB**（上轮从 32 提到 33）
- dialog 子路径 **8.08 / 9 kB**（新增 `dialog-position.ts`）-> 上限 8 -> 9 kB

## 测试

| 文件                                               | 条数 | 内容                                           |
| -------------------------------------------------- | ---- | ---------------------------------------------- |
| `src/components/Icon.test.tsx`（新）               | 6    | **回归守卫**：没传 title -> 不渲染 `<title>`   |
| `src/core/editor/exec-command.test.tsx`（新）      | 9    | `styleWithCSS` / 清洗后颜色还在 / removeFormat |
| `src/core/selection/dialog-position.test.ts`（新） | 12   | 安全边距比例 / 右边缘对齐 / 小屏               |
| `src/core/selection/popover-position.test.ts`      | +5   | sticky-top / sticky-bottom / 跨页脱节守卫      |
| `src/i18n/messages.test.ts`                        | +2   | 覆盖按语言绑定的回归守卫                       |
| `src/core/selection/highlight-actions.test.ts`     | 改   | 标签由 `t` 解析 / 没传 `t` 不含中文            |

## 验证

- `pnpm verify` -> **9/9 全绿**
- `pnpm test` -> **737 passed**（58 files，+35）
- E2E -> **559/559**（0 套件失败）
- `node scripts/audit-i18n.mjs` -> \*\* 没有发现问题**（104 keys，四语言齐全）
- **浏览器实测**：每个 bug 都有可复现的数字

---

---

## ① 文字颜色完全失效（**根因在第 24 轮漏掉了**）

### 抓到的报错（浏览器实测）

```
Error: There is no mark type named 'textStyle'.
    at getMarkType (@tiptap/core)
    at Object.chainedCommand [as setMark]
    at Object.chainedCommand [as setColor]
```

### 根因

-> TipTap 的 `Color` 扩展是**基于 `textStyle` 实现的**
-> `setColor` 内部会 `setMark('textStyle', { color })`
-> 但 **StarterKit v3 不包含 `TextStyle`** ❌
-> 实测它的 dist 里只有 18 个扩展（bold/italic/...）**没有 textStyle**
-> 只注册 `Color` 不注册 `TextStyle` -> **调用 setColor 直接抛错** ❌
-> **文字颜色功能 100% 失效** ❌
-> 用户看到："点击会打开一个空的窄的框"

> ⚠️ **第 24 轮只修了【内置编辑器】**（`execCommand('styleWithCSS')`）❌
> -> 但 **demo 用的是 TipTap**（`annotationEditor={TipTapEditor}`）❌
> -> 所以用户那边**根本没变** ❌

### 修法

-> **显式注册 `TextStyle`**
-> `@tiptap/extension-text-style` 加为 devDep + **optional peerDep**

### ⭐ 顺带补上 TipTap 缺失的颜色面板

-> 之前 TipTap 的工具栏**根本没有颜色面板** ❌
-> 点"文字颜色"-> **直接应用第一个颜色** ❌
-> 内置编辑器**有**面板 -> **两边行为不一致** ❌
-> 现在：**两边一致**

### ⭐ 修 `hiliteColor` 没传颜色值

-> 之前 `toggleHighlight`（**不带值**）-> 选哪个色都一样 ❌
-> 现在：`toggleHighlight({ color: value })`

### "清空格式"和"文字颜色"区分开

-> 只有 `hiliteColor` / `foreColor` 会弹面板
-> `removeFormat` -> `unsetAllMarks` -> **直接执行**

## ② 批注期间点到底下的高亮 -> 蓝色选区框消失

### 根因

-> `handleHighlightClick` **无条件** `setSelectionShapes(new Map())` ❌
-> 场景：已高亮一块 -> 再对另一块写批注 -> 弹窗盖在那个高亮上 ->
用户在弹窗里操作 -> **点到底下的高亮** -> **蓝色框被擦掉** ❌

### 修法

-> **正在批注**（`isPendingNoteRef.current`）-> **不清选区**

### 实测

|        | 蓝色框              | 批注弹窗 |
| ------ | ------------------- | -------- |
| 修复前 | `shapes: 1 -> 0` ❌ | 还在     |
| 修复后 | `shapes: 1 -> 1`    | 还在     |

## 测试

**新增 E2E**（2 个，**20 条断言**）：

| 文件                                         | 条数 | 内容                                                                                            |
| -------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `scripts/e2e-richtext-color.mjs`             | 13   | 面板弹出 / 有色块 / 不是空的窄框 / 选色生效 / 没有 textStyle 报错 / 两个按钮不同 / 清除格式生效 |
| `scripts/e2e-annotation-highlight-under.mjs` | 7    | 蓝色框保留 / 弹窗没被点掉 / `::selection` 透明                                                  |

**顺带修的 E2E**：`e2e-ui-polish.mjs` 点"高亮"后要**先选色块**（行为变了）

## 文档

-> README / EXTENDING.md 加了 **TipTap peer 依赖清单**
-> 明确写出 `@tiptap/extension-text-style` 少了会怎样

## 验证

- `pnpm test` -> **737 passed**
- `pnpm verify` -> **9/9 全绿**
- E2E -> **579/579**（0 套件失败，比上轮 +20）
- 体积：主入口 **32.85 / 33 kB**

---
