# 第 8 步：demo — Vite 8 + React 19，零 antd（2026-10-30）

> 本轮记录已从 `DEVLOG.md` 拆出。

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
