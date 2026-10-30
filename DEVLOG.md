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
