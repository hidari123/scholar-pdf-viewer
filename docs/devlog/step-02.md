# 第 2 步：构建工具链 typescript + tsup（2026-10-29） / 阶段 1 · 第 2 步：core/document —— 文档加载管线 + 错误码体系（2026-11-13） / 阶段 2 · 第 2 步：组件层 —— PdfViewer / Toolbar / PageCanvas / AnnotationLayer + i18n（2026-11-13） / 阶段 4 · 第 2 步：面板 —— 缩略图 / 目录 / 搜索（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 第 2 步：构建工具链 typescript + tsup（2026-10-29）

**做了什么**
- `pnpm add -D typescript tsup`（初次装上 typescript@7.0.2 / tsup@9.0.0）
- `tsconfig.json`：strict + noUncheckedIndexedAccess + bundler 解析；`noEmit`（tsc 只查不产，产物归 tsup）
- `tsup.config.ts`：esm + cjs 双格式、dts、sourcemap、clean
- `src/index.ts` 占位入口（VERSION 常量），scripts 加 `build` / `typecheck`
- 最终 `typescript` 钉在 `^5.9`（见下）

**遇到的问题**
1. `typescript@7.0.2` build 在 dts 环节崩：`rollup-plugin-dts requires the TypeScript compiler API`。
   根因：TS 7 是 Go 原生重写（tsgo），npm 包**不再提供 JS Compiler API**；tsc 二进制本身能跑（typecheck 过），但 dts 合并这类"以编程方式调 TS API"的工具链失去依赖。
2. 按报错提示装兼容包 `@typescript/typescript6@6.0.2` 再 build → 新错误：
   `parseJsonConfigFileContent is not a function`。
   根因：该函数是 **TS 5.x API，6.0 已移除**；tsup 9.0.0 的 `parseCompilerOptions` 直接调用它 → **tsup 9 的 dts 管线整体依赖 5.x API 面**，兼容包补不了。
3. （观察）pnpm 10 警告 `Ignored build scripts: esbuild@0.28.2`：pnpm 10 默认拦截依赖 postinstall；esbuild 的平台二进制走 optional dep（@esbuild/win32-x64）已正常安装，postinstall 只是校验兜底 → 构建产物正常，不处理。

**为什么这么实现（最终决策）**
- **typescript 钉 `^5.9`**（最新 5.x），移除 typescript6 兼容包：
  - 约束来自**工具链的 API 面**（tsup / rollup-plugin-dts），不是我们的代码——代码本身 5/7 两版兼容，钉 5.9 零损失
  - 保持单一 typescript 版本；不搞"tsc 用 7、dts 用 5"的 pnpm overrides 双轨（复杂度 > 收益：小包规模下 tsc 5.9 与 tsgo 的速度差可忽略）
  - **revisit 触发条件**：tsup / rollup-plugin-dts 宣布支持 TS 6+ API 后，升回 7 拿 tsgo 速度
- 决策方法：用两次失败换来生态真实支持边界的确认——"选最新 → 验证 → 按数据决策 → 留回头路"

**验证**
- `pnpm typecheck` 通过
- `pnpm build` 完整跑完，`dist/` 共 6 个文件：index.js / index.cjs / index.d.ts / index.d.cts + 2 个 .map
- `node -e "import('./dist/index.js')"` → `esm ok: 0.1.0`（ESM 产物可被直接加载）

---

---

## 阶段 1 · 第 2 步：core/document —— 文档加载管线 + 错误码体系（2026-11-13）

**做了什么**
- `src/core/errors.ts`：12 个错误码（加载 7 / 渲染 2 / 缓存 2 / 交互 1）+ 统一构造器 `pdfViewerError()` + `isRetryable()`
- `src/core/document/loader.ts`：加载管线（URL / Blob / ArrayBuffer / Uint8Array 四种来源）
- `src/core/document/loader.test.ts`：17 个用例（node 环境，注入 fake fetch，**零真实网络**）
- `src/core/index.ts`：core 出口接上 `errors` 与 `document`
- `src/core/types.ts`：**按 v2 新边界重写**——删除 `StorageAdapter` / `PopoverAction` / `ActionContext`（业务注入面已取消）、`PdfViewerError`（迁到 errors.ts 单一来源）、`BboxData`（业务数据）；`HighlightRecord` 瘦身为中立模型

**为什么这么实现**
- **错误码先行**：12 个错误码里 7 个属于加载层 → 加载是错误最集中的一层。先把错误**分类清楚**（宿主才能区分"重试 / 提示 / 降级"），而不是抛一个 catch 不住的 Error。每个错误必带 `cause` → 排障可追根
- **fetch 注入**：core 层不碰 `globalThis.fetch` → node 环境可单测（不碰真实网络、不被网络波动影响）。这也让"同一份加载逻辑"在浏览器/Node/Worker 里行为一致
- **magic bytes 在进 pdf.js 之前校验**：pdf.js 对非 PDF 的报错不可控（`InvalidPDFException` 之外还有各种解析异常），我们给宿主一个明确的 `E_PDF_INVALID`
- **Range 只信状态码不信 `Accept-Ranges` 头**：很多服务端回 `Accept-Ranges: bytes` 却对 Range 请求返回 200 全量。实测路径：**206 = 分段、405/501 = 降级全量重试、其余非 2xx = E_LOAD_HTTP**（头不可信，状态码可信）
- **206 但无 `content-range` 也视为全量**：部分服务端行为不一致，宁可多下一次也不能拿到错乱的分段数据
- **超时与"宿主主动取消"要分开**：`AbortController` 同时用于两者，靠"宿主 signal 是否已 abort"区分 → 宿主取消不该被报成超时错误
- **loadId 由调用方持有**：换文件竞态用"比 URL 是否相等"不可靠（同一 URL 换内容也必须重载），只有单调递增的 loadId 可靠

**遇到的问题**
1. `src/core/index.ts` 同时 `export * from './errors'` 与 `export * from './types'` → TS2308 `PdfViewerError` 重复导出歧义
   - 修复：错误类型**单一来源**（只留在 `errors.ts`），`types.ts` 不再声明
2. `types.ts` 里残留 v1 的业务类型（`StorageAdapter`/`PopoverAction`/`ActionContext`）与新边界冲突，且 `BboxData` 是业务数据
   - 修复：按 v2 §2.4 重写 types.ts，业务类型**从包里删除**（不是加开关关掉，是彻底移除）
3. `loader.ts` 里的 `supportsRange()` 成了死代码（头不可信，改用状态码判断）→ TS6133 未使用告警
   - 修复：删除该函数。教训：**辅助函数要留有明确用途**，凭"也许有用"写下的代码会在下一个决策改变时变成噪音
4. 测试里 fake fetch 的 `init` 类型写窄了（漏 `signal`）→ TS2339
   - 修复：补全类型。教训：测试替身的类型要**跟着真实签名走**，否则测试写的是"想象中的 API"

**验证**
- `pnpm test`：31 passed（geometry 10 + loader 17 + SSR 4）
- `pnpm build`：`dist/core.js` 导出 12 个函数；`dist/core.d.ts` 10.7KB
- `pnpm verify` 5 gate 全绿

---

---

## 阶段 2 · 第 2 步：组件层 —— PdfViewer / Toolbar / PageCanvas / AnnotationLayer + i18n（2026-11-13）

**做了什么**
- `src/components/PdfViewer.tsx`：主组件（加载 → 页面流 → 虚拟化 → 缩放 → 当前页 → 选区 → 高亮层 → 键盘）
- `src/components/Toolbar.tsx`：内置工具栏（零 UI 库；内联 SVG 图标；左右 slots 给宿主）
- `src/components/PageCanvas.tsx`：单页 canvas（viewport 只读 / renderId 守卫 / DPR cap 2）
- `src/components/AnnotationLayer.tsx`：高亮 DOM 层（可命中、可换肤、键盘可达）
- `src/i18n/messages.ts`：zh/en 文案 + `{占位符}` 解析
- `src/styles/viewer.css`：扩充为完整组件样式（工具栏/页面/标注层/状态区/面板 + 暗色主题）
- `src/index.ts`：主入口导出组件 + hooks + 类型 + 错误码 + i18n
- 测试：Toolbar 15 例 + AnnotationLayer 8 例（jsdom）

**为什么这么实现**
- **标注层用 DOM 不用 canvas**：DOM 天然可命中测试、可 hover、可被读屏器识别、可用 CSS 变量换肤；canvas 画的标注要自己实现命中与无障碍
- **viewport 只读**：`page.getViewport({ scale })` 的结果绝不手工变异（主项目漂移 bug 的根因）
- **renderId 守卫**：缩放/换文件后旧渲染回调直接丢弃；取消导致的错误不算失败（快速缩放会大量产生）
- **DPR cap 2**：高分屏不糊（>2 收益递减）、低端机不爆（内存与填充率）
- **工具栏内联 SVG 而非图标库**：保持零依赖 + 可换肤（`currentColor`）
- **slots 而非业务 prop**：宿主的历史文档/分享按钮等业务入口，宿主自己塞进 `leftSlot`/`rightSlot`——包不提供业务入口（v2 边界）
- **i18n 内置但可覆盖**：基础文案（加载中/空态/密码框）必须有，宿主可覆盖但不被迫提供

**遇到的问题**
1. **Toolbar 的 prop 名与实现不一致（真 bug）**：props 声明 `config`，但 `PdfViewer` 传的是 `toolbar` → 所有工具栏配置（showPageNav/showZoom/slots）**全部失效**
   - 修复：统一为 `toolbar`（与方案 §5.1 公开 API 一致）
   - 教训：**组件的 prop 名要有单一事实源**；类型系统没报错是因为两边都"合法"，只有测试能发现
2. **页码输入框没法输入（真 UX 缺陷）**：受控 `value={page}` → 用户清空输入框时值立刻被外部覆盖回去
   - 修复：改用**草稿值**（本地 state）+ 合法才提交 + 失焦非法值回落
   - 教训：受控组件不等于"外部值直写"；凡是"用户要输入"的场景都要草稿值
3. **测试之间 DOM 累积**：testing-library 的自动清理只在 `globals: true` 时生效 → 跨用例元素累积 → "Found multiple elements"
   - 修复：`tests/setup.ts` 里显式 `afterEach(cleanup)`
4. **biome 的 a11y 规则抓到 4 处问题**（都是真问题，不是误报）：高亮 div 带事件处理器（→ 改 `<button>`）、`role="status"`/`role="search"` 用 div（→ 换语义元素 `<output>`/`<search>`）、SVG 无 title、滚动容器 tabIndex
   - 教训：**a11y 规则值得当真**——高亮块用 div 模拟按钮是常见偷懒，改成 button 后键盘可达是白送的
5. **`biome-ignore` 注释位置**：JSX 里必须用 `//` 行注释写在**元素属性之间**才能生效（`{/* */}` 形式不被识别）
   - 教训：抑制注释的语法随上下文变（JSX vs JS），别照抄
6. **测试期望值算错**：输入 "99" 期望"无回调"，但中间态 "9" 是合法页码 → 合法跳页是对的
   - 修复：改成输入单字符越界值，并补一例"中途合法立即跳页"（把正确行为也锁住）

**验证**
- `pnpm test`：142 passed（components 23 + hooks 17 + core 102）
- `pnpm verify` 5 gate 全绿

---

---

## 阶段 4 · 第 2 步：面板 —— 缩略图 / 目录 / 搜索（2026-11-13）

**做了什么**
- `src/core/thumbnail/plan.ts`：缩略图策略（`thumbnailSpec` / `planThumbnails` / `ThumbnailCache` LRU）
- `src/core/outline/outline.ts`：目录扁平化 + 折叠可见性计算 + 目标解析
- `src/components/ThumbnailPanel.tsx`：缩略图面板（宿主注入渲染函数）
- `src/components/OutlinePanel.tsx`：目录面板（层级 + 折叠 + 当前项高亮）
- `src/components/SearchPanel.tsx`：搜索面板（接 core 的 PdfSearch）
- `src/components/PdfViewer.tsx`：加 `getOutline` / `pageRefToNumber` / `renderThumbnail` / `searchEngine` / `outlineResolveToken` props + 侧栏布局
- `src/core/search/search.ts`：加 `getPageProvider()` / `getTotalPages()`（UI 层要能确保索引已建）
- `src/styles/viewer.css`：面板样式（缩略图/目录）+ 侧栏改为 flex 并列
- `scripts/e2e-panels.mjs`：面板 E2E（12 项断言）
- 测试：thumbnail 19 + outline 14 + OutlinePanel 6 + SearchPanel 7

**为什么这么实现**
- **缩略图由宿主渲染**：包不依赖 pdf.js → 宿主可用 canvas / worker / OffscreenCanvas，包只收 URL
- **懒生成 + 窗口化 + 单次批量上限**：500 页文档一次性生成会吃光内存；
  只生成可视页 ±2、单次最多 4 个 → 滚动流畅
- **LRU + 条数上限**：缩略图每张 ~200KB，500 页 = 100MB+ → 必须限制
- **目录扁平化**：React 渲染树要递归组件 + 展开状态管理；扁平后是一个 map，快得多
- **目录页码由宿主解析**：pdf.js 的页引用是内部对象，包算不出页码 → 宿主注入映射
- **搜索接 core 的 PdfSearch**：索引懒建 + 分片让出主线程（不在加载时建索引）

**遇到的问题**
1. **侧栏盖住工具栏（真 bug，E2E 抓到的）**：`.scpdf-panel` 用 `position:absolute; top:0`
   → 定位祖先是 `.scpdf-root`（含工具栏）→ 面板把工具栏的"关闭"按钮盖住 → 点不到
   - 修复：侧栏改为 **flex 并列**（`.scpdf-body` 容器），不再绝对定位
   - 教训：**绝对定位的参照系要看清楚** —— 面板"从顶部开始"是相对谁？
2. **目录项全部点不动（真 bug，真实 PDF 暴露的）**：20 个目录项全 disabled
   - 排查过程：
     a. 先怀疑宿主映射没建好 → 加日志发现 `getPageIndex` 没被调用
     b. 再查 `dest` 结构 → **`dest` 是字符串（"section.1"），不是数组！**
     → 这是**命名目标**（named destination），真实 PDF 常见
     c. 包的 `resolveDestPage` 只认数组 → 字符串直接返回 null
   - 修复（两层）：
     - 宿主：命名目标先用 `doc.getDestination(name)` 解析成数组，再取页引用
     - 包：`resolveDestPage` 支持字符串形态（查宿主映射里的命名键）
   - 教训：**PDF 的同一概念在不同文件里有不同编码**；只按"标准示例"实现会漏掉真实场景
3. **宿主页码映射是异步的，包拿不到"好了"的通知**：
   `getPageIndex` 是 async → 目录首次渲染时映射还是空的
   - 修复：加 `outlineResolveToken` prop —— 宿主解析完 +1 → 包重新解析目录
   - 教训：**包与宿主之间的异步边界要显式设计**，不能靠"宿主刚好先准备好"
4. **缩略图缓存放 ref 导致 biome 报"多余依赖"**：
   缓存内容变了要重渲染，但 ref 变化不触发 → 只能手动把 `generated` 列进依赖
   - 修复：缓存改用 **state**（不可变更新）→ 依赖天然正确
   - 教训：**要触发渲染的数据就该放 state**，ref + 手动依赖是脆弱的组合
5. **`ThumbnailCache` 类成员重名**：私有字段 `maxEntries` + getter `maxEntries` → biome 报重复成员
   - 修复：字段改名 `limit`
   - 教训：**私有字段与公开 getter 同名**在 TS 里合法，但 biome 不允许
6. **`PdfSearch.search()` 是同步的**（我一开始按异步写）→ 类型直接报错
   - 修复：面板改成"先确保索引建好（异步）→ 再同步搜"
   - 教训：**先读实现再写调用方**
7. **PowerShell 批量替换第三次毁掉源码 UTF-8**（E2E 脚本里的 ✓ 变乱码 → 语法错误）
   - 修复：脚本用 write 工具重写
   - 教训：**已经是第三次** —— 从此**一律用编辑工具改文件**，PowerShell 只用来跑命令
8. **demo 的 pdf.js 文本项类型**：`TextItem | TextMarkedContent` 混合，后者没有 transform
   - 修复：用 `'transform' in item` 做类型守卫
   - 教训：**pdf.js 的联合类型要用 in 收窄**，不能直接当 TextItem 用

**验证**
- `pnpm test`：209 passed
- `pnpm verify` 5 gate 全绿
- E2E 面板：**12/12**（缩略图 18 项/懒生成 6-8 张/点击跳页 / 目录 20 项全可跳/点击跳页 / 搜索 107 个结果 / 无 JS 错误）
- 截图：`e2e-shots/thumbnails.png`、`e2e-shots/outline.png`

---
