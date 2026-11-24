# 第 4 步：测试框架 — vitest + SSR 冒烟测试（2026-10-30） / 阶段 1 · 第 4 步：core/selection —— 选区几何提取 + 矩形合并（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 第 4 步：测试框架 — vitest + SSR 冒烟测试（2026-10-30）

**做了什么**
- `pnpm add -D vitest`（v5）
- `vitest.config.ts`：`environment: 'node'`，显式枚举测试位置（src + tests）
- `tests/ssr-smoke.test.ts`：第一个测试——纯 Node 环境 import 包入口
- scripts 加 `test`（vitest run）/ `test:watch`（vitest）
- tsconfig `include` 扩为 src + tests + vitest.config.ts + tsup.config.ts（每个区域出现即纳入类型检查）

**为什么这么实现**
- 为什么先上测试框架（还没写业务逻辑）：测试框架和 tsup/biome 同级是工具——独立一步、验证可用、之后才依赖它。从下一步起，每步代码都带测试进场
- 为什么 vitest 而不是 jest：与 Vite 同一套 transform 管线（第 8 步 demo 也用 Vite），TS/ESM/别名零配置；jest 要额外配 ts-jest/babel。全仓库一种配置语言（defineConfig）
- 为什么 core 测试用 `environment: 'node'`（关键决策）：
  - core 层承诺零 DOM；node 环境跑测试更快**且更诚实**——core 顶层误碰 window/document 会当场抛错，jsdom 会用假 window 把 bug 藏起来
  - 环境即层契约：core = node（无 DOM）；将来组件测试 = 单文件 `// @vitest-environment jsdom` 显式声明
- 为什么 SSR 冒烟测试只有一行却价值大：
  - 经典失效模式：模块顶层 `navigator.userAgent`（主项目现有 PageCom 的 isSafari 判断正是此形状）→ 浏览器 SPA 正常，Next.js/SSR 一 import 就炸
  - 这条测试 = 永久守卫：未来任何顶层 DOM 访问在 CI 红掉，而不是在消费者服务器炸掉
  - 语义上声明了包的适用域：任何框架，而不只是浏览器 SPA
- 为什么测试里用 `await import()` 动态导入：模块 import 期抛错时得到清晰的单条测试失败；静态 import 会炸掉整个测试文件的加载，报错更难读
- "红-绿"验证：临时在 src/index.ts 加 `const w = window;`，测试必须红（ReferenceError: window is not defined），删掉回绿——不会变红的守卫没有价值

**验证**
- `pnpm test` → 1 passed
- 红绿演练：加 window 引用 → 红（ReferenceError）；删除 → 绿
- `pnpm typecheck` 通过

---

---

## 阶段 1 · 第 4 步：core/selection —— 选区几何提取 + 矩形合并（2026-11-13）

**做了什么**
- `src/core/selection/optimize-rects.ts`：移植主项目 `optimizeClientRects`（同行矩形合并），**修三处问题**；新增 `boundingRectOf()`
- `src/core/selection/extract.ts`：选区提取（归页 → 页内坐标化 → 合并 → 双空间输出）
- `src/core/selection/optimize-rects.test.ts`（12 例）+ `extract.test.ts`（11 例）
- `src/core/index.ts`：出口接线

**为什么这么实现**
- **归页用"中心点"而不是"完全包含"**：浏览器会把跨页选区的矩形切在页边界上 → "完全包含"判定下矩形两边都不属于（**选区缺页**）。中心点判定稳定且 O(1)，把主项目的 O(矩形×页) 双层循环降为 O(矩形×页框命中)
- **页框由调用方传入**：core 不碰 DOM（页位置是渲染层的信息）→ selection 模块仍可在 node 环境单测
- **只输出几何**：`SelectionData` 里没有 DOM 临时量、没有业务字段 → 宿主拿去弹窗/调模型/存库都是它自己的事
- **移植时修的三处**（主项目原实现）：
  1. 跨页排序是错的：`(A.pageNumber||0)*A.top - (B.pageNumber||0)*B.top` 把页码与 top **相乘**比较，跨页毫无意义（页2(top=5) 排到了 页1(top=100) 前面）→ 改为显式三级比较 `(pageNumber, top, left)`
  2. **就地修改入参**：原实现直接改 `A.width`/`A.height` → 调用方数组被污染（"选区矩形莫名变了"的幽灵 bug 根源）→ 改为返回新对象，**输入不可变**（测试专门锁这条）
  3. 相同矩形不去重：严格 `>` 让完全相同的两个矩形互不包含 → 同一段文字画两遍 → 补"相等即包含"
- **误差容差随缩放放大**：`BASE_Y_MARGIN(5px) * scale` —— 缩放越大，浏览器给出的矩形抖动越大，固定容差会在高倍缩放下漏合并

**遇到的问题**
1. **`inside()` 改成"相等即包含"后，所有矩形被过滤光**（测试全线飘红，返回空数组）
   - 根因：矩形**必然被自己包含** → `every(other => !inside(rect, other))` 对自己判定为 true → 每个矩形都被自己过滤掉
   - 修复：与"自己"比较时跳过（`other === rect`）
   - 教训：**集合判定里的自反性**是经典陷阱；"a 在 a 之内"这类关系必须显式排除自身
2. **重复矩形被"互相包含"→ 两个都被删光**（测试"完全相同的矩形去重"失败：期望留 1 个，实际留 0 个）
   - 根因：只看"是否被包含"无法处理互相包含；且排序后两个副本**值完全相同**，无法用值区分
   - 修复：改为**按位置判定**——只与排在**前面**的矩形比较 → 重复项留第一个、删后面的
   - 教训：去重要么按身份、要么按位置；**不能只按值**（值相同的两个对象谁也不是"另一个"）
3. 两处都是**移植时改语义引入的**——原实现用严格 `>` 恰好绕开了自反性问题（但也因此漏了去重）
   - 教训：修 bug 时要同时检查"新语义是否引入新问题"；本次是两个 bug 连锁暴露，靠测试逐个逼出来

**验证**
- `pnpm test`：70 passed（selection 23 + cache 16 + loader 17 + geometry 10 + SSR 4）
- `pnpm verify` 5 gate 全绿

---
