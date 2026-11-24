# 第 29 轮：整体审核（代码 / 功能 / 边界 / 文档 / 测试）（2026-11-24 晚）

> 本轮记录已从 `DEVLOG.md` 拆出。

# 第 29 轮：整体审核（代码 / 功能 / 边界 / 文档 / 测试）（2026-11-24 晚）

用户要求："对整体代码/功能 边界 进行整体的审核 功能是否完善 是否易用 文档是否齐全等 功能是否有误 整体进行全面测试"

本轮**不按 bug 列表走**，而是**系统性审核**整个包。

---

## 审核方法

-> **真实宿主项目**集成测试 ✅（Vite + `npm pack` 装出来的正式包 + 只有 React）✅
-> **静态分析**：分层边界 / React 规则 / 可访问性 / 体积 ✅
-> **文档对照**：把 78 个 prop 逐个对到 API.md ✅
-> **边界场景**：窄屏 / 最大缩放 / 404 / 加密 PDF ✅

---

## 发现并修掉的问题（**8 个**）

| #   | 问题                                           | 严重度   | commit    |
| --- | ---------------------------------------------- | -------- | --------- |
| ①   | **README 的"最小接入"照抄是【不工作的】**      | **致命** | `4236bc7` |
| ②   | `features.themePicker` **类型上不存在**        | 高       | `4236bc7` |
| ③   | `./core` 子路径**没导出 print 模块**           | 中       | `4236bc7` |
| ④   | 窄屏下工具栏**溢出**，按钮被裁掉               | 中       | `4236bc7` |
| ⑤   | API.md **漏了 5 个 prop**                      | 中       | `4236bc7` |
| ⑥   | 根目录 11 个过时的 plan 文件（170 KB）         | 低       | `4236bc7` |
| ⑦   | 批注详情的只读内容**没消毒**（XSS）            | **高**   | `c2d238a` |
| ⑧   | 默认 pdf.js 接线**不传密码**（加密文档打不开） | 中       | `7d2bb3a` |

---

## ① README 的"最小接入"照抄是【不工作的】**（最严重）

### README 原来写

```tsx
<PdfViewer file="/docs/paper.pdf" />
**就这样**——没有 provider、没有 store 初始化、没有后端配置。
```

### 实测（真实宿主项目：Vite + `npm pack` 的包 + 只有 React）

```
pages: 0    canvases: 0    JS 错误: 0     ← 静默失败 ❌
```

-> **白屏，而且没有任何报错** ❌ -> 宿主完全不知道哪里错了 ❌

### 真因

-> 宿主必须自己接 pdf.js：`getDocInfo` / `getPage` / `getPageSizes` ✅
-> **漏了任何一步 -> 白屏 + 无提示** ❌

### 修法

-> **包内置一份默认接线**（新增 `src/core/document/pdfjs-bridge.ts`）✅
-> 宿主**不传** -> 用默认的 ✅ -> **开箱即用** ✅
-> 宿主**传了** -> 用宿主的 ✅（完全覆盖 ✅）
-> 默认接线**自动设好 worker** ✅
-> `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url)` ✅
-> 不设 -> 文档**永远加载不出来** ❌
-> **动态 import** ✅ -> 不用 PDF 的页面**不受影响** ✅

### ⚠️ 踩到的坑

-> 加载文档的 effect 依赖是 `[file, documentId, reloadSignal]` ❌ -> **只跑一次** ✅
-> 桥接没好就调 `getDocInfo` -> 抛错 -> **永远不重试** ❌ -> 白屏 ❌
-> -> 修法：**让加载 await 桥接的 promise** ✅

### 实测（修复后）

```
pages: 18   canvases: 4   JS 错误: 0      ← 正常渲染 ✅
点"下一页" -> 2 ✅
```

---

## ② `features.themePicker` 类型上不存在

-> 代码里一直读 `features?.themePicker` ✅
-> 但 `Features` 接口**没声明** ❌
-> -> 宿主写 `features={{ themePicker: false }}` **TS 报错** ❌
-> -> "不显示主题按钮"这个能力**根本用不了** ❌
-> 修法：接口补上 ✅（+3 单测 ✅）

---

## ③ `./core` 子路径没导出 print 模块

-> `src/core/index.ts` 少了 `export * from './print'` ❌
-> -> 宿主想自己算打印缩放 -> **得从主入口 import** ❌（会拖进 React ❌）
-> 修法：补上 ✅（`computePrintScaleForRender` / `PAPER_SIZES` / `orientPaper` 等 ✅）

---

## ④ 窄屏下工具栏溢出

```
容器 304px  ->  工具栏内容 675px   ← 溢出 371px ❌
-> 被裁掉的按钮**点不到** ❌（打印 / 主题…）
```
-> 修法：`overflow: hidden` + 三组**各自横向滚动** ✅ -> **不丢按钮** ✅

---

## ⑤ API.md 漏了 5 个 prop

-> `minScale` / `maxScale` / `allowScaleInput` / `onThemeChange` / `themeOptions` ❌
-> 修法：补 `2.5b 缩放` / `2.5c 主题` ✅ -> 现在 **78 个 prop 全覆盖** ✅

---

## ⑦ 批注详情的只读内容没消毒（XSS）

-> `AnnotationPanel` **直接渲染**宿主的 html ❌
-> 但**同一个包的 `RichTextPreview` 就是消毒的** ✅ -> **不一致** ❌
-> 修法：**渲染前一律消毒** ✅（纵深防御 ✅）

---

## ⑧ 默认接线不传密码

-> 加密 PDF 在默认接线下**打不开** ❌
-> 修法：`open(data, password?)` ✅ + `PdfViewer` 传 `currentPassword` ✅

---

# 审核结论（**没问题的部分** ✅）

## 架构 / 边界

-> **分层干净** ✅：`core` 不 import `components`/`hooks` ✅，`hooks` 不 import `components` ✅
-> `core` 里的 React 引用**都是 type-only** ✅
-> `core` 里的 DOM 只有 **2 处**（文件下载 / 字体测量）✅
-> **12 个错误码**全在 API.md ✅（含"能不能重试"）✅
-> **90 个公开导出** ✅；四个子路径（`.` / `./core` / `./editor` / `./dialog` / `./icons`）都可用 ✅
-> **npm 包内容干净** ✅：只有 `dist/` + README + package.json ✅

## 代码质量

-> **React 规则** ✅：`useMemo` 都包了 ✅，`setState(fn)` 全是函数形式 ✅
-> **可访问性** ✅：26 个按钮**全部**有可访问名称 ✅，canvas 有 `aria-label` ✅
-> **biome / tsc / vitest / publint / attw** 全绿 ✅

## 安全

-> `sanitizeRichTextHtml` **DOM 无关**（纯正则白名单）✅ -> SSR 安全 ✅
-> 危险标签连**内容**一起丢 ✅
-> `isSafeUrl` 协议白名单 ✅（`javascript:` 被拒 ✅）
-> 错误 UI **按错误码取文案** ✅（不跟语言切换 ❌ 的老问题已修 ✅）
-> 只有**可重试**的错误才给重试按钮 ✅

## 文档

-> README（31 KB，中英双语 ✅）/ API.md（21 KB ✅）/ GUIDE.md ✅ / EXTENDING.md ✅ / DEVLOG.md ✅
-> **78 个 prop 全覆盖** ✅
-> "30 秒接入"现在**真的能用** ✅（修完 ① ✅）

## 测试

-> **833 条单测**（60 个文件）✅
-> **799 项 E2E 断言**（36 个套件）✅ -> **0 失败** ✅
-> 覆盖率：51.5% / 42.4% / 47.2% / 51.5%（门槛 51 / 47 / 41 / 51）✅
-> **真实宿主项目**集成测试 ✅（Vite + 正式包）✅

---

# 遗留（**下一轮可以做的**）

-> **单测 / 源码比 0.37** ❌ -> 覆盖率 51.5% 只是刚过门槛 ✅
-> `PdfViewer.tsx`（5500+ 行）几乎没单测 ❌ -> 只有 E2E 兜 ✅
-> **demo 只用了 46 / 78 个 prop** ✅ -> 其余 32 个是"可选变体" ✅
-> 但 `cache`（IndexedDB 缓存）/ `features` / `config` 这几个**值得在 demo 里演示** ✅
-> ~~**DEVLOG 253 KB** ❌ -> 该拆分成"按版本归档" ✅~~ **【已做 ✅】**
-> 拆成 `docs/devlog/round-XX.md`（32 份 ✅）+ `DEVLOG.md` 只留索引 ✅
-> 253 KB -> **10 KB** ✅（归档 270 KB ✅ 内容一字不少 ✅）
-> **CMaps / 标准字体**没接 ✅ -> 中文 PDF 缺字形时可能显示不对 ✅
-> （宿主可以自己传 `getDocInfo` 接 ✅）
-> 没有 **Storybook / 组件文档站** ❌

---

# 验证

- `pnpm verify` -> **9/9 全绿**
- `pnpm test` -> **833 passed**
- E2E -> **799/799 项断言通过，0 个套件失败** ✅
- 体积 -> 主入口 36.2 kB / 37 kB ✅
