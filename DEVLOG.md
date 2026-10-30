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
