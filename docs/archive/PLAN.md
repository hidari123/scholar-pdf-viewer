# @scholar-space/pdf-viewer —— 前端 PDF 阅读器组件包 · 方案

> 版本：v2（2026-11-13）
> 状态：已定稿，进入实施
> 前身：`PdfNpmPackagePlan.md`（v1，含主项目迁移细节；本文为**包本体**方案，迁移部分见 §12）

---

## 0. 摘要（一页读完）

**一句话定位**：一个**只做 PDF 本身**的前端组件包——加载快、定位准、缩放稳；不含任何业务。

**解决什么问题**：市面上的 PDF 组件要么太重（带 UI 库/带业务），要么太糙（坐标不准、缩放跳）。本包只解决 PDF 的**呈现与几何**：加载、渲染、缩放、滚动、定位、选择、高亮绘制、页内跳转、搜索。

**核心结论（三条）**：

1. **包内零业务**——不调后端、不认后端字段、不做 AI。宿主的一切（弹层、笔记、AI、持久化、皮肤）都在包外。宿主通过**受控 props + 事件回调**接入。
2. **几何契约中立且精确**——坐标三空间（PDF 点 / 归一化 / 视口 px）一次定义、纯函数换算、golden 测试锁死；高亮在什么缩放下都落在同一个位置。
3. **能力按需组合**——headless 内核（core/hooks）与开箱 UI（组件）分层，宿主可用可不用。

**与主项目的关系**：本包是主项目 PDF 模块的**替代底座**。主项目在包外写 100 行 adapter 接入自己的 API 与业务；迁移是阶段 3 的事，包不为此妥协。

---

## 1. 背景与目标

### 1.1 现状痛点（主项目 `src/pages/Chat/PdfSection/**`，32 文件）

| 痛点                                | 表现                                  | 后果                                 |
| ----------------------------------- | ------------------------------------- | ------------------------------------ |
| **渲染与业务耦合**                  | 渲染代码里混着 note/chat/AI 逻辑      | 不可复用、不可测试、不可给别的项目用 |
| **viewport 被手工变异**             | 直接改 pdf.js 的 viewport 对象        | 坐标漂移、高亮错位（难查）           |
| **IDB 清理的 Promise 提前 resolve** | 删除没等完就 resolve                  | 缓存脏数据                           |
| **弹层定位按 window 算**            | 滚动容器内定位错位                    | 弹层飘                               |
| **当前页跟踪 O(n)**                 | 每次滚动全量遍历                      | 长文档卡顿                           |
| **选区归页全量双循环**              | 每页扫全部矩形                        | 选区卡顿                             |
| **后端格式渗进前端类型**            | `noteuuid`/`contentType` 写进组件类型 | 换后端即改包                         |

### 1.2 目标

- 抽出**可复用**的 PDF 组件包（独立仓库、独立发布、独立测试）
- 性能与精度达到"可作为产品级阅读器"的标准
- 边界清晰到**换个后端、换个产品也能用**

### 1.3 非目标（明确不做）

| 不做                             | 理由                 |
| -------------------------------- | -------------------- |
| 后端 API / 鉴权 / 持久化         | 宿主职责（§2.2）     |
| LLM / AI / 对话                  | 宿主职责；包只给几何 |
| UI 组件库（antd 等）             | 保持轻便、可换肤     |
| PDF 编辑 / 转换 / OCR / 合并拆分 | 另一个领域           |
| 移动端手势优化                   | 先做桌面，架构留口   |

### 1.4 成功标准（可度量）

| 指标       | 目标                                           | 口径                        |
| ---------- | ---------------------------------------------- | --------------------------- |
| 包体积     | core gzip ≤ 30KB；组件 gzip ≤ 80KB；CSS ≤ 12KB | size-limit CI 卡口          |
| 首屏可交互 | 3MB PDF ≤ 1.5s（本地）/ ≤ 3s（4G 模拟）        | 加载完成 → 首屏渲染完成     |
| 翻页       | ≤ 50ms（P95，本地缓存命中）                    | 点击翻页 → 新页 canvas 呈现 |
| 缩放       | ≤ 80ms（P95）                                  | scale 变更 → 重排完成       |
| 选区响应   | ≤ 16ms（16ms 内一帧）                          | mouseup → 选区回调          |
| 滚动       | 60fps（100 页文档，虚拟化下）                  | 长任务 < 50ms               |
| 坐标精度   | 高亮在任意缩放下**像素级一致**                 | golden 往返测试             |
| 独立可发布 | `npm publish` 成功，publint/attw 零告警        | CI                          |

---

## 2. 定位与边界

### 2.1 包的职责

**渲染 + 交互（PDF 内的）+ 本地几何模型。**

具体三块：
1. **加载**：URL/Blob/流式加载、Range 请求、密码、缓存、错误分类
2. **渲染**：分页、虚拟化、旋转、DPR、文本层、页面生命周期
3. **几何**：坐标换算、选区提取、高亮绘制、命中测试、当前页定位

### 2.2 宿主的职责

- 取数据（自己的 API）
- 业务语义（笔记是什么、谁的高亮、私不私密、点赞）
- 业务 UI（弹层、面板、AI 对话框、主题皮肤）
- 持久化（存哪、怎么存）

### 2.3 接入面：**受控 props + 事件回调**（无注入接口）

```tsx
<PdfViewer
  file={url} // 数据进
  highlights={highlights} // 数据进（中立结构）
  onSelectionChange={fn} // 事件出
  onHighlightCreate={fn} // 事件出
  onHighlightClick={fn} // 事件出
  onDocumentLoad={fn} // 事件出
  onError={fn} // 事件出
/>;
```

**没有** `StorageAdapter`、**没有** `PopoverAction`、**没有** `bboxData`——这些是业务，不是 PDF 能力。

> **决策记录**：v1 曾设计 `StorageAdapter`（宿主注入持久化）与 `PopoverAction`（宿主注册弹层动作）。v2 **取消**：它们让包背上"数据落地"和"业务动作"两件事，与"只做 PDF"冲突，且对不需要的宿主是无用负担。改为**纯受控**：数据进、事件出，宿主想存就存、想弹就弹。

### 2.4 "换后端也能用"：中立模型 + 字段禁用清单

**包内允许出现的字段**（全部是 PDF 几何或通用状态）：

`file` `documentId` `highlights[].{id,color,selectedText,position,source}` `pageNumber` `rect` `text` `scale` `rotation` `visiblePages` `error.code` …

**包内禁止出现**（出现即视为越界，CI 有 lint 规则卡）：

| 禁用                                                   | 原因         |
| ------------------------------------------------------ | ------------ |
| `noteuuid` / `noteId` / `paperFileId`                  | 后端主键命名 |
| `contentType` / `isPrivate` / `likeNum` / `commentNum` | 业务语义     |
| `authorName` / `avatar`                                | 账号体系     |
| 任何 URL 形态的 API 路径                               | 包不调后端   |
| `token` / `userId` / `chatId`                          | 登录态       |
| `source: 'my' \| 'all'` 之外的来源枚举                 | 业务分类     |

> 唯一例外：`color` 用 `'label-2' \| 'label-6' \| 'label-10'` 这类**语义色 key**（不是 CSS 类名），宿主可映射到自己的色板。

### 2.5 边界表：PDF 能力 vs 业务能力

| 能力                                          | 归属                                         |
| --------------------------------------------- | -------------------------------------------- |
| 滚动 / 翻页 / 缩放 / 适配宽度 / 当前页 / 跳转 | **包**                                       |
| 文本选择（输出几何：文本 + 矩形 + 页码）      | **包**                                       |
| 高亮绘制（输入坐标，输出画面）/ 命中测试      | **包**                                       |
| 内部链接跳转 / 外部链接回调                   | **包**（内部自己跳，外部抛事件）             |
| 搜索 / 缩略图 / 目录 / 打印 / 键盘 / 无障碍   | **包**                                       |
| 选区弹层（解释/提问/翻译）                    | 宿主                                         |
| AI 追问 / 对话 / 流式回填                     | 宿主                                         |
| 证据框（bbox）                                | 宿主                                         |
| 笔记增删改查 / 点赞 / 评论                    | 宿主                                         |
| 持久化 / 缓存策略 / 登录态                    | 宿主（包内只做"文档字节缓存"这一技术性缓存） |

### 2.6 与主项目的关系

- 包**不知道**主项目存在
- 主项目在 `src/adapters/` 里把自己的 API 映射到包的 `highlights` 结构（约 100 行）
- 主项目的 AI/笔记/对话 UI 全部留在主项目，通过 `onSelectionChange` 等回调驱动

---

## 3. 技术选型

> 每项含：选型 / 理由 / 备选 / 退路。

### 3.1 pdfjs-dist 6 直连（不用 react-pdf 封装）

- **理由**：渲染引擎是包的核心能力，版本必须是包的内部契约；react-pdf 之上做过的 hack（手工变异 viewport、依赖内部类名）证明封装层是负资产
- **备选**：react-pdf（否决）、pdf.js 官方 viewer（太重、不可裁剪）
- **退路**：pdfjs-dist ^5.3（若 6.x 出现不可控问题）
- **版本**：6.4.x（2026-10 最新）

### 3.2 React 18/19 peer；headless + 组件双层

- **理由**：宿主可能是任何框架/版本 → React 是 peer 不是 dep；core 层零 React，任何环境可用
- **备选**：框架无关包 + 单独的 React 包（多包复杂度，当前不划算）
- **退路**：peer 范围收窄到 `>=18 <20`（已定）

### 3.3 TypeScript 5.9（TS7 生态未就绪的实测结论）

- **理由**：TS 7（tsgo，Go 原生）**不提供 JS Compiler API** → tsup 9 的 dts 管线调不到；`@typescript/typescript6` 兼容包也不行（tsup 9 调 5.x 独有的 `parseJsonConfigFileContent`）
- **实测记录**：仓库 `DEVLOG.md` 第 2 步有两层失败的完整过程
- **备选**：tsgo 单独做 typecheck + 5.9 做 dts（pnpm overrides 双轨，复杂度 > 收益）
- **revisit 触发**：tsup / rollup-plugin-dts 宣布支持 TS 6+ API

### 3.4 构建 tsup / 测试 vitest / 规范 biome / 样式裸 CSS

| 项   | 选型                               | 理由                                                   |
| ---- | ---------------------------------- | ------------------------------------------------------ |
| 构建 | tsup 9（esm + cjs + d.ts）         | 库构建专用，比 rollup 手搓省事；esbuild 快（~10ms/次） |
| 测试 | vitest 5                           | 与 Vite 同管线，TS/ESM 零配置                          |
| 规范 | biome 2                            | lint + format 一体，比 ESLint+Prettier 快 5–10×        |
| 样式 | 裸 CSS + CSS 变量（`scpdf-` 前缀） | 零构建约束（任意 bundler / CDN 直引）；主题靠变量覆盖  |

**踩坑沉淀**：`&&` 在 PowerShell 5.1 非法 → 构建脚本零 shell 语法，多步收进 Node 脚本（`scripts/build.mjs`）。

### 3.5 零状态库（每实例 store + `useSyncExternalStore`）

- **理由**：主项目用 valtio，包内引入即多一个运行时依赖；每实例一个纯 TS store + `useSyncExternalStore` 足够（React 官方方案，无依赖）
- **备选**：zustand（轻，但仍是依赖）、valtio（主项目在用，但包不该绑）
- **退路**：若复杂度过高，引入 zustand（包仍可零依赖拆 core）

### 3.6 缓存 idb（IndexedDB）

- **理由**：主项目手写 IDB 出过 Promise 提前 resolve 的 bug；idb 的 Promise 形态消灭回调陷阱
- **备选**：手写（否决）、内存缓存（Safari 隐私模式降级用）
- **退路**：无（idb 体积 ~1KB gzip）

### 3.7 依赖清单与体积预算

| 依赖                               | 类型       | 用途           | gzip                         |
| ---------------------------------- | ---------- | -------------- | ---------------------------- |
| pdfjs-dist 6                       | dependency | 渲染引擎       | ~350KB（外部，不计入包体积） |
| idb 8                              | dependency | IndexedDB 封装 | ~1KB                         |
| react / react-dom                  | peer       | 组件层         | 0                            |
| tsup / vitest / biome / typescript | dev        | 工具链         | 0                            |

**预算**：core ≤ 30KB gzip；组件层 ≤ 80KB gzip；CSS ≤ 12KB gzip（CI 用 size-limit 卡）。

---

## 4. 架构设计

### 4.1 三层

```
core/           零 React、零 DOM、零业务 —— 可在 Node / Worker 里跑
  geometry/     坐标换算（纯函数）
  document/     文档加载管线、错误码
  cache/        文档字节缓存（idb + 内存降级）
  selection/    选区提取（DOM 相关，但只产出几何）
  search/       文本索引与搜索
  store/        每实例状态容器（纯 TS）
hooks/          React 状态桥（useSyncExternalStore 订阅 core store）
components/     UI（PdfViewer / Toolbar / Thumbnail / SearchPanel …）
```

**依赖方向严格单向**：`components → hooks → core`，core 不知道 React 存在。

### 4.2 模块依赖图与数据流

```
props(file, highlights, scale…)
   ↓
store（每实例一份，命令式 API 更新）
   ↓ 订阅
hooks（useSyncExternalStore）
   ↓ 派生
components（渲染）
   ↓ 事件
on* 回调 → 宿主
```

**单向**：宿主 → props → store → 视图 → 事件 → 宿主。宿主不改内部状态，只通过 props 与 ref。

### 4.3 每实例一份 state

多个查看器互不干扰（主项目有"主视图 + 缩略图预览"的需求）。store 以实例为单位，**不共享**。

### 4.4 渲染层：canvas + 文本层双通道

- **canvas**：页面图像（DPR 感知，cap 2）
- **文本层**：透明 DOM span（可选，`renderTextLayer`），用于选择/复制/无障碍
- **标注层**：绝对定位的 DOM（高亮、链接、热点）—— 不用 canvas 画标注，便于命中测试与 CSS 主题

### 4.5 虚拟化与页面生命周期状态机

```
placeholder → rendering → rendered → released
```

- 占位：用 `pageSizes[]` 预计算高度，保证滚动条稳定
- 可见判定：`IntersectionObserver`（root = 滚动容器，rootMargin = 3 页高）
- 并发：最多 2 页同时渲染，按"距视口中心距离"排队
- 释放：离开缓冲 N 页 → canvas 回池，保留尺寸占位
- 竞态：每次 `page.render()` 带 `renderId`，缩放/旋转/换文件时旧回调丢弃

### 4.6 坐标三空间与换算（几何契约）

| 空间    | 定义                                        | 用途                             |
| ------- | ------------------------------------------- | -------------------------------- |
| PDF 点  | 72dpi，原点左下，y 向上                     | 与 PDF 内部一致（旋转、cropbox） |
| 归一化  | 页内比例 0–1（`NormRect`：坐标 + 参考尺寸） | 持久化、跨缩放不变               |
| 视口 px | 当前缩放下的页面像素                        | 渲染与命中测试                   |

**关键性质**：`NormRect` 存的是"坐标 + 采集时参考尺寸"一对，读回时按 `当前视口尺寸 / 采集时参考尺寸` 线性映射 → **同一份数据在任何缩放下落点相同**（缩放无关性）。

**换算全部走 pdf.js 的 viewport API**（正确处理 rotation/cropbox/userUnit），**禁止手工变异 viewport**。

**golden 测试锁死**：wire 语义、缩放无关性、API 路径与纯数学回退一致、旋转页行为。已实施（阶段 1 · 第 1 步）。

---

## 5. 功能清单（按优先级分期）

### 5.1 P0 · 文档加载

| 能力           | 说明                                                            |
| -------------- | --------------------------------------------------------------- |
| 来源           | URL / Blob / ArrayBuffer / File                                 |
| 渐进加载       | HTTP Range 请求（容忍 405/206）、服务端不支持时全量降级         |
| 校验           | magic bytes `%PDF-`；空文件；损坏文件                           |
| 密码           | 加密文档：密码回调 + 重试上限 3 次                              |
| 元数据         | 页数 / 标题 / 作者 / 创建工具                                   |
| 页面尺寸预计算 | 分批（10 页/批）异步算 `pageSizes[]`，滚动条早出现              |
| 竞态           | 每次加载带 `loadId`，旧 loadId 的响应一律丢弃（换文件不串数据） |
| 缓存           | 文档字节入 IndexedDB（LRU + 配额）；写失败降级为内存 blob 模式  |
| 错误码         | 见 §6.6（12 个）                                                |

### 5.2 P0 · 渲染与虚拟化

分页渲染 / 虚拟化 / DPR / 旋转 / 文本层策略（视口 ±1 页）/ 页面生命周期 / 渲染并发 2 / 标签页隐藏时暂停渲染队列（省电）/ canvas 池复用

### 5.3 P0 · 缩放 / 滚动 / 翻页 / 当前页

- 缩放范围 0.2–2.5，`'width'` 模式适配容器
- **缩放锚点保持**：缩放前后视口中心的内容位置不变
- 当前页跟踪：滚动 rAF 节流 + 页偏移数组**二分查找**
- 翻页：`scrollTo` + 平滑行为；`initialPage` 走同一路径
- 容器滚动（非 window）

### 5.4 P0 · 选择与高亮

- 文本选择 → 产出 `{ text, rects（视口 px）, norm（归一化）, pages, anchor }`
- 跨页选择正确分页归属（矩形中心点判定，不做全量双循环）
- 同行矩形合并（去包含 + 同行合并），输入不可变
- 高亮绘制（受控 `highlights` prop）+ 命中测试 + 点击回调
- 复制选中文本
- **不做**：弹层、笔记、AI

### 5.5 P0 · 链接与键盘

- 内部链接（跳页）包内处理；外部链接抛 `onLinkClick`
- 键盘：←/→ 翻页、Ctrl+ +/- 缩放、Ctrl+F 搜索、Home/End、Esc 关闭面板
- 无障碍：canvas `aria-label`、焦点可见、可键盘翻页

### 5.6 P1 · 搜索

- 分页文本索引（懒建，按需触发）
- 去抖 + 分片（不阻塞主线程）
- 命中列表 + 跳转 + 当前命中高亮

### 5.7 P1 · 缩略图 / 目录

- 缩略图：低分辨率渲染（独立 canvas，懒生成，缩略图视口虚拟化）
- 目录（outline）：树形，点击跳转
- 二者均为**可选面板**，可用 `toolbar.slots` 替换

### 5.8 P1 · 全文提取

- `getFullText(pages?)` → 纯文本 / 分页文本，供宿主做摘要、翻译、索引（宿主自己调模型）

### 5.9 P1 · 注释层与表单

- PDF 原生注释（annotation layer）渲染与交互（高亮/下划线/便笺/弹窗）
- AcroForm 表单：读取 + 填写 + 校验（分阶段，先只读展示）

### 5.10 P2 · 进阶

区域截图（`captureRegion`，DPR 正确）/ 导出单页图片 / 打印（CSS print 适配）/ 多文档对比视图 / 页面重排（reflow）/ 附件列表 / 数字签名展示 / 页面合并拆分（宿主侧用 pdf-lib，包不提供）

### 5.11 工具栏与面板（headless 插槽）

```ts
interface ToolbarConfig {
  showPageNav?: boolean;
  showZoom?: boolean;
  showSearch?: boolean;
  showThumbnails?: boolean;
  showOutline?: boolean;
  leftSlot?: ReactNode; // 宿主任意内容（历史文档、分享等）
  rightSlot?: ReactNode;
}
```

**内置 UI 零依赖**（原生元素 + CSS 变量），宿主可整体替换。

### 5.12 主题与 i18n

- 15 个 CSS 变量（色板 / 高亮三层 / 页面阴影 / 动效 / 字体），暗色模式（`prefers-color-scheme` + 手动覆盖）
- i18n：`locale: 'zh' | 'en'`，内置文案 key 清单，可传 `messages` 覆盖

---

## 6. 公共 API 契约

### 6.1 props

**数据类**

| prop                  | 类型                            | 默认      | 说明                                               |
| --------------------- | ------------------------------- | --------- | -------------------------------------------------- |
| `file`                | `string \| Blob \| ArrayBuffer` | 必填      | 文档来源；变化触发重载（带 loadId 保护）           |
| `documentId`          | `string`                        | -         | 宿主业务 id（缓存键、事件透传；包内不解析）        |
| `highlights`          | `HighlightRecord[]`             | `[]`      | 受控高亮（中立结构，见 §6.5）                      |
| `initialPage`         | `number`                        | `1`       | 初始页                                             |
| `initialScale`        | `'width' \| number`             | `'width'` | 初始缩放                                           |
| `password`            | `string`                        | -         | 加密文档密码                                       |
| `cMapUrl`             | `string`                        | -         | CJK 字体目录                                       |
| `standardFontDataUrl` | `string`                        | -         | 标准字体数据                                       |
| `workerSrc`           | `string`                        | 自动      | 自定义 worker（CDN 场景）                          |
| `renderTextLayer`     | `boolean`                       | `true`    | 文本层（选择/复制依赖它）                          |
| `toolbar`             | `ToolbarConfig`                 | 全开      | 工具栏与插槽                                       |
| `features`            | `Partial<Features>`             | 全开      | `{ search, thumbnails, outline, keyboard, print }` |
| `theme`               | `'light' \| 'dark' \| 'auto'`   | `'auto'`  | 主题                                               |
| `locale`              | `'zh' \| 'en'`                  | `'zh'`    | 语言                                               |
| `messages`            | `Partial<Messages>`             | 内置      | 文案覆盖                                           |

**事件类**

| 回调                | 签名                                                                       | 说明                           |
| ------------------- | -------------------------------------------------------------------------- | ------------------------------ |
| `onDocumentLoad`    | `(doc: PdfDocInfo) => void`                                                | 加载成功（页数/元数据）        |
| `onError`           | `(e: PdfViewerError) => void`                                              | 错误（§6.6 错误码）            |
| `onPageChange`      | `(page: number, total: number) => void`                                    | 当前页                         |
| `onZoomChange`      | `(scale: number) => void`                                                  | 缩放变化                       |
| `onSelectionChange` | `(sel: SelectionData \| null) => void`                                     | 选区变化（**几何输出**）       |
| `onHighlightClick`  | `(h: HighlightRecord) => void`                                             | 点击高亮                       |
| `onHighlightCreate` | `(h: NewHighlight) => void`                                                | 新建高亮（宿主决定是否保存）   |
| `onHighlightUpdate` | `(id: string, h: NewHighlight) => void`                                    | 更新高亮                       |
| `onHighlightRemove` | `(id: string) => void`                                                     | 删除高亮                       |
| `onLinkClick`       | `(dest: string, meta: { external: boolean; pageNumber?: number }) => void` | 链接（外部）                   |
| `onCacheEvent`      | `(e: CacheEvent) => void`                                                  | 缓存 hit/miss/save/evict/error |

### 6.2 命令式 handle（`ref`）

| 方法                                                                     | 说明                           |
| ------------------------------------------------------------------------ | ------------------------------ |
| `scrollToPage(page, { smooth })`                                         | 跳页                           |
| `scrollToHighlight(id)`                                                  | 跳到高亮并激活                 |
| `scrollToRect(pageNumber, rect)`                                         | 跳到任意坐标（通用定位）       |
| `getSelection()`                                                         | 当前选区                       |
| `setZoom(scale)` / `zoomIn()` / `zoomOut()` / `fitWidth()` / `fitPage()` | 缩放                           |
| `getPageSizes()`                                                         | 各页尺寸（PDF 点）             |
| `getViewport(pageNumber)`                                                | 该页当前视口（宿主算坐标用）   |
| `getDocument()`                                                          | `PDFDocumentProxy`（高级场景） |
| `getFullText(pages?)`                                                    | 全文提取                       |
| `captureRegion(rect)`                                                    | 区域截图（DPR 正确）           |
| `search(keyword)` / `searchNext()` / `searchPrev()`                      | 搜索                           |
| `download()`                                                             | 下载                           |
| `destroy()`                                                              | 释放（canvas 池 / IO / 事件）  |

### 6.3 hooks（高级用法）

`usePdfViewer()`（实例上下文）· `usePdfDocument()` · `useZoom()` · `useSelection()` · `useHighlights()` · `useSearch()` · `usePageSizes()`

### 6.4 数据模型（中立，§2.4 禁用清单）

```ts
type PageNumber = number; // 1-based

interface ViewRect {
  left;
  top;
  width;
  height;
  pageNumber;
} // 视口 px

interface NormRect {
  // 归一化（坐标 + 采集时参考尺寸）
  x1;
  y1;
  x2;
  y2;
  width;
  height;
  pageNumber;
}

interface NormPosition {
  boundingRect: NormRect;
  rects: NormRect[];
  pageNumber;
}

interface HighlightRecord {
  id: string; // 宿主 id（包内不解释语义）
  color: string; // 语义色 key，如 'label-6'
  selectedText: string;
  position: NormPosition;
  source?: 'my' | 'others'; // 仅用于视觉区分（我的/他人高亮底色）
  createdAt?: number;
}

interface NewHighlight {
  color;
  selectedText;
  position;
}

interface SelectionData {
  text: string;
  rects: ViewRect[]; // 当前缩放下（渲染用）
  norm: NormPosition; // 持久化用（缩放无关）
  pages: PageNumber[];
  anchor: { pageNumber; rect: ViewRect };
}

interface PdfDocInfo {
  numPages;
  title?;
  author?;
  creator?;
}
interface CacheEvent {
  type: 'hit' | 'miss' | 'save' | 'evict' | 'error';
  url;
  size?;
  error?;
}
```

### 6.5 错误码（12）

| code                   | 含义                                            | 归因 |
| ---------------------- | ----------------------------------------------- | ---- |
| `E_LOAD_HTTP`          | HTTP 状态错误（4xx/5xx）                        | 加载 |
| `E_LOAD_NETWORK`       | 网络不可达                                      | 加载 |
| `E_LOAD_TIMEOUT`       | 超时                                            | 加载 |
| `E_PDF_INVALID`        | 不是有效 PDF（magic bytes 校验失败 / 解析失败） | 加载 |
| `E_EMPTY`              | 空文件 / 0 页                                   | 加载 |
| `E_PDF_ENCRYPTED`      | 加密且未提供密码                                | 加载 |
| `E_PDF_PASSWORD_WRONG` | 密码错误（重试上限 3 次）                       | 加载 |
| `E_RENDER_PAGE`        | 某页渲染失败（带 pageNumber）                   | 渲染 |
| `E_CACHE_QUOTA`        | 缓存配额超限                                    | 缓存 |
| `E_CACHE_UNAVAILABLE`  | 缓存不可用（隐私模式，已降级）                  | 缓存 |
| `E_LINK_INVALID`       | 链接目标非法                                    | 交互 |
| `E_FONT_MISSING`       | 字体资源缺失（CJK 常见）                        | 渲染 |

每条错误都带 `message`（可展示文案）+ `cause`（原始异常）+ 可选 `pageNumber`。

### 6.6 生命周期

`idle → loading → loaded → rendering → ready`；错误时进入 `error` 并保留最近一次成功状态（可重试）。

---

## 7. 核心机制实现要点

### 7.1 文档加载管线

```
file
 ├ URL?  → fetch（Range 预检：容忍 405/206，206 走分段，405 降级全量）
 ├ 非 2xx → E_LOAD_HTTP
 ├ 超时 → E_LOAD_TIMEOUT
 ├ 网络异常 → E_LOAD_NETWORK
 ├ size === 0 → E_EMPTY
 ├ magic bytes ≠ %PDF- → E_PDF_INVALID
 ├ 缓存查询（idb；命中 → touch LRU；未命中 → 继续）
 └ getDocument({ data | url, cMapUrl, password })
      ├ PasswordException → onRequestPassword（≤3 次）→ E_PDF_PASSWORD_WRONG
      └ 成功 → pageSizes[] 分批预计算（10 页/批，异步）
缓存写入（fire-and-forget；失败 → 内存降级 + onCacheEvent）
每次加载带 loadId；旧 loadId 的响应/渲染到达即丢弃
```

### 7.2 渲染管线

- 可见判定：`IntersectionObserver`（root=滚动容器，rootMargin=3 页高）
- 并发上限 2，按"距视口中心距离"排队
- `renderId` 守卫：缩放/旋转/换文件后旧回调丢弃
- DPR：`min(devicePixelRatio, 2)`（低端机 1）
- 文本层：视口 ±1 页才渲染（可关）
- `visibilitychange` 隐藏时暂停渲染队列

### 7.3 缩放锚点与滚动

- 缩放锚点保持：
  `scrollTop_after = (scrollTop_before + anchorY) / scale_before × scale_after - anchorY`
- 当前页：页偏移前缀数组 + 二分查找（O(log n)）
- 跳页：`targetTop = Σ 前序页高 + padding`，平滑滚动

### 7.4 选区管线

```
mouseup → window.getSelection()
  → 空 / 不在文本层 → 清除选区
  → Range → 收集 span 的 data-page 集合 → 涉及页（1-based）
  → 每页 range.getClientRects()，按**矩形中心点落在该页框内**判定归属（不做全量双循环）
  → 每页矩形合并（去包含 + 同行合并，输入不可变）
  → SelectionData { text, rects(视口 px), norm(归一化), pages, anchor }
```

### 7.5 高亮渲染规格

- DOM 层（不是 canvas）→ CSS 主题可换、可命中测试
- 三层视觉：他人高亮 / 我的高亮 / 激活态描边（CSS 变量）
- 命中测试：按页分组 + 坐标命中（先页后矩形，避免全量遍历）

### 7.6 缓存层

- 键：`documentId` 或 URL 哈希；值为文档字节（Blob）
- LRU + 配额（默认 50MB，可配）；超限按 LRU 淘汰
- 写入失败（Safari 隐私模式 / 配额满）→ 内存 blob 模式（会话内有效）+ `onCacheEvent`
- 只缓存**文档字节**，不缓存渲染结果（渲染结果与缩放/旋转强相关，缓存收益低、复杂度高）

### 7.7 搜索实现

- 按需建文本索引（分页、分片，主线程不阻塞）
- 去抖 + 结果上限（默认 500）
- 命中跳转复用 `scrollToRect`

### 7.8 性能预算与实测口径

见 §1.4；CI 用 `size-limit` 卡体积，基准脚本（`bench/`）产出首屏/翻页/缩放耗时。

---

## 8. 目录结构（文件级）

```
scholar-pdf-viewer/
├─ src/
│  ├─ index.ts                    主入口：导出组件 + 公共类型
│  ├─ core/
│  │  ├─ index.ts                 core 公共出口（零 React）
│  │  ├─ types.ts                 公共类型（几何 + 事件 + 错误）
│  │  ├─ errors.ts                错误码与 PdfViewerError 构造
│  │  ├─ geometry/
│  │  │  ├─ index.ts
│  │  │  ├─ transform.ts          坐标换算（纯函数）★已实施
│  │  │  └─ optimize-rects.ts     选区矩形合并
│  │  ├─ document/
│  │  │  ├─ index.ts
│  │  │  ├─ loader.ts             fetch / Range / magic bytes / 密码
│  │  │  └─ sizes.ts              pageSizes 分批预计算
│  │  ├─ cache/
│  │  │  ├─ index.ts
│  │  │  └─ store.ts              idb + 内存降级 + LRU
│  │  ├─ selection/
│  │  │  ├─ index.ts
│  │  │  └─ extract.ts            Range → 选区几何
│  │  ├─ search/
│  │  │  └─ index.ts              文本索引与搜索
│  │  └─ store/
│  │     └─ instance.ts           每实例状态容器（纯 TS）
│  ├─ hooks/
│  │  ├─ index.ts
│  │  ├─ usePdfViewer.ts          实例上下文
│  │  ├─ useSyncStore.ts          useSyncExternalStore 桥
│  │  └─ …
│  ├─ components/
│  │  ├─ PdfViewer.tsx            主组件
│  │  ├─ PageCanvas.tsx           单页渲染
│  │  ├─ TextLayer.tsx
│  │  ├─ AnnotationLayer.tsx      高亮/链接/热点 DOM 层
│  │  ├─ Toolbar.tsx              内置工具栏（零依赖）
│  │  ├─ ThumbnailPanel.tsx
│  │  ├─ OutlinePanel.tsx
│  │  ├─ SearchPanel.tsx
│  │  └─ PasswordDialog.tsx
│  ├─ styles/
│  │  └─ viewer.css               主题变量 + 组件样式（scpdf- 前缀）
│  └─ i18n/
│     └─ messages.ts              zh/en 文案
├─ demo/                          Vite 8 + React 19 消费端（零 antd）
├─ tests/                         跨包集成测试
├─ bench/                         性能基准
├─ test-fixtures/                 PDF 样张（gitignore）
├─ scripts/                       build.mjs / verify.mjs
├─ .github/workflows/ci.yml
├─ DEVLOG.md                      开发记录（每步的决策/问题/教训）
└─ README.md
```

---

## 9. 边界矩阵与错误处理

| 场景                   | 行为                         | 错误码               |
| ---------------------- | ---------------------------- | -------------------- |
| URL 404 / 500          | 抛事件，不重试（可宿主重试） | E_LOAD_HTTP          |
| 网络断开               | 抛事件                       | E_LOAD_NETWORK       |
| 超时（可配，默认 30s） | 抛事件                       | E_LOAD_TIMEOUT       |
| 空文件                 | 抛事件                       | E_EMPTY              |
| 非 PDF（txt 改名）     | magic bytes 校验失败         | E_PDF_INVALID        |
| 损坏 PDF               | 解析异常                     | E_PDF_INVALID        |
| 加密无密码             | 触发密码流程                 | E_PDF_ENCRYPTED      |
| 密码错 3 次            | 放弃                         | E_PDF_PASSWORD_WRONG |
| 缺 CMap 字体           | 警告 + 该页降级              | E_FONT_MISSING       |
| 某页渲染异常           | 该页占位 + 事件              | E_RENDER_PAGE        |
| 缓存写失败             | 降级内存模式 + 事件          | E_CACHE_UNAVAILABLE  |
| 配额超限               | LRU 淘汰 + 事件              | E_CACHE_QUOTA        |
| 链接目标非法           | 忽略 + 事件                  | E_LINK_INVALID       |
| 换文件时旧请求返回     | **丢弃**（loadId）           | 无（正常路径）       |
| 缩放时旧渲染返回       | **丢弃**（renderId）         | 无（正常路径）       |
| 隐私模式               | 自动降级                     | E_CACHE_UNAVAILABLE  |
| 无文本层 PDF（扫描件） | 选择为空，高亮仍可用         | 无                   |

---

## 10. 测试与质量门禁

| 层次 | 工具                    | 覆盖                                                          |
| ---- | ----------------------- | ------------------------------------------------------------- |
| 单元 | vitest（node 环境）     | 几何换算 golden、错误码映射、缓存 LRU、搜索索引               |
| 集成 | vitest（jsdom 环境）    | 组件渲染、虚拟化、选区提取、高亮命中                          |
| 契约 | golden 快照             | 坐标语义、缩放无关性、往返一致                                |
| E2E  | Playwright（阶段 3 起） | 加载→渲染→缩放→翻页→选择全链路                                |
| 视觉 | Playwright 截图         | 主题变量、缩放前后高亮位置一致                                |
| 样张 | `TEST-SAMPLES.md`       | 10 类 PDF（P0/P1 分级）                                       |
| 门禁 | `pnpm verify` + CI      | lint / typecheck / test / build / demo typecheck / size-limit |

**SSR 守卫**：`core` 的任何入口都必须在纯 Node 环境可 import（测试守卫，防顶层 DOM 访问）。

---

## 11. 构建与发布

- 双格式：ESM + CJS + `.d.ts` / `.d.cts`
- 子路径导出：`.`（组件）/ `./core`（零 React）/ `./styles.css`
- `exports` 为唯一入口声明（封死深路径导入）
- `files: ["dist"]`（发布面 = 产物）
- `sideEffects: ["**/*.css"]`（防 tree-shaking 摇掉样式）
- `packageManager` 字段锁定 pnpm 版本
- 发布前检查：`publint` + `attw`（类型在 TS 4.7–5.9 下可解析）+ `size-limit`
- 版本：`changesets` 管理，破坏性变更走 major

---

## 12. 主项目迁移（阶段 3，包不为此妥协）

1. 主项目新增 `src/adapters/pdf-storage.ts`（约 100 行）：自己的 API ↔ 包的中立 `HighlightRecord`
2. 主项目保留全部业务 UI（弹层、AI、笔记、chat 联动）
3. 逐步替换 `src/pages/Chat/PdfSection/**`（32 文件）：先换渲染层，再换选区，再换高亮
4. **存量数据兼容**：主项目后端存的是 `Scaled`（≙ `NormRect` 同构）→ 迁移时只做字段名映射，**坐标零转换**
5. 验收：同一份存量高亮，新旧渲染位置像素级一致（golden 对拍）

---

## 13. 里程碑与排期

> **状态（2026-11-16）**：阶段 0 / 1 / 2 / 4 / 5 已完成并交付；
> 阶段 3（主项目迁移）按用户要求暂不进行。
> 交付现状：**303 单测** + 8 门禁全绿 + **9 套 E2E（真 Chromium，73 项断言）** + 包体积 13.67 kB。
>
> **2026-11-16 追加修复**（用户报 4 个 bug + 高亮效果重做）：
> - 精准选区：对齐 pdf.js 官方 `TextLayer`（逐 item + `scaleX` + 实测 ascent）
> - 缩放：比例整十 + 左上角锚点 + 几何法虚拟化（修白屏）
> - 搜索：命中高亮 + 精确跳转
> - 缩略图：零错位 + DPR
> - 高亮：逐行对齐 Δ=0px + `multiply` 不遮字 + 颜色可配

| 阶段       | 内容                                                  | 人天       | 状态       |
| ---------- | ----------------------------------------------------- | ---------- | ---------- |
| **阶段 0** | 包骨架：工具链 / 类型契约 / 样式 / demo / CI / README | 0.5        | 完成       |
| **阶段 1** | core：几何 / 文档加载 / 缓存 / 选区 / 搜索 / 状态容器 | 4–5        | 完成       |
| **阶段 2** | React 层：hooks / 组件 / i18n / 真实 PDF 联调 / E2E   | 6–8        | 完成       |
| **阶段 4** | P1 增强：文本层 / 缩略图 / 目录 / 搜索面板 / 链接层   | 3–4        | 完成       |
| **阶段 5** | 发布基建：体积门禁 / publint / attw / changesets / CI | 2          | 完成       |
| **阶段 3** | 主项目集成 + 性能收口                                 | 4–6        | ⏸ 按需进行 |
| 合计       | 已完成部分                                            | **≈16–21** | —          |

### 阶段 3（主项目迁移）说明

包已具备迁移所需的全部能力（受控 props + 事件回调 + 归一化坐标）。
迁移属于**宿主侧工作**：主项目在包外写 adapter 接入自己的 API 与业务，
包不为此做任何妥协。若后续进行，参考 `README.md` 的"宿主接线"章节。

---

## 14. 风险与退路

| 风险                        | 等级         | 退路                                        |
| --------------------------- | ------------ | ------------------------------------------- |
| pdfjs-dist 6 出现兼容问题   | 中           | 降级 ^5.3                                   |
| TS 7 生态未就绪             | 低（已实测） | 维持 5.9，revisit 触发：tsup 支持 TS 6+ API |
| 虚拟化在超长文档掉帧        | 中           | 收紧 rootMargin、降 DPR、文本层更懒         |
| 选区在复杂排版 PDF 边界不准 | 中           | 以 pdf.js 文本层为准，golden 样张覆盖       |
| 体积超预算                  | 低           | pdfjs 外部化（已如此），core 保持无框架依赖 |

---

## 15. 决策摘要（逐条可讲）

| #   | 决策                                 | 取舍                                                                      |
| --- | ------------------------------------ | ------------------------------------------------------------------------- |
| 1   | **只做 PDF，业务全在外面**           | 通用性换"开箱即用"——换后端/换产品零改动                                   |
| 2   | **受控 props + 事件，不用注入接口**  | 少一层抽象，宿主心智负担最小（v1 的 StorageAdapter/PopoverAction 已取消） |
| 3   | **pdfjs 直连，不用 react-pdf**       | 版本自主 + 不被封装层绑架                                                 |
| 4   | **core 零 React**                    | 任何环境可用 + 单测便宜                                                   |
| 5   | **坐标三空间 + 纯函数换算 + golden** | 缩放无关性是硬需求，精度不能靠"看起来对"                                  |
| 6   | **viewport 永不变异**                | 主项目漂移 bug 的根因                                                     |
| 7   | **裸 CSS + CSS 变量**                | 零构建约束 + 主题可换                                                     |
| 8   | **每实例 store，零状态库**           | 多实例隔离 + 少一个依赖                                                   |
| 9   | **TS 5.9 而非 7**                    | 工具链未就绪，实测为准                                                    |
| 10  | **只用 2 个运行时依赖**              | 轻便可控                                                                  |
| 11  | **缓存只存文档字节**                 | 渲染结果与缩放强相关，缓存收益低复杂度高                                  |
| 12  | **错误码体系化（12 条）**            | 宿主可据此做重试/降级，而不是 catch 一个 Error                            |
