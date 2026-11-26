# 第 25 轮：补修两个用户反馈（2026-11-23）

> 本轮记录已从 `DEVLOG.md` 拆出。

# 第 25 轮：补修两个用户反馈（2026-11-23）

第 24 轮修完后，用户又提了两个问题。**一个 commit**（两个 bug 同一批修）。

## 用户反馈

> "1. 富文本那里还有问题 富文本修改文字颜色的功能还是没有实现 点击会打开一个空的窄的框
>    清空format这个功能的按钮和修改文字颜色的按钮一样 需要区分开
> 2. 如果已经高亮了一个区域 然后再准备对另外一个区域进行批注 此时打开的批注框 如果刚好在那个高亮的上面
>    点击批注框里面的东西的时候 下面的高亮会选中 原来的准备进行批注的已经选择的区域会消失选区的蓝色框选的底"

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
