# 第 3 步：lint/format — biome（2026-10-30） / 阶段 1 · 第 3 步：core/cache —— 文档字节缓存（2026-11-13） / 阶段 2 · 第 3 步：demo 真实接入 + E2E 冒烟（2026-11-13） / 阶段 4 · 第 3 步：链接层 + 密码框 + 错误态（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

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
