---

## 第十三轮 · 阶段 5：7 套主题 + appearance 配置（问题 4）

用户反馈："需要支持配置页面样式 给出几套方案"
用户确认："建议 7 套：light/dark/auto/paper/sepia/contrast/minimal"

### ① 三层分层（不冲突）

| 层  | 控制什么 | 手段                                  |
| --- | -------- | ------------------------------------- |
| 1   | 整体风格 | `theme="paper"`                       |
| 2   | 结构开关 | `appearance={{ density: 'compact' }}` |
| 3   | 像素微调 | 宿主覆盖 CSS 变量                     |

### ② 每套主题都**完整**

⚠️ 旧实现的暗色只覆盖了 4 个颜色变量，
**primary / shadow / selection-color / bbox-color 都没覆盖**
→ 换主题时颜色"半新半旧"。

→ 现在每套主题都覆盖**全部**变量（12 个）。

### ③ 新增文件

- `src/styles/themes.css` —— 7 套主题 + appearance 的 class
- `src/core/theme/index.ts` —— `themeClasses()` / `THEMES` / `THEME_LABELS`（纯函数，零 DOM）
- `src/styles/themes.css` 单独导出（`@scholar-club/pdf-viewer/themes.css`）

### ④ 顺带修的 bug（都是实测发现的）

**bug 1：点一次"高亮"生成 3 条高亮**

- 根因：**updater 里有副作用**（`highlightSeq += 1` 在 updater 里）
  → React 的 StrictMode **双重调用** updater → 同一个高亮加了 2~3 次
  → 而且每次 ID 还不同 → "Encountered two children with the same key"
- 修法：**ID 在 updater 外面生成** → updater 是纯函数 → 调几次结果都一样

**bug 2：包的"高亮"按钮和宿主自己的按钮都会存 → 存两次**

- 之前：内置动作同时调 `onHighlight` **和** `handleHighlightCreated`
- 现在：**分工明确**
  - `onHighlight` —— 包内置的"高亮"按钮 → 宿主存
  - `ref.current.createHighlight()` —— 宿主自己的按钮 → 包清选区 + 通知宿主

**bug 3：选区横跨整页（Δ左 = 1050px）**

真实 PDF（arXiv 论文）的页边戳是**逐字符竖排**的（`left=1231`）：

```
正文   x = 175 ~ 445
页边戳 x = 1225        ← 和正文**同一行**
```

浏览器按**视觉行**选中同一行的所有 inline box
→ 页边戳虽然离正文 1000px，却被**一起选中**（实测选区宽 1060px）。

修法（两层）：

1. `src/core/text-layer/layout.ts` → **旋转文字不进文本层**（`skipRotated`）
   → 浏览器选不到它
2. `src/core/selection/drag-origin.ts` → **按拖动范围过滤矩形**
   → 只保留和用户拖动范围重叠的矩形（页边戳离得远 → 丢掉）

⚠️ 中间踩了三个坑：

- **"起点落在两段之间的空隙"** → 起点 x=278，正文矩形到 277 就结束了
  → 找不到列 → 过滤失效 → 改成"取**左边**最近的那一列"
- **"只看起点会丢掉右边拖过去的文字"** → 改成用**拖动范围**（起点 + 终点）
- **"用 `continue` 丢掉候选会改变正常情况下的胜出者"**
  → Δ右 从 3.4 变成 7.1 → 改成**降权**（`penalized`）而不是丢掉

**bug 4：demo 加了主题切换器 → E2E 的缩放矩阵从 49/49 掉到 46/49**

- 根因：demo 的 header 变高 → PDF 区域下移 → E2E 里"按坐标选字"的用例
  选到了**不同的行**
- 修法：demo 的 header **固定高度 + 不换行**
- ⚠️ 顺带发现：E2E 里"点击浮层外关闭"点的是**固定坐标 (200, 60)**
  → demo 的布局一变就命中了别的按钮（"载入内置样张"）→ **换了文档**
  → 改成点**画布的空白处**（动态算坐标）

### ⑤ 回归测试

**单测**（+28，共 406）：

- `src/core/theme/index.test.ts`（12）：7 套主题 / class 名 / appearance 叠加
- `src/core/selection/drag-origin.test.ts`（11）：页边戳过滤 / 两栏 / 多行 / 空隙
- `src/core/selection/shape.test.ts`（+2）：旋转戳的候选降权

**E2E**（`scripts/e2e-themes.mjs`，新增 41 项）：

- 下拉框里有 7 套主题
- 每套主题都有对应的 class + 完整变量
- 不同主题的颜色**确实不同**
- contrast / minimal：页阴影 none + 圆角 0
- appearance 的密度切换 → 根节点 class 变化

### ⑥ biome 的 `noImportantStyles`

打印样式需要 `!important` 才能盖过 **inline style**
→ biome 默认会把它去掉 → 在 `biome.json` 里把该规则**关掉**（并说明原因）。

### 验证

- `pnpm verify`: **8/8 全绿**
- `pnpm test`: **406 passed**（+28）
- E2E: **265/265 断言通过，0 个套件失败**（+41）
