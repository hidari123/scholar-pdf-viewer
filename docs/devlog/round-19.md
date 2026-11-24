# 第 19 轮（工具栏 / 链接 / 编辑批注） / 第 19 轮总验证

> 本轮记录已从 `DEVLOG.md` 拆出。

# 第 19 轮（工具栏 / 链接 / 编辑批注）

## 用户反馈

> "我空格也加不了 各种功能都没有 特别难用"
> "富文本编辑完之后没有保存按钮啊 保存都保存不了 而且 富文本点了编辑 怎么富文本编辑框还在文档最上面啊 要出现在视野里啊 就点的旁边"
> "工具栏目前问题是 a. 点了加粗之后 加粗按钮没加深颜色 别的按钮也一样 看不出点击了"
> "链接弹窗是默认的弹窗 ... 这个输入框你自己写一个出来 不要用系统默认的框 很丑"

## ① 空格被吞 + onUpdate 不触发（两个真 bug）

### 空格被吞：container 的 `onKeyDown` 调了 `preventDefault`

- 堆栈抓到：`at onKeyDown (dist/index.js:4791)`，且 `key=" " defaultPrevented=true`
- **批注弹窗在 React 树里是 container 的后代** -> 合成事件冒泡 -> container 拦下空格
- 浏览器因此**不再派发 `beforeinput`**（字母 "a" 会触发，空格**完全不触发**）
- **修法**：焦点在可编辑元素里就**放行**

### `onUpdate` 从不触发

- TipTap v3 **构造时**就把 `options.onUpdate` 绑进事件总线 -> 事后改**无效**
- -> 宿主的 `value` 永远是空的 -> **"各种功能都没有"的直接原因**
- **修法**：用 `editor.on('update')`（正规方式）

## ② 工具栏的按下态 + 补全

- 之前工具栏**不知道当前选区是什么格式** -> 按钮永远不变
- 现在：**轮询**编辑器的选区 + 格式状态 -> 重算每个按钮的 active
- CSS 加 `[data-active="true"]` -> **主色底 + 主色图标**

### 踩过的三个坑

1. **订阅 TipTap 的事件不可靠** -> 改成**轮询**（`requestAnimationFrame`）
2. **轮询签名不能只看选区位置** -> 点"加粗"选区没变 -> 签名一样 -> **不重算** ❌
   -> 签名要包含**格式状态** ✅
3. **biome 会把"只在注释里用到的依赖"删掉** -> `activeTick` 被从 deps 里删了 ❌
   -> 在回调里 `void activeTick;` **真的读一下** ✅

### 工具栏补到 12 个按钮

新增：删除线 / 无序列表 / 有序列表 / 引用 / 清除格式 / 撤销 / 重做
新增图标：`strike` / `quote` / `clearFormat` / `undo` / `redo`
新增 i18n：`richtext.strikeThrough`（zh / en / ja / fr）

## ③ 自定义链接弹窗（两行）

- **不用 `window.prompt`**（阻塞 -> 失焦 -> 选区丢失；样式不可控）
- 两行：**链接** / **显示文字**
- 选了文字 -> 第 2 行自动带上 ✅
- 填了网址 -> 第 2 行跟着变 ✅
- 用户手动改过第 2 行 -> **不再跟随** ✅

### "输入链接后继续打字还是链接样式"

- 根因：TipTap 的 `inclusive() { return this.options.autolink; }` -> autolink 开着 -> inclusive 也是 true
- **修法（三步）**：`inclusive: () => false` + 光标移到链接后 + 清 storedMarks

### 踩过的四个坑

1. `chain()` **捕获当时的 state** -> 每步要**重新 `ed.chain()`**
2. `unsetMark('link')` **会把链接本身删掉** -> 改成直接改 transaction 的 storedMarks
3. `setTextSelection` -> `unsetMark` -> **选区被重置** -> 顺序反过来
4. `ed.focus()` **不够**（弹窗关闭后焦点掉到 body）-> **直接聚焦 DOM 元素**

## ④ 编辑批注 -> 锚点弹窗

- 之前打开的是**右侧便利贴面板** -> 离批注很远 + **没有保存按钮** ❌
- 现在打开**锚点弹窗**（和新建同一个组件）-> **贴在批注旁边** + **有保存/取消** ✅
- 锚点 = **编辑按钮**的 `getBoundingClientRect()`
- `StickyNoteLayer` 的 `onAnnotationEdit` 第二个参数 -> **按钮元素**

## 第 19 轮总验证

- `pnpm test` -> **593 passed**（48 files）
- `pnpm verify` -> **8/8 全绿**
- E2E -> **503/503**（44 个套件）

---

---

## 第 19 轮总验证

- `pnpm test` -> **593 passed**（48 files）
- `pnpm verify` -> **8/8 全绿**
- E2E -> **503/503**（44 个套件）

---
