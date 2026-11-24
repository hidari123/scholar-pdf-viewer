# 第 7 步：基础样式 — scpdf- 前缀 + CSS 变量主题（2026-10-30）

> 本轮记录已从 `DEVLOG.md` 拆出。

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
