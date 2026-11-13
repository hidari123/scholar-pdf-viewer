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

## 阶段 4 · 第 1 步（下一步）：TextLayer —— 文本层（让文字真的能选中）
