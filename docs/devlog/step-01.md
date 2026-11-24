# 第 1 步：仓库初始化（2026-10-29） / 阶段 1 · 第 1 步：core/geometry — 坐标换算纯函数 + golden 测试（2026-11-13） / 阶段 2 · 第 1 步：React 层基础 —— hooks（状态桥 / 加载 / 缩放 / 虚拟化 / 选区）（2026-11-13） / 阶段 4 · 第 1 步：TextLayer —— 文本层（让文字真的能选中）+ 真实 PDF 联调（2026-11-13） / 阶段 5 · 第 1 步：发布基建（size-limit / publint / attw / changesets / CI）（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 第 1 步：仓库初始化（2026-10-29）

**做了什么**
- `git init -b main`；`.gitignore`（node_modules / dist / coverage / *.tsbuildinfo / 本地文件）
- 最小 `package.json`：只含身份信息（name / version / description / license / type / engines），无依赖、无 scripts

**为什么这么实现**
- 版本控制先于第一行代码：之后每引入一个工具都是独立提交，历史可逐步讲述
- 第一版 package.json 刻意最小：依赖后续一步步加、每加一个一次提交，历史里每个节点都有"为什么"
- `type: "module"` 第一提交就钉死 ESM 主路——ESM/CJS 混用是包开发最大的坑源
- `engines: node>=22.13`：Node 22 LTS 线；声明下界让环境不符的消费者立刻看到明确报错，而不是运行时诡异行为
- 0.1.0 起步：semver 惯例，0.x 阶段允许破坏性变更快速迭代，1.0 冻结 API

**验证**
- `git log --oneline` 恰好一行，`git status` 干净

---

---

## 阶段 1 · 第 1 步：core/geometry — 坐标换算纯函数 + golden 测试（2026-11-13）

**做了什么**
- `src/core/geometry/transform.ts`：三空间换算纯函数
  - `viewToNorm(rect, ref)` / `normToView(norm, viewport)`：**语义逐字对齐**主项目 `viewportToScaled` / `scaledToViewport`
  - `pdfToView(bbox, viewport, page, pageNumber)` / `viewToPdf(rect, viewport, page)`：优先用 pdf.js viewport API（正确处理 rotation/cropbox/userUnit），无 API 时仅 rotation=0 纯数学回退，rotation≠0 直接抛错
  - `pdfToNorm` / `normToPdf`：组合路径
  - bbox 输出统一规范化为 `[minX, minY, maxX, maxY]`
- `src/core/geometry/transform.test.ts`：golden 测试（node 环境，零 pdf.js 依赖）
- `src/core/geometry/index.ts` + `src/core/index.ts`：core 入口**第一次有运行时导出**
- **修复阶段 0 的自引用 bug**：删 `src/core.ts`（`export * from './core'` 解析到自己 → 类型模型与全部运行时导出没进产物），tsup entry 改指 `src/core/index.ts`，`src/index.ts` 与测试改用显式路径 `'./core/index'`
- 边界收窄辅助 `toQuad` / `toPair`（viewport API 返回 `number[]`，取出定长数字并校验）

**为什么这么实现**
- **里程碑断言抓出静默 bug**：`core exports:` 打印为空 + `dist/core.d.ts` = `export {}`——类型模型其实**一直没进产物**，而阶段 0 被我误判成"契约全是类型所以正常"。教训：**"看起来正常"不等于对**，产物级断言（导出名 / d.ts 体积 / 关键符号 grep）比"构建成功"更能暴露问题。已把这三条断言固化进本步的验证清单
- 同名文件与同名目录是**陷阱**不是"标准模式"：模块解析里同名文件永远优先，`'./core'` 在 `src/core.ts` 里 = 自引用。消除方式是**显式路径**（`'./core/index'`）+ 让 entry 直指目录入口
- 为什么换算必须是纯函数且放 core：数学路径零 DOM、零框架、零 pdf.js 依赖 → node 环境直接单测（layer 契约：core = 零 DOM）
- **为什么语义必须逐字对齐主项目**（本步最重要的一条）：`NormRect` ≙ 后端 `ScaledPosition`，换算语义一改 = **存量高亮整体偏移**（数据没坏、只是渲染位置错 → 最难查的 bug）。已逐行核对主项目 `coordinates.ts` + `useTextSelection.ts` + `get-client-rects.ts` 的真实调用链
- 核对出的 wire 真相（与直觉不同，必须写进注释）：存的不是"纯比例"，而是**坐标 + 采集时视口尺寸**的一对——读回时按 `当前视口尺寸 / 采集时视口尺寸` 线性映射，所以**同一份数据在任何缩放下落点相同**（缩放无关性）；主项目的 width/height 取的是**当前缩放下**的视口尺寸，不是 scale=1 的页面尺寸
- 为什么优先 viewport API 而不是自己算：pdf.js 已处理 rotation/cropbox/userUnit，手算必错（修 A5：禁止手工变异 viewport）
- 为什么不把 rotation≠0 的回退也补上：宁可抛错也不给不可信结果——静默算错比报错危险得多
- **为什么不把 `PdfViewportLike` 的签名收紧成 tuple**（而是在边界收窄）：pdf.js 的 `PageViewport` 原生声明是 `Array<number>`，收紧后真实 PageViewport 无法直接赋值（要么 cast、要么加适配层）；**边界处收窄一次**比改动公共接口更划算。收窄时必须校验长度——NaN 坐标流到渲染层的表现是"全画在 0,0"，几乎无法排查
- 为什么测试里不引入 pdf.js：单测只锁"我们的换算语义"，pdf.js 自身由它自己的测试保证；用最小 fake viewport（两种形态：有/无 API）覆盖两条代码路径
- bbox 顺序规范化的原因：主项目 API 路径返回的 y 是上→下，与输入的 y 下→上相反 → 统一成 min/max 规范序，避免下游拿到方向不明的 bbox

**验证**
- `pnpm test`：14 passed（transform 10 例：wire 语义 / 缩放无关性 / API 与回退路径一致 / 旋转页抛错 / 组合往返 + SSR 4 例）
- `pnpm typecheck`：0 error（`noUncheckedIndexedAccess` 下的边界收窄）
- `pnpm build`：`dist/core.js` 导出 6 个函数（normToPdf, normToView, pdfToNorm, pdfToView, viewToNorm, viewToPdf）；`dist/core.d.ts` 6.03KB 含完整类型模型；`dist/index.d.ts` 504B 含类型 re-export
- `pnpm verify` 5 gate 全绿

---

---

## 阶段 2 · 第 1 步：React 层基础 —— hooks（状态桥 / 加载 / 缩放 / 虚拟化 / 选区）（2026-11-13）

**做了什么**
- `src/hooks/useStore.ts`：`useStore` / `useStoreSelector`（`useSyncExternalStore` 桥）+ `shallowEqual`
- `src/hooks/usePdfDocument.ts`：文档加载（cache 接入 / loadId 竞态 / 密码流程 ≤3 次 / 进度）
- `src/hooks/useZoom.ts`：缩放 + **锚点保持**（调 core 的纯函数）
- `src/hooks/useVisiblePages.ts`：虚拟化可见页（IntersectionObserver + 缓冲）
- `src/hooks/useCurrentPage.ts`：当前页跟踪（rAF 节流）+ 跳页
- `src/hooks/useTextSelection.ts`：选区几何提取（DOM → SelectionData）
- `tests/setup.ts`：jsdom 缺失 API 补齐（IntersectionObserver / ResizeObserver / matchMedia / canvas 2d 替身）
- `vitest.config.ts`：加 setupFiles + tsx 测试纳入
- 根包加 `@types/react` / `@types/react-dom`（devDep —— 类型是公开契约的一部分，但由宿主提供 React）

**为什么这么实现**
- **core 不依赖 pdf.js**：文档解析（`getDocInfo`）由调用方**注入** → core/hooks 都不 import pdf.js → 单测不需要 pdf.js、也不锁死渲染引擎的用法
- **`useSyncExternalStore` 而非第三方状态库**：React 官方方案，零依赖；core 的 store 是纯 TS（可脱离 React 单测）
- **缩放锚点保持放在 core 纯函数里**：`anchoredScrollTop(scrollTop, anchorY, scaleBefore, scaleAfter)` → 渲染层只负责读/写滚动位置，数学部分可单测
- **虚拟化用 IntersectionObserver**：可见性在主线程之外计算，滚动时不掉帧；不需要自己维护"哪些元素在视口内"
- **当前页用 rAF 节流 + 二分**：滚动事件触发频率远高于帧率；页顶边数组单调 → 二分 O(log n)
- **选区只输出几何**：包不弹窗、不存库、不调模型（v2 边界）

**遇到的问题**
1. **jsdom 的 canvas.getContext 探测本身会抛**：`proto.getContext('2d') === null` 这个探测调用在 jsdom 里抛 "not implemented" → 整个测试文件加载失败
   - 修复：不探测，直接覆盖 `getContext`（jsdom 本来就没有可用实现）
   - 教训：**探测能力时可能本身就是触发点**；不确定就直接替换
2. **`useStoreSelector` 的 `isEqual` 形同虚设**：`useSyncExternalStore` 内部用 `Object.is` 比较快照 → 选择器每次返回新对象 → React 判定"变了" → 无限重渲染
   - 修复：缓存上次结果，`isEqual` 说相等就返回**同一引用**；且**缓存只在订阅回调里更新**，不能在 `getSnapshot` 里更新（React 渲染期间会多次调用 getSnapshot，在里面写缓存会让本次渲染读到新值 → 与上次不一致 → 无限重渲染）
   - 教训：**useSyncExternalStore 的快照必须是纯读取**；写操作只能发生在订阅回调里
3. **usePdfDocument 每次渲染都重新加载（严重 bug）**：依赖数组里有 `loadOptions` / `onError` 等**对象/函数** → 宿主传内联值 → 每次渲染新引用 → effect 每次重跑 → 无限重载
   - 修复：这些 props 全部存进 `optionsRef`，effect 依赖只留 `[file, documentId, reloadSignal]`
   - 教训：**hook 依赖数组里不能放对象/函数 props**（除非调用方保证稳定引用）——这是 React 最常见的性能坑
4. **`reloadSignal` 被 biome 判为"多余依赖"**：它只出现在依赖数组、没出现在 effect 体里 → exhaustive-deps 报错
   - 修复：把 `reloadSignal` **真正用进** loadId 计算（语义也更直观：不同 reload 轮次 id 绝不重复），而不是加 biome-ignore 注释
   - 教训：**规则报"多余依赖"时，先想是不是设计没表达清楚**；用 ignore 注释压制前，先试着用它
5. **loadId 判定失效**：把 `loadIdRef.current += 1` 放在捕获 loadId **之后** → 异步回调里 `loadIdRef.current === loadId` 永远不成立 → 加载结果全被丢弃
   - 修复：改用 `latestLoadIdRef`（记录"当前最新"的那次 id）+ `isCurrent()` 辅助函数统一判定
   - 教训：**竞态保护的判据必须只有一个来源**；"递增计数器"和"当前值"混用会自相矛盾
6. **PowerShell 的 `Set-Content -Encoding UTF8` 破坏源文件**：用 `(Get-Content x) -replace ... | Set-Content` 做批量替换 → 中文注释全变乱码 + 一行被合并（`// 1) 查缓存` 后面的代码被吞进注释）
   - 修复：整个文件重写（write 而非 replace）
   - 教训：**不要用 PowerShell 做源码级批量替换**；用编辑工具的精确替换，UTF-8 中文源码尤其危险

**验证**
- `pnpm test`：119 passed（hooks 17 + core 102）
- `pnpm verify` 5 gate 全绿

---

---

## 阶段 4 · 第 1 步：TextLayer —— 文本层（让文字真的能选中）+ 真实 PDF 联调（2026-11-13）

**做了什么**
- `src/core/text-layer/layout.ts`：文本项 → CSS 定位的纯函数（`positionTextItem` / `layoutTextContent`）
- `src/components/TextLayer.tsx`：透明文字层组件（让浏览器原生可选中）
- `src/components/Page.tsx`：单页组合（canvas + 文本层 + 标注层）
- `src/components/PageCanvas.tsx`：`PageProxyLike` 加可选的 `getTextContent`
- `src/components/PdfViewer.tsx`：`getPageSizes` prop + `pageTops` 取整 + 顶部留白纳入基准
- `src/styles/viewer.css`：文本层样式（透明 + 可选中 + 选区高亮）
- `scripts/e2e-text-layer.mjs`：文本层 E2E（7 项断言）
- demo：优先加载**本地真实 PDF**（`demo/public/samples/local.pdf`，体积大不入库）

**为什么这么实现**
- **文本层是整个包最关键的一块**：canvas 渲染出的是像素 → 用户选不中、复制不了、搜不了。
  叠一层透明 DOM 后，浏览器原生就能选中 → 我们只在 mouseup 时读几何
- **按 `hasEOL` 分行而不是每个 item 一个 span**：一页上千个 item → DOM 爆炸；
  按行合并后每页几十个节点，选中体验也更自然（整行可选）
- **字体大小 = |d| × 视口缩放**：视口矩阵的 vb 是**负的**（y 轴翻转）→ 必须用 hypot 取模长，
  直接乘会得到负字号
- **文本层透明**：用户看到的是 canvas 的真实渲染，文本层只是"给浏览器的可选中替身"
- **页面尺寸由宿主注入**：不同 PDF 尺寸不同（A4 / Letter / 混合），
  用 A4 假设会让页顶边数组不准 → 跳页与当前页都偏

**遇到的问题**
1. **fontSize 算错（真 bug）**：用了 `hypot(a, d) * hypot(va, vb)` —— 把文本矩阵的**水平**缩放
   和视口缩放混在一起 → 字号偏大 40%
   - 修复：字号 = |d| × hypot(va, vb)（视口矩阵的 2D 缩放）
   - 教训：**矩阵分解要想清楚每个分量代表什么**，别把两个不同空间的量相乘
2. **`TextItemLike` 名字冲突**：`search` 模块已有同名导出 → core 桶导出报 TS2308
   - 修复：文本层的改名为 `TextLayerItemLike`
   - 教训：**core 桶是公共 API 面**，导出名必须全局唯一
3. **跳页差 16px + 当前页偏一页（真 bug，E2E 抓到的）**：
   - 现象：跳到第 17 页 → 页码显示 16；目标页顶部偏移 16px
   - 根因 1：`.scpdf-container` 有 `padding: 16px 0` → 页面元素实际位置比 `pageTops` 大 16px
   - 根因 2：`.scpdf-pages` 又有 `margin: 16px 0` → 又差 16px（实测元素在 32px 处）
   - 根因 3：`pageTops` 是小数（29050.24），浏览器 `scrollTop` 取整 → 边界判定差 1px
   - 修复：
     - 容器**去掉 padding**，页面区**去掉 margin**（滚动基准必须是内容原点）
     - `pageTops` 首项 = 顶部留白（16px），全部取整
   - 教训：**滚动定位的坐标系必须端到端一致** —— 任何 CSS 偏移都会打破 scrollTop ↔ 元素位置的对应
4. **调试时反复读到旧数据**：`dist` 没重建 + demo dev server 缓存 → 改了三轮代码都在看旧行为
   - 修复：每次改 `src/` 先 `pnpm build`；必要时重启 dev server
   - 教训：**消费 workspace 包时，跑的是构建产物**；调试前先确认改动真的生效
5. **PowerShell 批量替换又毁了一次中文注释**（`Set-Content -Encoding UTF8`）
   - 修复：调试脚本用 write 工具重写；源码修改一律用编辑工具
   - 教训：**已两次踩同一个坑** —— PowerShell 只用来跑命令，不用来改源码
6. **E2E 误报"请求失败"**：React StrictMode 双挂载会取消第一次 effect 的 fetch
   - 修复：E2E 忽略 `net::ERR_ABORTED`（主动取消不是错误）
   - 教训：**开发模式下的双挂载是正常行为**，不能当成缺陷
7. **E2E 断言时机不稳**：固定 sleep 等待平滑滚动 → 距离越长越容易误判
   - 修复：改用 `waitForFunction` 等待状态达成
   - 教训：**E2E 要等"状态"而不是等"时间"**

**验证**
- `pnpm test`：161 passed（新增 text-layer 16 + store 回归 2）
- `pnpm verify` 5 gate 全绿
- E2E 冒烟：**13/13**（真实 PDF 18 页 / 适配宽度 / 缩放 / **跳页精确到 0px** / 无 JS 错误）
- E2E 文本层：**7/7**（195 个文本片段 / 可选中 / 对齐正确）
- 截图：`e2e-shots/text-layer.png`（真实 PDF 渲染效果）

---

---

## 阶段 5 · 第 1 步：发布基建（size-limit / publint / attw / changesets / CI）（2026-11-13）

**做了什么**
- `.size-limit.json`：4 条体积门禁（主入口 / core / 按需导入 / 策略模块）
- `.attw.json`：类型解析检查配置
- `.changeset/`：changesets 配置 + 说明
- `package.json`：
  - `exports` 改成**条件式 types**（import/require 各自指向 `.d.ts` / `.d.cts`）
  - 补 `main` / `module` / `types`（node10 回退）
  - 加 `size` / `publint` / `attw` / `release:check` / `changeset` / `version` / `release` 脚本
- `scripts/verify.mjs`：门禁从 5 个扩到 **8 个**
- `.github/workflows/ci.yml`：新增 `publish-checks` 与 `e2e` 两个 job
- E2E 脚本改造：**没有本地 PDF 时也能跑**（用内置样张，CI 场景）

**为什么这么实现**
- **体积门禁必须有上限才有意义**：当前主入口 11.74 kB（tree-shaken），
  上限设 25 kB → 依赖偷偷变大时 CI 会红
- **`exports` 的 types 必须分 import/require**：ESM 的 `.d.ts` 给 CJS 用会
  "假 ESM"（attw 报 FalseESM）→ CJS 侧要用 `.d.cts`
- **E2E 要能在 CI 跑**：CI 里没有 16MB 的本地 PDF →
  E2E 自动降级到内置样张，并对"该文档没有的功能"打 SKIP 而不是 FAIL
- **门禁清单单一事实源**：`verify.mjs` 一处定义，本地与 CI 共用

**遇到的问题**
1. **attw 报 2 个真问题**：
   - `node10: Resolution failed` → 缺 `main` / `module` / `types` 回退字段
   - `node16 (from CJS): Masquerading as ESM` → `exports` 的 `types` 没按条件分开
   - 修复：`exports` 改成 `{ import: { types, default }, require: { types, default } }`
     - 补 `main`/`module`/`types` → **"No problems found 🌟"**
2. **size-limit v14 不支持 CSS 打包**（rolldown 移除了该实验特性）：
   `ERROR [UNSUPPORTED_FEATURE] Bundling CSS is no longer supported`
   - 修复：CSS 不交给 size-limit，改为在 CI 里单独检查文件大小
     （`size-limit` 只管 JS；CSS 11.7 kB 由人工/脚本把关）
3. **size-limit 配置里的 `$schema` 字段不被识别**：`Unknown option $schema in config`
   - 修复：删掉该字段
4. **attw 的 `ignoreRules` 用错大小写**：应为 `no-resolution`（kebab-case），
   不是 `NoResolution`（PascalCase）
   - 教训：**配置项的合法值要先查**（报错信息里列了 allowed choices）
5. **E2E 在 CI 会因为缺本地 PDF 而失败**：
   - 修复：检测不到 canvas 就点"载入内置样张"；对"该文档没有的功能"（目录/链接）打 SKIP
   - 教训：**E2E 要能在最小输入下运行**，不能依赖本机的特殊文件

**验证**
- `pnpm verify`：**8 gate 全绿**
- 包体积：主入口 11.74 kB / core 1.15 kB / 按需导入 1.79 kB（上限 25 / 6 / 6 kB）
- publint：`All good!`
- attw：`No problems found 🌟`（node10 / node16 CJS+ESM / bundler 全 🟢）
- E2E 两种场景都通过：真实 PDF（13+7+8+5 项）与合成样张（13+7+8+4 项）

---
