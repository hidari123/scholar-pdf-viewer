# 第 5 步：运行时依赖 — pdfjs-dist + idb（2026-10-30） / 阶段 1 · 第 5 步：core/search —— 文本索引与搜索（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

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
