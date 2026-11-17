# DEVLOG —— 开发记录

> 每个提交对应一条记录：做了什么 / 遇到的问题 / 为什么这么实现 / 验证。
> 本文件随代码一起提交，日志本身就是项目历史的一部分。

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

## 第 3 步：lint/format — biome（2026-10-30）

**做了什么**
- `pnpm add -D @biomejs/biome`（v2）
- `biome.json`：recommended 规则集 + house style（单引号 / 分号必写 / trailing commas / 2 空格 / 100 列）
- scripts 加 `lint`（biome check .）/ `format`（biome format --write .）
- 运行 `biome migrate --write`：配置按 CLI 2.6.4 的 schema 迁移（见"遇到的问题"）

**遇到的问题**
1. `biome check` 报 2 条 info（非 error，lint 本身 0 错误）：
   - `$schema` 写的 2.0.0，CLI 实际是 2.6.4 —— 配置 schema 版本与 CLI 版本不配套
   - `rules.recommended` 已废弃，下个主版本移除，要求改用 `preset`
   - 处理：`biome migrate --write` 官方一键迁移，配置自动改写到 2.6.4 schema（语义不变，diff 已人工确认）
   - 教训：**配置文件也有版本**。装最新 CLI 就用官方 migrate 把配置迁到对应 schema；deprecation 噪音不处理 = 等移除那天直接炸 + 团队对警告脱敏

**为什么这么实现**
- 为什么需要 lint+format：公开包的源码会被消费者阅读，风格一致性是专业度的一部分；靠人工维持风格 = 漂移 + 扯皮，自动化 = 零成本
- 为什么 biome 单工具而不是 ESLint + Prettier：
  - 两工具职责重叠：ESLint 的风格规则与 Prettier 格式化互相冲突（eslint-config-prettier 这个包的存在本身就是尴尬的证据）
  - Biome（Rust 单二进制）lint + format 一体，速度 5–10 倍 → 每次保存/PR 都跑，快才有人真的开
  - **取舍（两头都要会说）**：Biome 规则生态/插件系统小于 ESLint（社区插件数千个）。决策规则：需要自定义规则/特定生态插件 → ESLint；标准 TS/React 组件包、内置 recommended 够用 → Biome。将来出现自定义规则需求再切回，biome.json 的配置思路可直接迁移
- `vcs.useIgnoreFile: true`：lint 范围与 .gitignore 共享，"哪些文件不算数"单一事实源
- 规则集用内置 recommended 原样、不写自定义规则——配置最小化，每条开着的规则都有默认理由

**验证**
- `pnpm format` 干净跑完（如有 diff = biome 统一风格，看过后随本提交一起进）
- `pnpm lint` → 0 errors（migrate 后 0 infos）

---

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

## 第 5 步：运行时依赖 — pdfjs-dist + idb（2026-10-30）

**做了什么**
- `pnpm add pdfjs-dist idb`（进 `dependencies`，不是 devDependencies）
- tsup.config.ts 加 `external: ['pdfjs-dist', 'idb']`（与依赖同一提交变更）
- `tests/ssr-smoke.test.ts` 增加 2 条依赖的 SSR import 测试（node 环境可直接 import、import 无副作用）
- 版本：pdfjs-dist ^6.4.x（最新 6 线）、idb ^8.x

**为什么这么实现**
- 这两个是包**仅有的**运行时依赖（方案 §4.1 定死的决策）。提前装 = lockfile 锁住版本 + 依赖的 SSR 属性现在就在依赖层验证，而不是等几千行代码依赖它们之后才发现
- 三类依赖字段的划分标准（面试必答）：
  - `peerDependencies` = "必须全局唯一、宿主提供"（react —— 两份实例 = hooks 崩）
  - `dependencies` = "我的实现细节、版本由我锁、消费者自动安装"（pdfjs-dist / idb —— 宿主不需要知道、也不应能干预；宿主乱装一个不匹配版本就是事故）
  - `devDependencies` = "只在构建/测试本包时需要，消费者不可见"（typescript / tsup / vitest / biome…）
- 为什么 external 和依赖**同一提交**变更：external 是"哪些是我的代码、哪些是我的依赖"的边界线。漏了 external，esbuild 会把依赖打进产物（打进 pdfjs = 包体积暴增数 MB，且宿主无法独立管理其版本）。规则：deps 与 external 一起变
- 为什么给第三方依赖写 SSR 测试："包可 SSR import"的承诺包含整条依赖链——pdfjs 若不能在 Node import，承诺在依赖层就是假的。现在验证，不等渲染层写完
- （选型记录）pdfjs-dist 6.4 **直连**、不用 react-pdf 封装：版本自主 / 不被封装层绑架 / peer 兼容 React 18+19（方案 §3）；退路 ^5.3 记录于方案 §16
- （选型记录）idb：IndexedDB 的 Promise 封装。主项目现有手写 IDB 正是 B1 类 bug（Promise 提前 resolve、删除无人等待）的来源，idb 从 API 形态上消灭这类回调陷阱

**观察**
- SSR 测试（pdfjs-dist 的 Node import 测试）中 pdfjs 打印 `Warning: Please use the 'legacy' build in Node.js environments`——阶段 0 只验证"import 不炸"，警告可接受；阶段 1 core 真正 import pdfjs 时决定构建策略（浏览器 = modern build；Node/SSR 需要碰 pdfjs API 时 = legacy build 或动态 import）

---

## 第 6 步：core 公共类型模型（API 契约）（2026-10-30）

**做了什么**
- `src/core/types.ts`：全部公共类型（坐标三空间 / NormRect wire 格式 / BboxData / HighlightRecord / SelectionData / StorageAdapter / PopoverAction / 错误码等）
- core 子路径入口落地：`src/core.ts`（子路径入口）+ `src/core/index.ts`（实现目录）；`src/index.ts` re-export 类型模型 + VERSION
- tsup entry 扩为 index + core（2 入口 × esm/cjs × dts）
- package.json 加 `exports`（`.` 与 `./core`，types 条件第一位）+ `files: ["dist"]`

**为什么这么实现**
- types 先行：类型文件是 API 的 single source of truth，实现/测试/文档都从它推导；评审 API = 评审这一百多行，而不是三千行实现
- wire 兼容类型的注释即文档：NormRect / BboxData 的语义（哪个坐标系、原点在哪、页码 0-based 还是 1-based、比例的参考是什么）是全包最易错的部分，写进类型注释后维护者永不需要再问"这字段什么意思"
- 坐标三空间（PDF 点 / 归一化 / 视口 px）一次定义，后续所有换算都是基于这些类型的纯函数——从结构上消灭主项目"换算散落 5+ 文件"的问题（A6）
- core 子路径入口在这一步落地（而不是更早/更晚）：入口结构在这里定稿，exports map 描述的正是这个结构——**入口结构与 exports 同提交**
- 为什么只有 `exports`、不写 main/module：exports 是 ESM 时代唯一标准入口声明，还能封死深路径导入（消费者 import 不到内部实现）；main/module 是 CJS 时代遗留，现代 bundler 消费方不需要——契约面最小化
- `files: ["dist"]` 同提交：npm 包面 = 发布面；没有 files 白名单，demo/tests/DEVLOG 全会进包（安装成本 + 供应链攻击面）
- `src/core.ts`（子路径入口）与 `src/core/`（实现目录）同名共存是标准模式，模块解析优先同名文件，不冲突
- `dist/core.js` 当前是空模块属正常：契约暂全是类型（类型擦除后无运行时导出），阶段 1 第一个运行时函数（坐标换算）落地后它才有内容

**【阶段 1 更正】以上两条判断均有误**

- 上一条"同名共存是标准模式"不成立：同名文件与同名目录共存时，`src/core.ts` 里 `export * from './core'` 会**解析到它自己**（同名文件优先于同名目录）→ 自引用 → 类型模型与运行时导出**全部没进产物**（`dist/core.d.ts` = `export {}`，`dist/index.d.ts` 只剩 VERSION）。已在阶段 1 · 第 1 步修复：删 `src/core.ts`，tsup entry 指向 `src/core/index.ts`，引用改显式路径 `'./core/index'`
- "空模块属正常"的真实原因不是"契约全是类型"，而是上面的自引用。修复后 `dist/core.js` 导出 6 个函数、`dist/core.d.ts` 6.03KB（含完整类型模型）

**验证**
- `pnpm test` → 4 passed（含 core 子路径 import）
- `pnpm build` → dist 12 个文件（2 入口 × 4 产物 + 4 maps）；`dist/core.js` 为空模块
- node 直接 import `dist/index.js` 与 `dist/core.js` 均成功
- `pnpm typecheck` 通过

---

## 第 7 步：基础样式 — scpdf- 前缀 + CSS 变量主题（2026-10-30）

**做了什么**
- `src/styles/viewer.css`：15 个主题 CSS 变量（色板 / 高亮三层 / bbox / 阴影 / 圆角 / 动效时长 / 阅读字体）+ `.scpdf-root` 基础类
- `scripts/build.mjs`：构建 = 单个 Node 脚本（tsup() 打包 → copy CSS），package.json scripts 零 shell 拼接
- build script：`"build": "node scripts/build.mjs"`
- package.json：exports 加 `"./styles.css": "./dist/styles.css"`；加 `sideEffects: ["**/*.css"]`

**遇到的问题**
1. 初版 build script `tsup && node scripts/copy-css.mjs` 在 Windows 上失败：`&&` 不是 PowerShell 5.1（Windows 默认 PowerShell）的有效语句分隔符。
   - `&&`：cmd / bash / PS 7 有效，**PS 5.1 无效**；`;`：PS 有效，cmd 无效 → **package.json scripts 里的 shell 语法不是跨平台的**
   - 修复：多步构建收进单个 Node 脚本（scripts/build.mjs：`await build({})` → copy CSS），scripts 零 shell 语法 → 任何 OS / 任何 shell 行为一致
   - 关联纪律：项目统一 pnpm（有 pnpm-lock.yaml），误用 npm 会生成 package-lock.json + hoisted node_modules 布局，与 lockfile 分叉
2. 编程接口连错三次，根因有三层：
   a) `import { tsup } from 'tsup'` SyntaxError：`Named export 'tsup' not found`
   b) 改 default import + 解构后仍 `tsup is not a function`——**tsup 9 把编程函数从 `tsup()` 改名成了 `build()`**，旧名已不存在
   c) 改调 `build()` 后 `Cannot read properties of undefined (reading 'config')`——签名是 `build(options)`，**options 必传**；传 `{}` = 无 CLI 参数、自动从 cwd 加载 tsup.config.ts（源码 `loadTsupConfig(process.cwd(), ...)` 确认）
   - 确认真相的方式：读 node_modules 里 tsup 9.0.0 的 `dist/index.js`（`exports.build = build` + `build` 实现：config 非 false 时 `loadTsupConfig(process.cwd(), ...)`）和 `dist/index.d.ts`（`export { build, defineConfig };` / `declare function build(_options: Options)` 必填参数）
   - 修复：`import tsupModule from 'tsup'; const { build } = tsupModule; await build({});`
   - 教训 1：CJS→ESM 互操作铁律 = **default import 永远安全，named import 不保证**；第三方 CJS API 一律用 default 形态
   - 教训 2：API 行为与预期不符时，**读 node_modules 里已装版本的 .d.ts / 源码**，不要凭文档或记忆猜——文档可能写的是旧主版本（v9 改名就是例子）；读的时候导出名和签名都要读（(c) 的必填参数 d.ts 里早就写明，上一轮只看了导出名）

**为什么这么实现**
- 为什么裸 CSS 文件（否决 CSS-in-JS / CSS Modules）：
  - CSS-in-JS（styled-components/emotion）：消费者被迫装运行时（宿主已有自己的版本时两份并存）；运行时生成样式 = 首屏性能税 + SSR 闪烁
  - CSS Modules：消费者构建配置必须支持，哈希类名不可控（视觉回归无法对比）
  - 裸 CSS：**零构建约束**——任何 bundler、甚至 CDN `<link>` 直引都能用。"零构建依赖"是组件包样式的最高形态
- `scpdf-` 前缀：裸 CSS 是全局的，类名撞宿主（.button/.modal）是家常便饭；前缀 = 命名空间隔离
- CSS 变量 = 主题注入面：宿主覆盖几个变量就融入自家设计系统，不用 fork 包；变量清单本身就是公共 API（进 README）
- 为什么 copy 脚本而不是 tsup 顺带产物：tsup/esbuild 只处理"JS 里 import 的 css"（按 entry 命名）；我们需要稳定的 `./styles.css` 子路径（消费者可选 import 或 CDN link）——copy 脚本让 CSS 产物位置显式可控
- 为什么 `sideEffects` 必须与 CSS 同提交：tree-shaking 默认假设"import 无副作用可删"，而 CSS import 的副作用恰恰是注入样式。不声明 = 消费者生产构建把样式 import 摇掉，组件裸奔（dev 正常、prod 坏，排查噩梦）

**验证**
- `pnpm build` → dist 13 个文件（12 + styles.css），内容 = src/styles/viewer.css
- 测试 4/4 绿，typecheck 干净

---

## 第 8 步：demo — Vite 8 + React 19，零 antd（2026-10-30）

**做了什么**
- pnpm workspace：根 `pnpm-workspace.yaml`（packages: demo）；demo 以 `workspace:*` 消费根包
- `demo/`：Vite 8 + React 19 + @vitejs/plugin-react；原生元素 + 包 CSS 变量，**零 antd**
- 根 package.json：`peerDependencies: react >=18 <20`；script `demo`（`pnpm --filter ... dev`）
- demo 消费的是 **dist 构建产物**（先 `pnpm build` 再 `pnpm demo`）
- `scripts/verify.mjs` + script `verify`：质量门禁总入口（lint → typecheck → test → build → demo:typecheck，顺序执行、任一红即停）
- 根 package.json 加 `packageManager: "pnpm@10.32.1"`（pnpm 版本单一事实源，pnpm/action-setup 与 corepack 自动读取）

**遇到的问题**
1. 编辑器报 2 个错、当时只跑了根 typecheck——逐条区分真假：
   - `ts(2882) 找不到 styles.css 侧效导入的类型声明`：**真缺口**——`.css` 侧效导入的类型来自 Vite 的 `vite/client`（`declare module '*.css'` 通配声明，TS 5.6+ 开始检查侧效导入），Vite 模板标配的 `src/vite-env.d.ts` 被漏建
     - 为什么只在编辑器看到：demo 有独立 tsconfig，它的 `tsc --noEmit` **还没跑过**（Vite 渲染页面不做类型检查，页面正常 ≠ 类型绿）。demo 的 typescript 实际解析到 5.9.3（与根一致，全工作区单一编译器版本）
     - 修复：新建 `demo/src/vite-env.d.ts`（一行 `/// <reference types="vite/client" />`）
   - `ts(2307) 找不到 './App'`：**假报错**——文件存在且 CLI 能解析，是编辑器 TS Server 在 App.tsx 创建前就检查过 main.tsx 的过期状态
     - 修复：`TypeScript: Restart TS Server`（零代码改动）
2. 全库 `biome check` 报 15 个 format 错误：CRLF 行尾（Windows 编辑器）+ 双引号（编辑器保存时自动格式化覆盖了 biome 单引号 house style）+ 1 处 import 顺序
   - 根因：**编辑器和 biome 各持一套"格式权威"**；第 4 步起新增文件后没有再跑 `pnpm format`
   - 修复：`biome check . --write` 一次清空（Biome 2.6 的 apply 叫 `--write`，`--apply` 是旧版本 flag，已不存在）+ `.gitattributes`（`* text=auto eol=lf`，LF 是跨平台/包生态标准）+ `.vscode/settings.json`（Biome 扩展为唯一格式化器 + files.eol LF + `js/ts.tsdk.path` 指向工作区 typescript；`typescript.tsdk` 在新版 VS Code 已废弃改名）
   - 纪律：**格式权威只能有一个**——编辑器保存格式化必须与 CLI 同一工具，否则每次保存都是拉锯；编辑器与 CLI 还应共用同一 TS 版本（tsdk 指到 node_modules）
3. `main.tsx` 的 `getElementById('root')!` 触发 `noNonNullAssertion`（biome recommended 警告）：`!` 是模板惯性，改为显式判空 + 快速失败（throw 明确错误），不关规则

**为什么这么实现**
- demo = 第一个"真实消费者"：它扮宿主 App 的角色——react 由它安装提供（宿主职责），包只声明 peer 范围
- react 为什么是 peer 而不是 dep：**全局唯一性**——宿主树里出现两份 React = 两套 hooks 派发器 = "Invalid hook call" / 状态分裂；包无法控制宿主的实例数，只能声明 peer + 依赖宿主包管理器去重
- react-dom 为什么**不是** peer：包运行时不用 react-dom（createRoot 是宿主的事），peer 只声明真正依赖的
- peer 为什么这一步才进 package.json：peer 契约在"第一个消费者出现"的时刻才有意义；之前声明 = 没有消费者可验证的空口承诺，demo 落地才能验证范围真的接受 19
- **demo 必须 import dist 构建产物，不是源码**（核心纪律）：
  1. 消费者保真——消费者只有 dist；demo 走源码等于测"我们的开发环境"而不是"发布物"
  2. exports map / d.ts / external 边界 / ESM-CJS 双格式这些契约面**只有 dist 路径能检验**；源码 import 全绿 ≠ 消费者能用（第 2 步 d.ts 生成挂掉那次，源码路径根本发现不了）
  3. 代价 = 开发前先 `pnpm build`（~1s）——这个代价就是价值（保真税）；大包可以源码 alias 换 DX 速度，小包背离保真不划算
- 零 antd 的 demo 本身就是验收标准：包 + demo + 集成层三处零 antd 是既定约束；demo 证明"不靠 UI 库也能搭出可用的消费端"
- workspace 而不用 npm link：workspace 协议是 pnpm 原生语义、lockfile 可追溯；发布不受影响（`files: ["dist"]` 保证 demo 不进包）
- 为什么 verify 脚本：门禁清单单一事实源——本地提交前与 CI（第 9 步）跑同一个脚本，"本地绿 = CI 绿"结构上成立；每个 gate 是单条 pnpm 命令（零 shell 拼接，第 7 步 && 教训的延续）；顺序有含义（build 先于 demo:typecheck——demo 消费 dist）

**验证**
- `pnpm build` → `pnpm demo` → http://localhost:5173：main 入口 VERSION / core 子路径空模块（运行时导出 []）/ styles.css 变量色块生效
- `pnpm verify` 5 个 gate 全绿（demo typecheck 首跑，走 dist 的 d.ts，类型契约也被验证）
- 根 typecheck / test / lint 保持绿

---

## 第 9 步：CI — GitHub Actions（2026-10-30）

**做了什么**
- `.github/workflows/ci.yml`，两个 job：
  - `verify`：主管线 = `pnpm verify`（与本地同一个脚本）
  - `react-matrix`：demo 在 react 18 / 19 下都能 typecheck + vite build（持续验证 peer 范围 `>=18 <20`）
- 触发：push main + PR；`concurrency` 同分支只留最新一次

**为什么这么实现**
- CI 跑 `pnpm verify` 而不是列步骤：门禁清单单一事实源（scripts/verify.mjs），加/改门禁 = 改一个文件，"本地绿 = CI 绿"结构上成立
- `--frozen-lockfile`：CI 必须装 lockfile 记录的那棵树（deps 表达意图、lockfile 表达事实）；有分歧 = lockfile 过期或有人装完没提交
- 为什么有 react 矩阵：peer 范围是写进 package.json 的对消费者承诺，"18 也能用"必须由机器持续证明。阶段 0 矩阵成本低（只有类型 + demo），阶段 2 组件（hooks）落地后同一矩阵自动覆盖 react 18/19 的类型与 hook 行为差异——提前铺好，到时候零成本
- 矩阵 job 先跑根 build：demo 消费 dist（保真纪律），CI 全新 checkout 没有 dist
- Node 24：最新 LTS 线，且在 `engines: node>=22.13` 声明的范围内
- yml 本身即交付物：推送到 GitHub 远端后自动生效

**验证**
- 本地：`pnpm verify` 全绿；react 矩阵本地模拟通过（demo 换装 react@18 → typecheck + build 绿 → 换回 19，`git restore pnpm-lock.yaml demo/package.json` + `pnpm install` 还原基线）
- GitHub 侧：推送到远端后首跑确认两个 job 全绿

---

## 第 10 步：README + 测试样张清单（Phase 0 收尾）（2026-10-30）

**做了什么**
- `README.md`：包的门面——定位 / 五条设计原则（硬约束）/ 三条消费契约 / 主题变量表 / StorageAdapter / 错误码表 / 坐标三空间 / 开发指引 / roadmap
- `TEST-SAMPLES.md`：10 个 PDF 测试样张（S1–S10），每个标注用途 / 验证点 / 获取方式；实际文件放 `test-fixtures/`（gitignore，不进库）
- `.gitignore` 加 `test-fixtures/`

**为什么这么实现**
- README = 面试第一张幻灯片：**"设计原则"放在"功能"前面**——零 LLM / 零 antd / 零业务 API / SSR 安全 / wire 兼容这五条硬约束是包的差异化，先讲原则再讲用法
- 只写已存在的东西：组件阶段 2 才来，README 只呈现当前契约（类型 / 三入口 / 主题 / 适配器）+ roadmap，不虚构功能——0.x 的诚实比 1.0 的包装可信
- 测试样张是"清单"不是"文件"：PDF 大，直接进库仓库会胖（git-lfs 是另一个决策）；清单固定的是"该测什么、从哪来、每个文件验证什么"——阶段 2+ 回归的验收基准
- 10 个样张与方案 §9 边界矩阵一一对应：9 个 E_* 错误码全部有样张覆盖，另有旋转 / 大文件 / CJK / 无文本层四个渲染边界
- biome 2.6 的 markdown 格式化验证过（prose 保持原样、表格不重排），.md 进 lint gate 无副作用

**验证**
- README 代码块自测：安装/导入示例可直接复制运行；变量表与 `src/styles/viewer.css` 逐条一致
- TEST-SAMPLES.md 覆盖全部 9 个错误码 + 4 个渲染边界
- `pnpm verify` 仍 5 gate 全绿（第 10 步纯文档，零代码改动）

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

## 阶段 1 · 第 1.5 步：范围收窄 —— 确立"只做 PDF"的边界（2026-11-13）

**发生了什么**
- 原计划第 2 步做 `core/wire.ts`（后端 `ScaledPosition`/`HighlightType` → `HighlightRecord` 映射），写到一半被自己叫停并删除
- 重新确立包的定位：**只做 PDF 本身——加载快、定位准、缩放稳；业务交互全在宿主**
- 新方案文档：`PdfViewerPackagePlan-v2.md`（包本体方案，v1 保留作历史）

**为什么这么实现**
- **最初的越界**：把 `noteuuid` / `contentType` / `isPrivate` / `likeNum` 这些**后端业务字段**写进包 → 包就只能给这一家后端用，与"换个后端也能用"直接冲突
- **判据（一句话）**：这个能力是"PDF 自身的"还是"PDF 之外的"？前者进包，后者留宿主
  - 进包：滚动/翻页/缩放/当前页/选择几何/高亮绘制/内部链接/搜索/缩略图/目录/打印/键盘
  - 留宿主：选区弹层（解释/提问/翻译）、AI 追问与流式回填、证据框 bbox、笔记增删改查、点赞评论、持久化
- **连带取消的两个 v1 设计**：
  - `StorageAdapter`（宿主注入持久化）→ 改为**受控 props**（`highlights` 进、`onHighlightCreate/Update/Remove` 出），持久化归宿主
  - `PopoverAction`（宿主注册弹层动作）→ 删除；包只输出选区几何 `onSelectionChange`，弹什么由宿主自己决定
- **bbox 也不进包**：它是业务数据（AI 证据），不是 PDF 能力
- 结果：包的公共 API 变成**纯受控 + 中立模型**，且 §2.4 写明"包内禁止出现的字段清单"（noteuuid/contentType/isPrivate/API 路径/登录态…），CI 可加 lint 规则卡住
- **推论（这条最值钱）**：包内**根本没有后端的位置**，所以"换个后端也能用"不是靠适配，是**结构上就成立**

**验证**
- `src/core/wire.ts` 已删除（`git status` 仅剩 DEVLOG 修改）
- 方案 v2 §2 边界表 + §6.1 props 表 + §6.5 错误码表已按新边界重写

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

## 阶段 1 · 第 3 步：core/cache —— 文档字节缓存（2026-11-13）

**做了什么**
- `src/core/cache/store.ts`：`DocumentCache` 类（IndexedDB 主存 + 内存降级 + LRU + 配额）+ `cacheKey()`
- `src/core/cache/store.test.ts`：16 个用例（node 环境，纯内存模式，零真实 IndexedDB）
- `src/core/cache/index.ts` + `src/core/index.ts`：出口接线

**为什么这么实现**
- **只缓存文档字节，不缓存渲染结果**：渲染结果与缩放/旋转强相关（缓存 key 要带全部渲染参数 → 命中率与收益双输）；文档字节是内容寻址的（换缩放/换页码/换设备都不用重下），命中断的是**网络往返**这个最大耗时来源
- **IDB 不可用不是错误，是降级**：Safari 隐私模式 / 用户禁用 → 自动切内存 Map（会话内有效），并发 `onCacheEvent({type:'error', code:'E_CACHE_UNAVAILABLE'})` 告知宿主。加载流程绝不能因缓存失败而失败
- **所有 IDB 操作包 try/catch**：任何 IDB 异常都不能冒泡到加载链路
- **配额是硬约束**：单条就超过配额 → 不缓存（宁可这次不命中，也不突破配额或留空壳）
- **`cacheKey` 不让包自己算内容哈希**：hash 要读全文件做 crypto 计算，大文件会阻塞；宿主有 `documentId` 时直接用它更省

**遇到的问题**
1. **LRU 会淘汰掉刚写入的条目（真 bug，测试抓出）**：淘汰循环取"全局最旧"条目，而同一毫秒写入的条目 `accessedAt` 相同 → "最旧"可能就是刚写的那条 → **写进去立刻被删（静默丢数据）**
   - 修复 1：淘汰时**排除刚写入的 key**（`oldestEntry(excludeKey)`）
   - 修复 2（更根本）：LRU 排序键从 `Date.now()` 换成**单调递增序号** `sequence` —— 毫秒精度下同毫秒条目序号相同、顺序随机；单调计数器保证"后访问的一定更大"，顺序严格可预期
   - 教训：**毫秒级时间戳不适合做 LRU 排序键**；缓存这类"顺序敏感"的数据结构要用计数器
2. **测试前提写错**：原用例假设 `a` 在写 `b` 后仍存在（实际 `a` 已被淘汰，`get('a')` 必然 miss → 断言必然失败）
   - 修复：改写为正确前提（a=40,b=40 都在 → 触碰 a → 写 c → 淘汰 b），并**补两个用例**：刚写入的条目不会自己淘汰、单条超配额不缓存
   - 教训：测试失败时先分清"实现错了"还是"测试的前提错了"——这次两者都有（实现真 bug + 测试前提错），只改测试会掩盖真 bug
3. `dist/core.d.ts` 体积随类型模型增长（10.7KB）→ 属预期（类型是公开契约，宿主需要）

**验证**
- `pnpm test`：47 passed（cache 16 + loader 17 + geometry 10 + SSR 4）
- `pnpm verify` 5 gate 全绿

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

## 阶段 1 · 第 5 步：core/search —— 文本索引与搜索（2026-11-13）

**做了什么**
- `src/core/search/search.ts`：`PdfSearch` 类（懒建索引 / 分片构建 / 大小写与全角归一化 / 命中上限 / 全文提取）
- `src/core/search/search.test.ts`：14 例
- 目录结构：`search/search.ts` + `search/index.ts`（桶文件）——实现与桶分开，避免"同名文件既是实现又是出口"

**为什么这么实现**
- **懒建索引**：只在第一次搜索时建，不在加载时建——加载时建会让首屏变慢（用户可能根本不搜索）
- **分片构建 + 让出主线程**：每 10 页 `await yieldToHost()` 一次，否则 500 页文档建索引会卡住 UI 好几秒（长任务 > 50ms = 掉帧）
- **大小写 + 全角归一化**：搜 "pdf" 要能命中 "PDF"、搜 "abc" 要能命中 "ａｂｃ"（全角）——搜索体验的细节，也是中文文档的常见需求
- **命中按页码顺序**：结果顺序可预期 > 性能（用户会按顺序跳）
- **单页/总命中上限**：防止在超大文档里搜一个高频词返回上万条把 UI 拖垮
- **单页失败不中断整体建索引**：某页是纯图片（无文本层）→ 记为空页继续；取页本身失败（页已销毁）同样要兜住

**遇到的问题**
1. **类型签名写错导致 9 个类型错误**：`getPage: (n) => Promise<TextPageLike> | undefined` —— 这个写法的 `| undefined` 绑定的是 **`Promise` 本身**（"可能返回一个 undefined 的 Promise"），而不是"Promise 可能 resolve 成 undefined"
   - 修复：改成 `(n) => Promise<TextPageLike | undefined>`
   - 教训：**联合类型的绑定位置**是 TS 里最容易看错的地方之一；写完签名要用真实调用方校验一次
2. **测试期望值算错**：以为失败页会让命中数少 1，实际第 1、3 页都有 'good text' → 2 个命中才对
   - 修复：改断言为"第 2 页为空 + 命中 2 个"，顺带把 `indexedPages === 3` 也断言上（更能表达"失败页不影响整体"）

**验证**
- `pnpm test`：101 passed（search 14 + store 17 + selection 23 + cache 16 + loader 17 + geometry 10 + SSR 4）
- `pnpm verify` 5 gate 全绿

---

## 阶段 1 · 第 6 步：core/store —— 每实例状态容器（2026-11-13）

**做了什么**
- `src/core/store/instance.ts`：`createStore()`（纯 TS 容器）+ `createViewerStore()` + `ViewerState` + `anchoredScrollTop()` + `findCurrentPage()`
- `src/core/store/instance.test.ts`：17 例
- `src/core/index.ts`：出口接线

**为什么这么实现**
- **自己写而不用 valtio/zustand**：包不该给宿主强加运行时依赖（一个 PDF 查看器不值得拖一个状态库）；`useSyncExternalStore` 是 React 官方方案，够用
- **每实例一份 state**：多个查看器互不干扰（主项目有"主视图 + 缩略图预览"的需求）
- **`setState` 无变化不通知**：避免无谓重渲染（React 的重渲染代价不低）
- **通知时遍历快照**：监听器可能在回调里取消订阅 → 遍历活着的 Set 会出问题
- **`anchoredScrollTop` 抽成纯函数**：缩放锚点保持是"缩放不跳动"的核心，纯函数可单测（渲染层只负责读滚动位置）
- **`findCurrentPage` 用二分**：主项目原实现每次滚动全量遍历所有页 → 长文档卡顿；页顶边数组是单调的 → 二分 O(log n)

**遇到的问题**
1. **`findCurrentPage` 会返回"不存在的第 N 页"**：页顶边数组的最后一项是**文档总高的哨兵**，二分命中它 → 返回 `页数+1`
   - 修复：用 `Math.min(..., pageTops.length - 1)` 夹到真实页数
   - 教训：**哨兵值要显式处理**，否则它会漏进业务结果
2. **`anchoredScrollTop` 的测试期望值算错**（期望 150 / 0，实际 250 / 25）
   - 重新推导：内容坐标 c = (scrollTop + anchorY) / scaleBefore；新 scrollTop = c × scaleAfter − anchorY = 250 / 25 —— **实现是对的，测试的算术错了**
   - 教训：断言写错和实现写错要分清；这里先推导公式再对答案，而不是"看着不对就改实现"

**验证**
- `pnpm test`：101 passed
- `pnpm verify` 5 gate 全绿

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

## 阶段 2 · 第 3 步：demo 真实接入 + E2E 冒烟（2026-11-13）

**做了什么**
- `demo/src/App.tsx`：真实 pdf.js 接线（标准宿主示例）
  - pdf.js 全部在宿主侧：包不 import pdf.js（换引擎不用改包）
  - 手写 3 页样张 PDF（仓库不放二进制，字节可控）
  - 高亮**受控**（宿主存）、选区**只有几何**（宿主决定弹什么）
  - 工具栏 slots 塞宿主自己的"添加高亮"按钮
- `scripts/e2e-smoke.mjs`：真浏览器冒烟（12 项断言 + 截图）
- `demo/index.html`：内联 SVG favicon（消掉 404）
- `package.json`：加 `e2e` / `e2e:serve` 脚本
- `src/components/PageCanvas.tsx`：`render()` 参数补 `canvas`（pdf.js v6 要求）
- `src/hooks/useZoom.ts`：`fitWidth`/`fitPage` 改为**接收真实页宽页高**（原来硬编码 100）
- `src/components/PdfViewer.tsx`：加 `getPageSizes` prop + `initialScale='width'` 真实实现

**为什么这么实现**
- **E2E 是唯一能验证"真的画出来了吗"的手段**：jsdom 没有 canvas 渲染能力，"PDF 渲染/缩放/定位"这三件核心事单测覆盖不到
- **复用本机已装的 Chromium**（chromium-1234）而不是让 Playwright 下载 1254：省时间、不污染环境；脚本里自动探测版本
- **样张 PDF 手写字节**：不放二进制进仓库（体积 + 审查成本），且能精确控制每页文字（便于测选中）
- **页尺寸由宿主注入**（`getPageSizes`）：不同 PDF 尺寸不同，用 A4 假设会让页顶边数组不准 → "跳页"和"当前页"都偏

**遇到的问题**
1. **Playwright 版本与本机浏览器不匹配**：`browserType.launch` 报 "Executable doesn't exist at chromium_headless_shell-1254"
   - 修复：脚本自动探测 `%LOCALAPPDATA%\ms-playwright` 下已装 chromium（取版本号最大），用 `executablePath` 启动
   - 教训：**环境差异要在脚本里兜住**，不能假设"装依赖 = 装齐浏览器"
2. **ESM 里用 `require` 报错**："Cannot determine intended module format because both 'require' and top-level await are present"
   - 修复：改用顶层 `import { readdirSync } from 'node:fs'`
   - 教训：`.mjs` + 顶层 await → 纯 ESM，不能混 `require`
3. **E2E 脚本自己写错（缩放到底后继续点禁用按钮）**：`locator.click` 超时 30s
   - 修复：循环里先 `isDisabled()` 判断，禁用就 break
   - 教训：**E2E 失败先分清是"产品 bug"还是"脚本 bug"** —— 这次是脚本假设错了
4. **favicon 404 被当成运行期错误**：浏览器自动请求 /favicon.ico
   - 修复：① demo 加内联 SVG favicon；② E2E 过滤 favicon 相关错误（浏览器行为不是包的问题）
5. **`fitWidth` 数学硬编码页宽 100**：`containerWidth / 100` → 适配宽度完全算错（页面小到离谱）
   - 修复：改为接收真实页宽（pt）；`fitPage` 同理
   - 教训：**凡是"魔法数字"都要问"它代表什么"** —— 100 显然不代表任何真实页宽
6. **`initialScale` 判断写反（真 bug）**：`if (initialScale === 'width') return;` → 永远不执行适配宽度
   - 修复：改成 `!== 'width'` 才执行
   - 教训：**条件写反了，测试和类型都发现不了**（逻辑上"合法但没效果"）；E2E 的"页宽接近容器宽"断言直接抓到了
7. **demo 消费的是 `dist/`（构建产物），改 `src/` 不生效**：调试时一度以为是逻辑问题
   - 修复：改完 `src/` 先 `pnpm build` 再测
   - 教训：**workspace 包消费的是构建产物**，不是源码；调试前先确认"改的代码真的被加载了"

**验证**
- `pnpm test`：142 passed
- `pnpm verify` 5 gate 全绿
- E2E（真 Chromium）：**12/12 通过** —— 3 页真实渲染 / 595×842 初始 / 适配宽度 207% / 缩放 207%→217% / canvas 1232→1292px / 跳页 / 无 JS 错误
- 截图：`e2e-shots/viewer-fit-width.png`（适配宽度）、`e2e-shots/viewer.png`（缩放后）

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

## 阶段 4 · 第 3 步：链接层 + 密码框 + 错误态（2026-11-13）

**做了什么**
- `src/core/annotation/links.ts`：链接归一化 + 安全过滤 + 命中测试 + 视口换算
- `src/components/LinkLayer.tsx`：链接覆盖层（透明可点区域）
- `src/components/PasswordDialog.tsx`：加密文档密码框（宿主不接管时的默认 UI）
- `src/components/PageCanvas.tsx`：`PageProxyLike` 加可选 `getAnnotations`
- `src/components/Page.tsx`：接入链接层（文本层之上、标注层之下）
- `src/components/PdfViewer.tsx`：加 `showPasswordDialog` / `onExternalLink` / `onInternalLink` props + 注解懒加载
- `src/styles/viewer.css`：链接层 + 对话框样式 + `.scpdf-visually-hidden`
- `scripts/e2e-links.mjs`：链接层 E2E（5 项断言）
- 测试：links 16 例

**为什么这么实现**
- **链接用透明 DOM 而不是 canvas 画**：要能点、要能被读屏器识别、要能 hover
- **URL 必须过滤**（`javascript:` / `data:`）：PDF 是**不可信输入**，
  渲染成可点击链接前必须按协议白名单过滤 → 这是安全底线，不是可选项
- **链接层在文本层之上、标注层之下**：链接要能点（文本层不能挡），
  但高亮优先（标注层在最上）
- **密码框由宿主决定用不用**：加密 PDF 是通用场景 → 包提供默认 UI；
  但"弹不弹"是宿主的事 → `showPasswordDialog` 开关
- **密码不留在 state 里**：关闭对话框时清空（不留在内存）

**遇到的问题**
1. **`usePdfDocument` 的密码回调是"宿主接管"语义**：内置密码框要接管它，
   但不能覆盖宿主的回调 → 改成"宿主优先，否则用内置"
2. **密码提交后要重新加载**：`reload()` 不带新密码 → 需要把新密码存进 state
   再触发加载（`currentPassword`）
3. **`currentPassword` 声明在使用之后**：TS 报 "used before its declaration"
   → 状态必须声明在 hook 调用之前
4. **`<a>` 无内容 → biome a11y 报错**：链接是"透明可点区域"，
   视觉上没内容 → 加 `.scpdf-visually-hidden` 的文本兜底（读屏器需要）
5. **`noUncheckedIndexedAccess` 下解构 rect 得到 `number | undefined`**：
   `const [x1, y1, x2, y2] = rect` → 逐个判空（不用 `!` 断言）

**验证**
- `pnpm test`：225 passed
- `pnpm verify` 5 gate 全绿
- E2E 链接：**5/5**（50 个链接区域 / 位置在页面内 / 无 javascript: / 点击触发宿主回调）

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

## 收官：README 重写 + PLAN 更新 + 全量复跑（2026-11-13）

**做了什么**
- `README.md` **整体重写**：v1 的 `StorageAdapter` / `PopoverAction` / `BboxData` 全部移除，
  改为 v2 的真实 API（受控 props + 事件回调 + 宿主接线示例 + 能力清单 + 坐标三空间 + 12 错误码）
- `PLAN.md` §13 里程碑表更新为实际完成状态（阶段 0/1/2/4/5 ✅，阶段 3 按需进行）
- `tests/readme-example.test.tsx`：**README 示例的可编译性测试**
  - README 是用户看到的第一份契约，示例编译不过 = 用户第一步就卡住 → 用测试锁住

**遇到的问题**
1. **README 里写错了错误码**：凭记忆写的是 `E_LOAD_ABORTED` / `E_RENDER_CANCELLED` /
   `E_INTERACTION`，实际是 `E_LOAD_TIMEOUT` / `E_FONT_MISSING` / `E_LINK_INVALID` 等
   - 修复：以 `src/core/errors.ts` 为准逐个核对
   - 教训：**文档里的枚举值必须对着源码核**，凭记忆写必错
2. **CSS 变量数量写错**：写了 27（把暗色主题的重复定义也算进去了）→ 实际 `:root` 下 15 个
   - 修复：数 `:root` 块内的定义
3. **biome 报"不要在函数内定义组件"**：README 测试里把 `Reader` 组件写在 `it()` 内部
   - 修复：提到模块级
   - 教训：**每次渲染重建组件**会丢状态（这里是无意，但也是真实性能问题）

**最终验证（全量）**
- `pnpm verify`：**8 门禁全绿**
  （lint / typecheck / test / build / demo:typecheck / size / publint / attw）
- `pnpm test`：**229 passed**（19 个测试文件）
- E2E（真 Chromium，真实 PDF 18 页）：
  - `e2e-smoke` 13/13 · `e2e-text-layer` 7/7 · `e2e-panels` 12/12 · `e2e-links` 5/5
  - **合计 37 项断言全通过**
- E2E（合成样张，CI 场景）：13/13 · 7/7 · 8/8 · 4/4 → **CI 可跑**
- 包体积：主入口 **11.74 kB** / core 1.15 kB / CSS 11.7 kB
- attw：node10 / node16(CJS+ESM) / bundler 全 🟢

**交付清单（15 个提交）**
```
49d5787 阶段 0  包骨架
2ea055e 阶段 1  geometry
516c470 阶段 1  document loader + errors
db84146 阶段 1  cache
d1ec0af 阶段 1  selection
7092e8b 阶段 1  search
b22b125 阶段 1  store
6386b20 阶段 2  hooks
5fd37fd 阶段 2  components
46d823f 阶段 2  demo 真实接入 + E2E
e4eaa7c 阶段 4  text-layer
b82941a 阶段 4  样张不入库
72eb1b6 阶段 4  三个面板
33d151a 阶段 4  链接层 + 密码框
809286f 阶段 5  发布基建
```

**遗留 / 可选**
- 阶段 3（主项目迁移）：按用户要求暂不进行；包已具备迁移所需能力
- AcroForm 表单填写：未实现（不在 P0/P1 范围）
- 印刷级分页（print CSS）：未实现（`onPrint` 走浏览器原生打印）

---

## 精准选区 + 四个 Bug 修复（2026-11-16）

这一轮做了两件事：
1. **调研** pdf.js 官方 `TextLayer` 的完整算法，把文本层改成与之等价
2. **同步实施** 用户报的 4 个 bug

### 调研：原 scholar-club 的做法为什么"笨重"

**关键发现**：原项目的**文本层**其实是成熟实现 —— 它用 `react-pdf`，
而 react-pdf 的 `TextLayer.tsx:196` 直接调用 **pdf.js 官方的 `pdfjs.TextLayer`**：

```tsx
const cancellable = new pdfjs.TextLayer(parameters);
cancellable.render().then(() => { ... });
```

**它的「选区计算」才是笨重的**（`utils/get-client-rects.ts`）：

```ts
for (const clientRect of clientRects) {
  for (const page of pages) {
    // ← 双重循环 O(rects × pages)
    if (clientRect.width < pageRect.width) {
      // ← 靠"比页窄"猜归属页
      // ... clientRect.top + page.node.scrollTop - pageRect.top
    }
  }
}
```

问题：
1. **双重循环** —— 选 500 页文档的一段话 = 几千次几何比较
2. **靠 `width < pageRect.width` 猜页** —— 选整页时 rect 等于页宽 → **被丢弃** → 选区丢失
3. **`scrollTop` 混算** + 另一处又手工加 `offsetTop` 补偿 → **两处坐标系打架**

**结论**：它不是"算法笨"，而是**自己重造了 pdf.js 已经做好的事**，还造得不准。

### 从 pdf.js 源码提取的算法（v4.8.69 / v5.5.207 / v6.1.200 三版一致）

| 关键点    | pdf.js 的做法                                           | 我之前的做法     | 差距          |
| --------- | ------------------------------------------------------- | ---------------- | ------------- |
| span 粒度 | 一个 text item 一个 span                                | 最初按行合并一个 | ❌            |
| 字号      | `hypot(tx[2], tx[3])`（复合矩阵）                       | `item.height`    | ⚠️            |
| top       | 基线 − **实测 ascent**                                  | 基线 − 字号      | ❌ 差 15~20%  |
| 宽度      | **不设 width**，用 `scaleX(pdfWidth / measureText宽度)` | 设固定 width     | ❌            |
| 单字符    | `shouldScaleText` 判断（x/y 缩放差 > 1.5 倍才缩放）     | 没判断           | ⚠️            |
| 哨兵      | `endOfContent` + `selectionchange` 重定位               | 无               | ❌ 选区会膨胀 |

**最关键的是 scaleX**：

```js
// pdf.js #layout()
const { width } = ctx.measureText(div.textContent);
transform = `scaleX(${(canvasWidth * this.#scale) / width})`;
```

PDF 内嵌字体 ≠ 浏览器系统字体 → 不拉伸的话文字总宽度对不上 → 越往右偏得越多。
scaleX 把**整个 span 的字形**按比例拉伸 → 每个字的位置都对得上。

### 实施

**新增 `src/core/text-layer/font-metrics.ts`**：

- `measureAscentRatio`（canvas `measureText('')` 拿 ascent/descent 比例，带缓存）
- `measureTextWidth`（canvas `measureText` 实测浏览器排版宽度，带缓存）
- `guessFontFamily`（按 fontName 猜系统字体；**几何精准不受字体影响**，scaleX 会补偿）

**`layout.ts`**：复合矩阵算法（`Util.transform(viewport, item)`）+ scaleX 计算
**`TextLayer.tsx`**：逐 item 渲染 + 应用 scaleX + `endOfContent` 哨兵 + `data-page-number`
**`useTextSelection.ts`**：归页改为**按 span 归属**（去掉双重循环）+ `selectionchange` 重定位
**CSS**：对齐 pdf.js（`text-align:initial` / `text-size-adjust:none` / `forced-color-adjust:none`）

### Bug 2：缩放比例 xx4% + 中心缩放

- **比例**：`fitWidth` = `(1391-32)/612 = 2.2205` → 222%。新增 `quantizeScale`（10% 步长），
  量化在 `setScale` 内部统一做 → **显示值 == 渲染几何 == 页尺寸计算**
- **位置**：`anchorY` 从 `clientHeight/2` 改为 **0**（左上角锚点）
  → 缩放时视口左上角内容不动 → "第一排文字高度不动"

### Bug 3：缩放后白屏（已复现）

```
初始:      页1 canvas=true(1390x1799) text=161项
放大3次后: 页1 canvas=false(0x0)     text=0项    ← 白屏
```

**根因 A**：`useVisiblePages` 用 IntersectionObserver，`rootMargin: '300% 0px'`
的百分比相对 **root（滚动容器）**算，不是相对元素 → 缩放后缓冲区从 3 页骤降到 1.2 页
**根因 B**：页占位元素 `top` 在缩放时全变 → IO 的 `isIntersecting` 不跨阈值
→ **IO 不重新触发** → `visiblePages` 停在旧值 → 新进入视口的页没渲染 → 白屏

**修复**：

- 新增 `core/virtualization/visible.ts`（`computeVisiblePages` 几何法，纯函数可单测）
- **去掉 IO** → scroll（rAF 节流）/ **scale** / resize 时重算；**scale 变化后立刻重算**（核心）
- 加"渲染过就保留"的白屏兜底（`pagesToRender`）

### Bug 4：搜索无高亮

搜索本身是通的（107 个结果），但**根本没有渲染命中的代码**：

- `SearchPanel` 只显示数量，`onNavigate` 只 `scrollToPage` 不高亮
- `SearchHit` 只有 `pageNumber/text/start/length`，**没有矩形几何**

**修复**：

- 新增 `core/search/highlight.ts`：`mapRangeToItems`（字符偏移 → 文本项，
  对齐 pdf.js 的 `_convertMatches` 思路）+ `hitToRects`（部分命中按比例裁剪宽度）
- `AnnotationLayer` 加 `searchRects` prop（橙色，与用户高亮分开）
- `SearchPanel` 加 `onHitsChange`；`Page` 加 `onTextItems`
- `scrollToSearchHit` 按命中 y 精确滚动（留 100px 余量）

### Bug 1：缩略图跟原文不一样

**实测结论出乎意料**：缩略图的**渲染几何是对的**
（内容边界比例与主页面一致：页2 11.7% vs 10.8%）→ 没有裁切、没有变形。

真实缺陷是另外 3 个：

- **1px 错位**：包用 `round`(155) 而宿主 canvas 用 `ceil`(156)
  → CSS 尺寸 ≠ 图片原始尺寸 → 配合 `object-fit:contain` + `border:1px` → **四周白边**
- **无 DPR 感知**：主页面 `canvas.width = w*min(DPR,2)`，缩略图直接 `w` → 高 DPI 屏糊
- **JPEG 0.7** 小尺寸块效应明显

**修复**：`thumbnailSpec` 统一用 `ceil`（且 width/height 就是宿主该用的画布尺寸）；
宿主按 DPR 渲染 + `context.setTransform(ratio,...)`；去掉 `object-fit:contain`，
border 改用 `box-shadow` 画在外侧。

### 实施中遇到的问题（全部记录）

1. **测试环境的 canvas stub 把 measureText 写死**：`measureText: (text) => ({ width: text.length * 6 })`
   —— 不随字号变化 → 所有字号测出同一宽度 → scaleX 失真
   - 修复：stub 记录 `font` 状态，按字号算宽度 + 提供 `fontBoundingBoxAscent/Descent`
2. **`layout.test.ts` 缺 jsdom 环境** → `measureTextWidth` 返回 0 → scaleX 恒为 1
   - 修复：加 `// @vitest-environment jsdom`
3. **单字符 scaleX 的测试期望写错了**：我以为"单字符不缩放"，
   但 pdf.js 的规则是"x/y 缩放差 > 1.5 倍才缩放"→ 普通单字符（x=字号,y=字号）也不缩放，
   而 `transform=[1,0,0,12]`（x≠y）**会**缩放 → 改测试用真实的 transform
4. **搜索高亮的单位不一致（真 bug）**：文本项是**视口 px**，而分母用了 **pt**
   → 高亮框高度离谱（121px，应为 22px）→ 改用视口尺寸
5. **回调引用不稳定（真 bug）**：`onHitsChange` 是内联箭头 → `SearchPanel` 的搜索 effect
   反复重跑 → `activeIndex` 被重置为 0 → **点"下一个"没反应**
   → 改用 `useCallback` 稳定引用
6. **初始化顺序（真 bug）**：`handleSearchNavigate` 用了还没初始化的 `scrollToSearchHit`
   → `Cannot access 'scrollToSearchHit' before initialization` → 整页白屏
   → 调整声明顺序
7. **页内下标算错（真 bug）**：一个命中可能产生**多个矩形**（跨 item / 跨行），
   不能简单数命中个数 → 改为按矩形数累加
8. **适配宽度的容差**：比例量化到 10% 后，页宽不可能精确等于容器宽
   → E2E 容差从固定 40px 改为**按比例 5%**
9. **副作用**：量化后"打开侧栏 → 容器变窄 → 适配宽度过时"
   → 加 ResizeObserver：容器宽度变化且**用户没手动缩放过**时重新适配
10. **demo dev server 缓存 dist**（老坑，第 N 次）：改完 `src/` 必须 `pnpm build`
    **并重启 demo**，否则 E2E 跑的是旧代码

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**289 passed**（23 个测试文件）
- E2E（真 Chromium，真实 PDF 18 页）：**8 套全过，合计 64 项断言**
  - smoke 13/13 · text-layer 7/7 · panels 12/12 · links 5/5
  - **selection-align 9/9**（scaleX 生效证明：浏览器排版 138.52px → 拉伸后 176.54px；
    选区起点 **Δ = 0.00px**）
  - **zoom 6/6**（比例整十 ×4 + **左上角锚点 Δ = 0.0px** + 无白屏）
  - **search-highlight 6/6**（107 结果 → 37 个高亮矩形；**高亮落在文字上距离 0px**）
  - **thumbnail 6/6**（CSS 120×156 == 图片 240×311 @DPR2 → 零错位）

### 关键文件

```
src/core/text-layer/font-metrics.ts    字体度量实测（ascent / 宽度）
src/core/text-layer/layout.ts           复合矩阵 + scaleX 算法
src/core/virtualization/visible.ts      几何法可见页计算（替掉 IO）
src/core/search/highlight.ts            字符偏移 → 矩形
src/components/TextLayer.tsx            逐 item 渲染 + scaleX + 哨兵
src/hooks/useTextSelection.ts           按 span 归页 + 哨兵重定位
src/hooks/useVisiblePages.ts             几何法 + 缩放重算
src/hooks/useZoom.ts                     量化 + 左上角锚点
```

### 遗留 / 可选

- 阶段 3（主项目迁移）：按用户要求暂不进行；包已具备迁移所需能力
- AcroForm 表单填写：未实现（不在 P0/P1 范围）
- 印刷级分页（print CSS）：未实现（`onPrint` 走浏览器原生打印）
- `endOfContent` 的 Chrome 专属 `selectionchange` 重定位已实现，
  但 Firefox 的 `-moz-user-select: none` 路径未特判（Firefox 行为已正常）

---

## 高亮效果重做（2026-11-16 下午）

用户报了两个问题：**高亮错位严重** + **高亮挡住文字**，
另外截图显示**选区有阶梯状深浅不一**。这一轮全部修掉。

### 问题 1：高亮错位 —— 双重缩放

**实测**（真实 PDF，230%）：

```
选区实际在:   top=58px
高亮渲染在:   146.104 × 2.3 = 336px     ← 偏了 278px
```

`AnnotationLayer.tsx:160` 的 `transform: scale(${scale})` ——
而 `rect.left/top/width/height` **已经是从归一化坐标换算出来的视口 px**
（`norm.x1 * viewport.width / norm.width`）→ **不需要再乘一次 scale**。

> **为什么会写成这样**：早期 `rect` 是"参考尺寸下的 px"，需要 `scale()` 拉伸；
> 后来改成"直接乘比例"，`transform` 忘了删 → 两套缩放机制并存。
> 搜索高亮（`AnnotationLayer.tsx:133`）有同款 bug。

**修复**：删掉两处 `transform: scale()`。

### 问题 2：选区坐标双重扣减（新发现）

修完双重缩放后，高亮**水平对齐了**（Δ 0.3px），但**垂直还差 97px**。

**排查过程**：

1. 选区 rect 是**视口坐标**（`getClientRects()`）
2. `pageFrames` 的 `top` 是**滚动内容坐标**（`pageTops[]`）
3. 代码把两者都减了 `containerRect.top` → **减了两次**

```ts
// ❌ 改前
const frames = pageFrames.map(f => ({ ...f, top: f.top - containerRect.top, ... }));
const rects  = clientRects.map(r => ({ top: r.top - containerRect.top, ... }));
//    ↑ containerRect.top 被减了两次 → 正好差 97px（容器的视口 top）

// ✅ 改后：统一换算到"容器内容坐标"
const toContentCoords = (v: number) => v - containerRect.top + container.scrollTop;
```

**修复后实测**：6 个高亮块与选区 rect **逐行 Δ = 0.0px**。

### 问题 3：阶梯状深浅不一（选区叠涂）

**实测**（选 10 行）：

```
浏览器返回 26 个 rect，实际只有 10 个视觉行
每行 rect 数: {1个: 2行, 2个: 4行, 4个: 4行}
中心被涂次数: {涂1次: 2行, 涂2次: 8行}   ← 8/10 行被叠涂!
```

**根因**：一行里有两个**不同字号**的 span（正文 22.9px + 上标 17.4px），
它们**各自形成一个行盒** → `getClientRects()` 返回多个**垂直重叠 27px** 的 rect
→ `::selection` 背景被**逐个 rect 绘制** → 重叠区涂两次
→ `28%` 的蓝叠两次 ≈ `48%` → **阶梯状深浅不一**。

**排除 scaleX**：单独测一个 span（只有 scaleX）→ `getClientRects()` 只返回 **1 个** rect。

**修复（一行 CSS，已实测验证）**：

```css
.scpdf-text-layer__item {
  line-height: 0;
}
```

|      | 中心被涂次数                    |
| ---- | ------------------------------- |
| 改前 | {涂1次: 2行, **涂2次: 8行**} ❌ |
| 改后 | **{涂1次: 10行}** ✅            |

**为什么有效**：行盒高度 = `font-size × line-height` → 归零 → 同行不同字号不再产生独立行盒。
**为什么不影响位置**：span 是 `position: absolute`，`top` 定位**不依赖行盒**。

**试过但没用的方案**：

| 方案                                   | 结果                                |
| -------------------------------------- | ----------------------------------- |
| `line-height: normal` / `1`            | maxPaint = 2 ❌（问题回来了）       |
| `line-height: 0` + `padding-top: 20px` | maxPaint = 2 ❌（padding 又撑出盒） |
| `line-height: 0.001`                   | maxPaint = 1 ✅ 但高度只有 0.016px  |

> **pdf.js v6 自己也有这个问题** —— 它靠 `.selectionRendering` 模式绕开
> （关掉原生 `::selection`，改用 SVG clipPath 画 `rgb(0 90 255 / 0.22)` 覆盖层）。
> 我们用 `line-height: 0` 更简单，代价是 span 盒子高度为 0
> → Playwright 的 `waitForSelector`（要求"可见"）会超时 → E2E 改用 `waitForFunction`。

### 问题 4：高亮遮挡文字 → `mix-blend-mode: multiply`

高亮层在 DOM 里排在 `<canvas>` **之后**，而背景 `#fff3bf` **不透明** → 完全遮住字。

**解法**（原 scholar-club 也是这么做的，`PageCom/style.ts:21`）：

```css
.scpdf-annotation {
  mix-blend-mode: multiply;
}
```

**原理**：正片叠底 = 颜色相乘

- 底下的**黑字** × 高亮色 = **黑** → 字完全清晰
- 底下的**白纸** × 高亮色 = 高亮色 → 荧光笔效果

**为什么不动 DOM 顺序**：高亮要能点（`onHighlightClick`）→ 放 canvas 下面会被挡住。
`multiply` 不改顺序 → **不影响点击**。

`::selection` 同理：

```css
.scpdf-text-layer ::selection {
  background: var(--scpdf-selection-color, rgba(13, 104, 189, 0.24));
  mix-blend-mode: multiply;
}
```

（不含 multiply 时：半透明蓝直接盖在 canvas 的黑字上 → 蓝 + 黑 = 灰蓝 → 字发虚）

### 问题 5：颜色可配置（用户需求）

**包的边界**：包**只负责把颜色渲染出来**（纯视觉）；
取色器 UI、语义含义、持久化 → **全部归宿主**。

**两条通道**：

1. **`::selection` 颜色** → CSS 变量（伪元素里 CSS 变量可用）

   ```css
   --scpdf-selection-color: rgba(13, 104, 189, 0.24);
   ```

2. **高亮颜色** → `highlightPalette` prop（语义 key → CSS 颜色）

   ```tsx
   <PdfViewer highlightPalette={{ yellow: '#ffd54a', 'h-123': '#ff6b6b' }} />
   ```

   → 高亮记录存 `color: 'h-123'`（**语义 key，不是颜色值**）→ 换色板不用改数据

**新增** `src/core/highlight/palette.ts`：

- `HighlightPalette` 类型
- `DEFAULT_HIGHLIGHT_PALETTE`（内置 6 色）
- `resolveHighlightColor` / `paletteToCssVars`

**demo 侧**（`demo/src/HighlightPicker.tsx`，**宿主 UI，不在包里**）：
6 个预设色 + 原生取色器 + "用此色"保存自定义色 → 全部走 `highlightPalette` 通道。

### 附带修的

- `reference` 硬编码 `595 * scale`（A4）→ 改用该页**真实视口尺寸**
  （真实 PDF 是 Letter 612×792 → 参考尺寸错 → 读回时换算比例错）
- 高亮圆角 `2px` → `4px`（对齐 pdf.js 的 `.textLayer .highlight`）

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**303 passed**（24 个测试文件）
  - 新增 `palette.test.ts`（11 例）
  - `AnnotationLayer.test.tsx` 新增 5 例（**无 transform: scale** / 色板生效 / CSS 变量）
- E2E：**9 套 73 项断言全通过**（新增 `e2e-highlight.mjs` 9/9）
  - **高亮与被选文字逐行对齐：最大偏差 0.0px**
  - **选区每处只涂一次：最大叠涂次数 = 1**
  - 高亮用 `multiply` / 圆角 4px / 无 `transform: scale`
  - 高亮块可点击（`elementFromPoint` 命中高亮本身）
  - 回归：选区精准度 9/9（**Δ = 0.00px** 不回归）

### 关键文件

```
src/core/highlight/palette.ts       色板类型 + 默认色 + 工具函数
src/hooks/useTextSelection.ts       修坐标双重扣减
src/components/AnnotationLayer.tsx  删 transform: scale + 应用色板
src/styles/viewer.css               multiply / line-height:0 / CSS 变量
demo/src/HighlightPicker.tsx        宿主的取色器 UI（不在包里）
scripts/e2e-highlight.mjs           高亮效果 E2E（9 项）
```

---

## 第四轮：高亮黑框 / 选区叠涂换方案 / 缩放崩溃 / 选区浮层（2026-11-16 下午）

用户报了 4 个问题。排查后发现**其中两个是上一轮"修复"引入的**。

### 问题 1：高亮有黑框 + 缩放下定位不对

**实测：几何完全是对的**

```
选区: { l: 457.7, t: 328.9, w: 252,  h: 44 }
高亮: { l: 457.7, t: 328.9, w: 252,  h: 44 }
Δleft = Δtop = Δw = Δh = 0.0
```

缩放后也正确（230% → 250%，高亮宽 252 → 273.9 = ×1.088）。

**错的是渲染** —— 高亮是 `<button>`，但 **CSS 从来没 reset 浏览器默认样式**：

```js
{ tagName: "BUTTON",
  border: "2px outset rgb(0, 0, 0)",   // ← 黑框
  padding: "1px 6px",
  boxSizing: "border-box" }            // ← 内容区被 border 吃掉
```

- `border: 2px outset` → **可见黑框**
- `box-sizing: border-box` → 可见区域比几何框小 2px → **看起来没对齐**

**修**：reset button 样式 + **`box-sizing: content-box`**（让 width/height 就是全部可见区域）。

### 问题 2：选区叠涂仍在 + 框选多选一点 —— **上一轮的修法是治标**

**关键实测**（发现 `line-height: 0` 是一对问题的其中一半）：

| line-height       | 选区 top 相对 span top     | 选区高度 | 叠涂次数 |
| ----------------- | -------------------------- | -------- | -------- |
| **`0`（上一轮）** | **−21.9px**（上偏 22px）❌ | 44px     | **1** ✅ |
| **`normal`**      | **+0.1px**（完美）✅       | 44px     | **2** ❌ |
| `1`               | −5.9px                     | 44px     | 2 ❌     |
| `1.15`            | −3.9px                     | 44px     | 2 ❌     |

选区框高 **44px** 而字号只有 **16.1px** → 框粗 2.7 倍 → 就是"上下多框选一点"。

**原因**：`line-height: 0` 让行盒归零 → 浏览器 fallback 到**默认行盒**画选区矩形
→ 叠涂"少"了，但框歪了。**它只是把行盒压扁，没真正解决。**

**正解：pdf.js v6 的 `selectionRendering` 模式**

1. 关掉原生 `::selection` 的背景
2. `getClientRects()` 拿原始形状 → 合并同行重叠矩形
3. 画成 SVG `<clipPath>` → **每个像素只画一次**

**已实测验证**：手工注入后选区均匀、贴合文字、无阶梯 ✅

**新增** `src/core/selection/shape.ts`（`buildSelectionShapes` + `mergeOverlappingRects`）
**新增** `src/components/SelectionLayer.tsx`（SVG clipPath 覆盖层）

**踩到的坑**：SVG **绝对不能设 viewBox**！
`viewBox="0 0 100 100"` + `preserveAspectRatio="none"` 会把用户坐标从 100×100
拉伸到页面真实像素 → clipPath（`userSpaceOnUse`）的 `x=449` 被放大成 `449×(1408/100)=6324`
→ 形状跑到页面外 → **选区完全看不见**（截图确认）。
→ 修：**不设 viewBox** → SVG 用户坐标 = CSS 像素。

### 问题 3：缩放时页面消失（NotFoundError）

**复现了完全一样的报错**：

```
NotFoundError: Failed to execute 'insertBefore' on 'Node':
The node before which the new node is to be inserted is not a child of this node.
```

**两个根因**（实测定位）：

1. `insertBefore(newNode, referenceNode)` 要求 `referenceNode` 是 `newNode.parentElement` 的子节点。
   缩放时 React 重建所有 span（key 含位置 → 全变）→ `endContainer.nextSibling` 可能属**别的 parent** → 抛错。
2. **跨页选择时哨兵被搬到另一页**（实测 `endStillInL1: false`）
   → 第 1 页哨兵丢失、第 2 页多一个 → 哨兵失去意义。

**异常在 `selectionchange` 里未捕获** → React 错误边界 unmount 整棵树 → **页面消失**。

**修**：
- `contains()` 校验引用节点同父（不满足 → 降级 `appendChild`）
- 跨页时**不动**哨兵（每页各有自己的）
- 哨兵加**固定 key**（React 重渲染不再错位）

**新增** `scripts/e2e-selection-stability.mjs`：6/6

### 问题 4：选区浮层（scholar-club 那种）

**调研了原项目**（`TextSelectionPopover` + `useTextSelection`），确认它的毛病：

| 它的问题                         | 实测                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| 坐标系错                         | `getClientRects()`（视口）+ `window.scrollY` → 当文档坐标用 |
| 不跟随内部滚动                   | 项目**自己的缺陷 B2** 就记着这事                            |
| 假翻转                           | 永远在下方，"翻转"只是 `popoverY -= 50`                     |
| 魔法数字                         | 宽度猜 `200`（实际 350-400）、高度猜 `50`                   |
| 位置不更新                       | 只在 mouseup 算一次，缩放/滚动都不重算                      |
| 无 Esc / 无 selectionchange 关闭 | —                                                           |
| 死代码                           | `document.createElement('div')` 后直接丢弃                  |
| 动作硬编码                       | 每个按钮一个闭包，没有配置数组                              |

**我们的实现**：

- **定位**：`position: fixed` + 视口坐标 → **不需要 scroll 换算** → 天然不漂移
  - **实测弹层尺寸**（不猜）+ **真翻转**（先下方再上方）+ clamp 到容器
- **动作注册表**（可注入）：宿主传 `selectionActions` 覆盖/追加
  内置：🖍高亮(带色板) · 📋复制 · 🌐翻译 · 💬提问 · 📝笔记 · 🗑删除
  **宿主不传 `onTranslate` → 按钮不显示** ✅
- **内置图标 7 个**（纯 SVG，零依赖）
- **统一色板下拉**：6 预设色（原项目新高亮/编辑高亮用了**两套 UI**）
- **关闭**：mousedown 外部 · Esc · 选区清空 · 滚动/缩放（隐藏）

**踩到的坑**：

1. **`react-dom` 不是依赖**：包只 peer-dep `react` → 不能用 `createPortal`
   → 改用 `position: fixed` 内联渲染（祖先链无 transform/filter/contain → 等价于挂 body）
2. **鸡生蛋死锁**：位置没算出来 → 返回 `null` → 元素没渲染 → 量不到尺寸 → 永远算不出位置
   → 修：**第一帧先渲染**（`visibility: hidden`），量到后再算位置
3. **biome `noSvgWithoutTitle`**：要求每个 svg 有**字面量**的 `<title>`（变量不认）

**新增** `src/core/selection/popover-position.ts`（纯函数定位，可单测）
**新增** `src/core/selection/actions.ts`（动作类型 + 合并逻辑）
**新增** `src/components/SelectionPopover.tsx` + `SelectionActionIcons.tsx`

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**333 passed**（27 个测试文件）
  - 新增 `popover-position.test.ts`（10）+ `actions.test.ts`（5）
- E2E：**11 套 96 项断言全通过**
  - `e2e-selection-popover.mjs` **15/15**（定位/居中/clamp/真翻转/Esc/点外部/滚动隐藏/色板/选色触发高亮）
  - `e2e-selection-stability.mjs` **6/6**
  - `e2e-highlight.mjs` **11/11**（改写断言：原生背景已关 + 自绘层生效）

### 关键文件

```
src/core/selection/shape.ts            选区形状（归页 + 合并重叠）
src/core/selection/popover-position.ts  浮层定位（纯函数）
src/core/selection/actions.ts          动作注册表
src/components/SelectionLayer.tsx      SVG clipPath 自绘选区
src/components/SelectionPopover.tsx    选区浮层
src/components/SelectionActionIcons.tsx 内置图标
```

---

## 第八轮：选区"大长方形" / 高亮叠加 / 选区残留（2026-11-17 上午）

用户反馈：**选区画成了一个大长方形**，问是不是我画错了。

> 先说结论：**不是画歪了，是**合并算法**被一个异常矩形污染了**。

### 问题 1：选区变成"大长方形"

#### 实测定位

真实 PDF（arXiv 论文，230%）跨 3 行选择，自绘层输出了 **75 个矩形**，
其中有：

```
l=88  t=-460  w=56  h=829     ← 整页高！
l=88  t=-460  w=42  h=829
```

顺着查 DOM，找到了这个矩形的来源：

```js
{
  txt: "arXiv:2608.07346v4 [cs.AI] 7 S",
  transform: "scaleX(0.922172) rotate(-90deg)",   // ← 竖排的页边戳
  rect: { l: 95, t: -460, w: 42, h: 829 }
}
```

**浏览器对旋转文字给出的选区矩形是整页高（829px）**。

#### 为什么会变成"大长方形"

旧合并算法只跟 `merged[merged.length - 1]` 比：

```ts
if (overlapY > 0 && overlapX > 0) {
  // 合并 → 高度取并集
}
```

这个 829px 的巨型矩形一旦和别的小矩形**垂直重叠** → 合并后的矩形**长高**
→ 继续吸收更多 → **画出一大块**（图里的 20 多个元素全被涂成蓝块）。

截图确认（修复前）：整块蓝色盖住了正文 3 行 + 下面的整张插图。

#### 修法（三步）

1. **先剔除异常矩形**：`height > 最小高度 × 4` → 丢掉
   （⚠️ 必须用**最小高度**当基准，用中位数会在矩形很少时失效）
2. **按"视觉行"分组**（垂直中心相近 → 同一行），不再跨行乱合并
3. **组内按 x 排序逐段合并**，**只合并水平有重叠的**
   → 同行里不相邻的片段保持分开（不涂到中间的空白）

结果：**75 个矩形 → 14 个**，正文 3 行变成 3 条独立的细条。

### 问题 2：高亮完成后 `::selection` 没去掉 / 高亮区域叠加

#### 实测

```
选中后:   { layers: 1, rects: 1 }
取消后:   { layers: 1, rects: 1 }   ← ❌ 旧选区还在
高亮后:   { selText: "Shangha", layers: 1 }  ← ❌ 蓝色选区叠在高亮上
```

#### 根因

`setSelectionShapes` **只设不清** —— `onSelectionChange(null)` 时没清 shape。

#### 修法

- 选区清空 → `setSelectionShapes(new Map())`
- 高亮后 → 清 shape + 关浮层

### 问题 3：⚠️ **不能调 `removeAllRanges()`**（踩坑记录）

第一版修法里，高亮后调了 `window.getSelection().removeAllRanges()`，
结果**用户再也选不了字**：

```
mousedown ✅  mouseup ✅  selectionchange ❌ (0 个)
```

**实测对照**：

| 做法                       | 之后还能选吗 |
| -------------------------- | ------------ |
| 同步调 `removeAllRanges()` | ❌ 选不中    |
| `setTimeout(0)` 延后调     | ❌ 选不中    |
| 从 `page.evaluate` 调      | ✅ 正常      |
| **完全不调**               | ✅ 正常      |

→ 在**点击浮层按钮的同步流程里**调 `removeAllRanges()`，
浏览器会认为"选区正在被改" → **后续拖动被浏览器吞掉**。

**而且根本不需要调**：
- 原生 `::selection` 的背景本来就是 `transparent` → 看不见
- 可见的蓝色块是**自绘层** → 清掉 shape 就没了

### 问题 4：宿主反馈被冲掉

`clearSelection()` 会发 `onSelectionChange(null)` → demo 的提示被重置成空
→ 用户刚点的"已高亮（pink）"没了。

**修**：新增 `clearState()` —— 只清包内部状态，**不通知宿主**。

### ⚠️ 重要：**我之前的性能测量是错的**

之前几轮 DEVLOG 里写"拖动 17.1ms/步，比无哨兵慢 7 倍"——

**这个测量方法有问题**。用的是 CDP `Input.dispatchMouseEvent`，
每次派发都有 **~17ms 的 RPC 往返**。

改用**页面内直接派发原生 MouseEvent** 后：

```
全部功能开启:  0.009 ms/步
移除哨兵:      0.005 ms/步
空白区域基线:  0.004 ms/步
```

→ 包里的选区处理**每步只花 0.009ms**（一帧预算是 16ms → **完全不是瓶颈**）。
所谓"卡"是**冷启动**（第一次拖动 17ms，之后 0.6ms）+ 测试工具的开销。

**教训**：性能测量必须排除工具开销，否则结论完全错。

（哨兵改 CSS 变量驱动 + 尺寸改 0 仍然保留 —— 它确实更稳，也顺手修了 `NotFoundError` 的隐患。）

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**337 passed**（新增 4 个回归测试）
- E2E：**12 套 106 项断言全通过**（新增 `e2e-selection-shape.mjs` 10 项）
- 视觉确认：大长方形消失；正文 3 行 = 3 条独立细条；高亮后无蓝色叠加

### 关键文件

```
src/core/selection/shape.ts       合并算法（剔除异常 + 视觉行分组 + 逐段合并）
src/hooks/useTextSelection.ts      哨兵改 CSS 变量驱动 + clearState
src/components/PdfViewer.tsx       选区清空时清 shape + 高亮后清理
scripts/e2e-selection-shape.mjs    选区形状 + 高亮清理 E2E（10 项）
```

---

## 第九轮：选区/高亮与文字对齐 + 浮层延迟（2026-11-17 上午）

用户反馈：**要和 `scpdf-text-layer__item` 对齐**、**现在特别卡**、**定位不准**。

> 先查了 pdf.js v6 的源码（`pdf.mjs` + `pdf_viewer.mjs` + `pdf_viewer.css`），
> 对比出 3 个关键差异。

### 问题 1：选区/高亮比文字高 11px、偏上 6px

#### 实测（真实 PDF，230%）

|                  | 值                        |
| ---------------- | ------------------------- |
| 浏览器选区矩形   | `y=231.92, h=44`          |
| 文字本身（span） | `y=237.92, h=33`          |
| **偏差**         | **偏上 6px，框高多 11px** |

#### 根因

浏览器的选区矩形 = **字体的自然行盒**（ascent + descent + lineGap），
而 span 的 box = `fontSize × line-height`。

**CSS 改不动它**（实测 7 种全无效）：

| 尝试                               | 选区高                    |
| ---------------------------------- | ------------------------- |
| `line-height: 1` / `0.9` / `0.62`  | 44 / 44 / 30px            |
| `height: 1em` + `overflow: hidden` | 44px                      |
| `display: inline` / `inline-block` | 44px                      |
| `transform: scaleY(0.65)`          | 20px ✅ 但**字被压扁** ❌ |

#### pdf.js v6 怎么做的

pdf.js v6 的 `DrawLayer` **也用 `range.getClientRects()`**（`pdf.mjs:4228`），
关键在 CSS：

```css
.textLayer {
  line-height: 1;
}
.textLayer :is(span, br) {
  position: absolute;
  white-space: pre;
  transform-origin: 0% 0%;
}
```

→ span 的行盒 = `fontSize` → **浏览器行盒和 span 的 box 对齐了**。

**本包也设了 `line-height: 1`，但没用** ——
因为 span 的 `top` = `基线 − ascent`（pdf.js 也一样），
浏览器的行盒从 top 往下 `fontSize` 高，
其**基线位置** = `top + 浏览器字体的 ascent'`（≠ 我们实测的 ascent）→ 差 6px。

#### 修法：**用文本项的基线裁剪**

```
水平：保留 getClientRects() 的 left/width（浏览器知道字距/kerning/连字）
垂直：用文本项的基线 + 字形的 ascent/descent 自己算
```

**实测效果**：

|                   | 之前             | 之后                     |
| ----------------- | ---------------- | ------------------------ |
| 选区 rect         | `y=231.92, h=44` | **`y=237.92, h=32.996`** |
| 与文字的 Δtop     | 6px              | **0.002px** ✅           |
| 与墨迹的 Δtop     | 10px             | **4px** ✅               |
| 与墨迹的 Δbottom  | 12px             | **7px** ✅               |
| 高亮 vs 文字 Δtop | 10px             | **0.0px** ✅             |

**新增** `src/core/selection/item-geometry.ts` + `clipToBaseline()`。

### 问题 2：transform 顺序反了

pdf.js v6：`transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))`
本包（旧）：`transform: scaleX(...) rotate(...)`

→ 反过来会**先横向拉伸再旋转**，对旋转文字（角度 ≠ 0）结果完全不同。
→ **已改成 `rotate() scaleX()`**（与 pdf.js 一致）。

### 问题 3：浮层延迟（27-33ms）

#### 实测（精确到 DOM 出现）

```
mouseup → 浮层 DOM 出现: 27.2ms
```

CPU profile：**86.7% idle** → 不是 JS 忙，是**渲染/合成**。

#### 根因：浮层要**两帧渲染**

1. 第一帧：渲染出来 → `getBoundingClientRect()` 量尺寸
2. 第二帧：算出位置 → 定位到正确的地方

#### 修法：**预先算尺寸**

弹层尺寸只跟**动作数量**有关（按钮固定 28px 宽）→ 可以预估：

```
width  = 4*2 + 1*2 + 按钮数*28 + 分裂按钮*16 + 2*(按钮数-1)
height = 4*2 + 1*2 + 28
```

→ **只渲染一帧**（`measured ?? estimatedSize`）。

**实测**：27-33ms → **21-25ms**。

### ⚠️ 又一次测量教训

这轮一开始我用 `waitForFunction` 测延迟，得到 **130-150ms** ——
那是 `waitForFunction` 的**轮询量化**（rAF / 100ms 间隔），不是真实延迟。

改用 **MutationObserver 打时间戳** → 真实值 **27ms**。

**教训**：测延迟要用 MutationObserver / PerformanceObserver 打点，
不能用 `waitForFunction`（它测的是"轮询发现"的时间）。

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**344 passed**（新增 `baseline.test.ts` 7 项）
- E2E：**12 套 106 项断言全通过**
  - `e2e-highlight.mjs` 的对齐断言改成**以文字本身为基准**
    （旧断言拿"浏览器选区矩形"当基准 = 认可了错的）
- 视觉确认：选区框紧贴文字；高亮块上边缘与文字完全对齐

### 关键文件

```
src/core/selection/item-geometry.ts  按文本项几何算选区（基线裁剪）
src/core/selection/shape.ts          clipToBaseline + 基线表类型
src/core/selection/extract.ts        高亮几何也走基线裁剪
src/hooks/useTextSelection.ts        接收 baselines
src/components/PdfViewer.tsx         baselinesByPage（useMemo）
src/components/SelectionPopover.tsx  预估尺寸 → 单帧渲染
src/components/TextLayer.tsx         transform 顺序改成 rotate() scaleX()
```

---

## 第十轮：选区跨行失效 + 链接吞掉拖选（2026-11-17 中午）

用户反馈（附 3 张截图）：**框选后是一大块**，缩放后定位跑偏，特别卡，一个都没解决。

这一轮挖出了 **4 个独立的根因**，每个都单独修。

---

### 根因 1：跨行拖选 → **自绘层完全没有数据**（用户看到的"那一大块"）

#### 实测

```
自绘层矩形数 = 0     ← 完全空！
浏览器 rect 数 = 255
```

用户看到的那一大块，是**浏览器原生 `::selection`**（因为自绘层没数据，
而原生背景只是"透明"不是"没有"）。

#### 根因

`useTextSelection` 里有一道校验：

```ts
const anchorElement = range.commonAncestorContainer instanceof Element ? ... ;
if (!anchorElement?.closest(TEXT_LAYER_CLASS)) {
  clearSelection();   // ← 直接放弃！
  return;
}
```

**跨行拖选时，`range.commonAncestorContainer` 是 `.scpdf-page`，不是 `.scpdf-text-layer`！**

```
ancClass: "scpdf-page"
ancInTextLayer: false     ← 校验失败 → 直接放弃
```

→ `onClientRects` 从没被调用 → 自绘层空 → 用户看到原生选区（那一大块）。

#### 修法

只要祖先里有**文本层或页面**就算合法（选到别的东西才拒绝）。

```ts
const inTextLayer = !!anchorElement.closest(TEXT_LAYER_CLASS);
const inPage = !!anchorElement.closest(PAGE_CLASS);
if (!inTextLayer && !inPage) { clearSelection(); return; }
```

---

### 根因 2：`height=0` 的矩形 → **合并算法把全部矩形判为异常**

#### 实测

```
rawCount: 255, minHeight: 0, limit: 0, normalCount: 1
```

浏览器偶尔会返回 **height=0 的矩形**（空白的行盒）。
而合并算法的"异常判据"用 `minHeight * 4` 当阈值 → 阈值 = 0
→ **254 个正常矩形全被判为异常** → 选区消失。

#### 修法

1. 先剔除 `height <= 0` / `width <= 0` 的退化矩形
2. 基准改成**截尾中位数**（trimmed median）

```ts
export function trimmedMedian(sorted: readonly number[]): number {
  if (sorted.length <= 1) return sorted[0] ?? 0;
  if (sorted.length < 4) return sorted[0] ?? 0; // 少数几个 → 丢掉最高的
  const trim = Math.floor(sorted.length / 4);
  const trimmed = sorted.slice(trim, sorted.length - trim);
  return trimmed[Math.floor(trimmed.length / 2)] ?? 0;
}
```

为什么不用普通中位数：矩形**很少**时（2-3 个）中位数会被巨型矩形本身占据。
为什么不用平均数：平均数会被离群值拉偏。

---

### 根因 3：字形框用了**字体的自然行盒**，不是 **span 的盒子**

#### 实测

```
fontSize               = 20.62px   ← span 的 font-size
fontBoundingBoxAscent  = 22px      ← 字体的自然上伸（比 fontSize 大！）
fontBoundingBoxDescent = 5px       ← 字体的自然下伸
自然行盒                = 27px      ← 浏览器用它画选区矩形
span 的实际盒子          = 20.62px  ← font-size × line-height(1)
```

→ 用"基线 + ascent/descent"推算会偏 4px、高 27px。

#### 修法

**字形框 = span 的盒子**：`top = item.top`，`height = item.fontSize`。

实测 `item.top` 与渲染后的 `span.getBoundingClientRect().top` **完全相等** ✅

另外，选行时不能只取"最近的一行"：

```
选区矩形   y=452.8 h=27      (452.8..479.8)
上标 "*"   y=451.7 h=16      (451.7..467.7)  ← 基线更近，但盒子在选区上方
正文       y=456.8 h=20.6    (456.8..477.4)  ← 才是正确的行
```

→ 改成：**按距离过滤 → 按"盒子中心离矩形中心"排序 → 依次尝试，
第一个"盒子完全落在矩形内"的胜出**。

---

### 根因 4：**链接吞掉拖选**（缩放后才暴露）

#### 实测

```
初始    [DBG] mouseup target= scpdf-link     ← 选区出不来
放大后  （没有 mouseup 日志）                 ← 完全没选区
```

`.scpdf-link { pointer-events: auto }` → 链接矩形**接管鼠标事件**
→ 浏览器的拖动被当成"拖拽链接" → 文本层收不到选区。

摘要里正好有个 GitHub 链接（`https://github.com/datamillab/A2E`）在正文中间。
缩放后正文位置变了，拖选刚好落在链接上 → 选区彻底不出来。

#### 修法（跟 pdf.js v6 一致）

pdf.js 的 `.annotationLayer { pointer-events: none }` —— 链接层**不接管鼠标事件**。

本包：

1. `.scpdf-links` / `.scpdf-link` 都改成 `pointer-events: none`
2. 链接从 `<a>` 改成 `<span role="link" tabIndex={0}>`（`<a>` 会吞拖动）
3. 点击走**容器上的事件委托** + **按坐标命中**（`elementFromPoint` 也不行，
   它同样跳过 `pointer-events: none` 的元素）

```ts
const findLinkAtPoint = (clientX: number, clientY: number) => {
  for (const link of document.querySelectorAll<HTMLElement>('.scpdf-link')) {
    const rect = link.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    )
      return link;
  }
  return null;
};
```

→ 现在**既能点链接，又能从链接上拖选**（E2E 两条都验证）。

---

### 附带修的：缩放后基线表**没更新**

`handleTextItems` 原来用"数量相同 → 不更新"当优化：

```ts
if (existing && existing.length === items.length) return prev;   // ← 错！
```

缩放时 item **数量不变**但**几何全变** → 基线表停留在旧缩放级别
→ 选区裁剪用错基线 → **缩放后定位跑偏**（用户的原话）。

→ 改成比**几何指纹**（第 1 / 中间 / 最后三个 item 的 left/top/fontSize/text）。

---

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**349 passed**（新增 `baseline.test.ts` 9 项 + `shape.test.ts` 2 项）
- E2E：**13 套 118 项断言全通过**（新增 `e2e-selection-regression.mjs` 9 项）
- **选区与文字的对齐：Δtop = 0.01px，高度比 = 1.0**（fit / 放大 / 缩小 全一致）
- 视觉：fit 和放大两种状态下，选区块都**紧贴文字**

### 关键文件

```
src/hooks/useTextSelection.ts        允许 page 祖先 + 剔除退化矩形
src/core/selection/shape.ts          trimmedMedian + 按盒子中心排序 + 依次尝试
src/core/selection/baseline.test.ts  新增（9 项）
src/components/PdfViewer.tsx         基线表用 span 盒子 + 链接点击委托
src/components/LinkLayer.tsx         <a> → <span role="link">
src/styles/viewer.css                链接层 pointer-events: none
scripts/e2e-selection-regression.mjs 新增（跨行选区回归，9 项）
```

---

## 第十轮：浮层锚定 + 缩放保持选区 + 拖动中即出现 + 性能（2026-11-17 下午）

用户反馈（第九轮）：
- "缩放的时候浮层没跟着一起缩放"
- "缩小之后选择跑偏很厉害"
- "很卡特别特别卡" / "我需要鼠标开始框选之后立刻出现浮层"
- 滚动行为：**方案 A 跟随滚动**

---

### 上一轮先做的：把 bug 变成红色的测试

新增 `scripts/e2e-popover-anchor.mjs`（8 项断言），
断言的是**浮层与选区的间距**（而不是坐标）——间距在缩放/滚动前后应该一致。

初始结果 **4/8**（故意是红的）：

```
PASS 选中后浮层出现
PASS 浮层锚定在选区下方 - 间距 8px
FAIL **缩放后浮层仍锚定在选区上** - 间距 nullpx（基准 8px）
FAIL **缩小后浮层仍锚定在选区上** - 间距 nullpx（基准 8px）
FAIL **滚动时浮层跟随**（不消失、不跑偏） - 间距 nullpx → nullpx，浮层消失
FAIL **拖动中浮层已出现**（不用等松手） - 已选 4 字符
PASS **拖动中选区块已出现** - 3 个
```

> **之前的 E2E 全部只断言几何**（选区块位置对不对），
> **从没有断言过"浮层在不在、跟不跟得上"** —— 而用户抱怨的正是后者。

---

### 根因 1：浮层锚点是"存下来的坐标"

```ts
// PdfViewer.tsx（旧的）
const rect = domSelection.getRangeAt(0).getBoundingClientRect();
setPopoverAnchor({ left: rect.left, top: rect.top, ... });   // ← 算一次就再也不动
```

`position: fixed` 的坐标会随**滚动 / 缩放 / 容器尺寸变化**失效
→ 浮层跑到别处（实测偏 130px）。

**修法**：锚点**每次布局都从 DOM 选区现算**（`readLiveAnchor()`），
触发源：滚动（capture）/ resize / 100ms 校正定时器 / 宿主版本号。

---

### 根因 2：缩放会**静默销毁**浏览器选区

实测：

```
缩放前: selection = { len: 199, collapsed: false }
缩放后: selection = { len: 0,   collapsed: true  }
缩放期间 selectionchange 事件: []      ← 根本不触发！
```

原因：缩放 → 文本层**重渲染**（span 全被替换）→ 浏览器选区锚定的 DOM 节点没了
→ 浏览器**静默**清空选区（**不触发 `selectionchange`**）→ 浮层被关闭。

**修法**：新增 `useSelectionPreservation`：
1. 缩放**前**记住选区（用**字符偏移**，与缩放无关）
2. 缩放**后**按字符偏移**恢复**

### 三个踩过的坑（都是实测逼出来的）

**① 恢复太早** → 文本层还在分批重渲染 → 恢复完又被干掉：

```
100ms: len=199  ← 恢复了（此时文本层还是旧的）
200ms: len=0    ← 文本层重渲染 → 又被销毁了
```

→ 改成**持续重试**（每帧检查，掉了就再恢复），连续 10 帧稳定才收工。

**② "保存" effect 永远不执行**：
React effect 按声明顺序执行 → "恢复"effect 先跑并更新了 `lastScaleRef.current`
→ "保存"effect 再跑时 `lastScaleRef.current === scale` → **直接 return，不保存**。

→ 改成 `useLayoutEffect`（paint 前同步执行）+ 声明在"恢复"之前。

**③ `onRestored` 回调身份每次渲染都变** → 恢复循环的 cleanup 反复取消 rAF
→ 循环只跑一帧就停 → 选区恢复完又被重渲染干掉。

→ 用 `useCallback` 固定身份。

---

### 根因 3：拖动中**完全没有反馈**（"巨卡"的来源）

旧实现所有几何计算都挂在 **mouseup** 上：

```
mousedown ──────────────────── mouseup ──► 计算 ──► 出浮层
```

实测按住拖动 900ms：浮层=无、自绘块=0 → 手感"卡死"。

**修法**：几何计算抽成 `computeGeometry()`，
**mouseup 和 selectionchange 都调**；`selectionchange` 侧用 **rAF 节流**
（实测拖动 30 步触发 15 次 selectionchange）。

> pdf.js v6 的 `DrawLayer.#selectionChange()` 本来就是在 `selectionchange`
> 里实时画选区的 —— 我们之前只抄了一半。

---

### 根因 4：垂直定位用"容器"判定 → 误判"放不下"→ 乱翻

容器可能比窗口还高（内部滚动）：

```
容器可视区:  97..908    ← 908 > 视口 900
选区底部:    880
浮层高度:    38
```

按容器算：下方只剩 28px < 38 → **翻到上方** → 浮层跑到选区上面 130px。

**修法**：垂直边界改用**视口**，容器只做水平 clamp。

---

### 性能提优

用户要求"性能需要提优"。先测量，确认瓶颈在哪：

```
CPU profile:  89.4% idle, 我们的代码 0.1%
帧间隔:       p50=16.7ms  p95=16.9ms  长帧 0 个
```

→ **CPU 不是瓶颈**（满帧 60fps）。但拖动时**零反馈**才是"卡"的来源（根因 3）。
另外把几个 O(n²) 的算法也优化了（拖动时高频触发）：

| 位置 | 旧 | 新 |
|---|---|---|
| `collectPages` | 每次 `querySelectorAll`（518 span）+ 518 次 `intersectsNode` | **按页分组 + 缓存**（MutationObserver 标脏），一页命中就 break |
| `clipToBaseline` | 每个矩形都 `map`+`filter`+`sort` 整个基线表 | **只保留最近 K=8 个候选**，只排这 8 个 |
| `optimizeClientRects` | 全量双重循环 → 255 矩形 = **65025 次比较** | **先按行分桶**，只在桶内比较 → 几百次 |

---

### 验证

- `pnpm verify`：**8 门禁全绿**
- `pnpm test`：**349 passed**
- E2E：**15 套 129/129 断言全通过**
  （新增 `e2e-popover-anchor.mjs` 8 项 + `e2e-selection-perf.mjs` 3 项）

### 性能实测（页面内原生事件，排除 CDP 往返）

```
拖动 40 帧:  p50=16.6ms  p95=16.9ms  max=18.2ms  >32ms 长帧 0 个   ← 满帧 60fps
mousedown → 浮层出现:  87~107ms（之前 261ms，且必须等松手）
```

### 用户报的问题逐条验证

| 反馈 | 结果 |
|---|---|
| 缩放时浮层没跟着缩放 | ✅ 间距 −126.4px → −129.6px（一致） |
| 缩小后选择跑偏 | ✅ −126.4px（一致） |
| 滚动时浮层 | ✅ 跟随，不消失 |
| 鼠标开始框选立刻出现浮层 | ✅ 87~107ms，不用等松手 |
| 很卡 | ✅ 满帧 60fps + 拖动中实时反馈 |

### 关键文件

```
src/hooks/useSelectionPreservation.ts  新增：缩放前后保持选区（字符偏移）
src/hooks/useTextSelection.ts          几何计算抽成 computeGeometry，selectionchange 也调（rAF 节流）
src/components/SelectionPopover.tsx    锚点实时计算 + 滚动/resize/定时校正
src/components/PdfViewer.tsx           缩放前保存选区 + 恢复后重开浮层 + 滚动不再隐藏浮层
src/core/selection/popover-position.ts  垂直边界改用视口
src/core/selection/shape.ts            候选表只留 K=8（不全量排序）
src/core/selection/optimize-rects.ts   按行分桶（O(n²) → O(n + Σ桶内²)）
scripts/e2e-popover-anchor.mjs         新增（8 项断言）
scripts/e2e-selection-perf.mjs         新增（3 项断言）
```
