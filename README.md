<!--
 * @Author: hidari
 * @Date: 2026-10-30 16:58:10
 * @LastEditors: hidari
 * @LastEditTime: 2026-10-30 16:58:17
 * Copyright (c) 2026 by hidari, All Rights Reserved.
 -->

# @scholar-club/pdf-viewer

轻量、可主题化、**零 LLM 依赖**的 PDF 查看器组件。pdfjs-dist 6 直连，兼容 React 18/19，SSR 安全，零 UI 库。

> 当前阶段 0：包骨架 + 公共类型契约 + 构建/测试/CI 管线。`<PdfViewer>` 组件阶段 2 交付。

## 设计原则（硬约束）

| 原则       | 说明                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| 零 LLM     | 无模型、无 agent、无 AI API；"解释/问答/翻译"是宿主业务，经 `PopoverAction` 注入                   |
| 零 antd    | 包 / demo / 集成层均不使用；样式为自制 ~12KB CSS（`scpdf-` 前缀 + CSS 变量主题）                   |
| 零业务 API | 包永不请求宿主后端；数据经 `StorageAdapter` 与 props 注入                                          |
| SSR 安全   | core 层零 React、零顶层 DOM 访问；任何框架（含 Next.js）可 import（有测试守卫）                    |
| wire 兼容  | 高亮 / bbox 与既有后端格式同构（`NormRect` ≙ `ScaledPosition`、`BboxData` 零转换），存量数据零改动 |

## 安装

```sh
pnpm add @scholar-club/pdf-viewer
```

Peer：`react >=18 <20`（由宿主提供）。

（尚未发布 npm；主项目集成阶段以本地包引入，发布配置已就绪：`files` / `exports` / `packageManager`。）

## 三条消费契约

```js
// 1. 主入口：公共类型 + VERSION（组件 <PdfViewer> 阶段 2 加入）
import { VERSION } from '@scholar-club/pdf-viewer';

// 2. core 子路径：零 React，Node / Worker 可用
import type { SelectionData, StorageAdapter } from '@scholar-club/pdf-viewer/core';

// 3. 样式：包不注入样式，消费者自行 import（或 CDN 直引）
import '@scholar-club/pdf-viewer/styles.css';
```

## 主题（CSS 变量）

| 变量                                    | 默认值                      | 用途       |
| --------------------------------------- | --------------------------- | ---------- |
| `--scpdf-color-primary`                 | `#2f54eb`                   | 主题色     |
| `--scpdf-highlight-my`                  | `#fff3bf`                   | 我的高亮   |
| `--scpdf-highlight-others`              | `#d6e4ff`                   | 他人高亮   |
| `--scpdf-highlight-active`              | `#2f54eb`                   | 选中态高亮 |
| `--scpdf-bbox-color`                    | `#2f54eb`                   | AI bbox 框 |
| `--scpdf-shadow-page`                   | `0 2px 8px rgba(0,0,0,.12)` | 页面阴影   |
| `--scpdf-motion-fast` / `base` / `slow` | `120/200/320ms`             | 动效时长   |

完整清单（15 个）见 `src/styles/viewer.css`。宿主覆盖变量即融入自家设计系统：

```css
:root {
  --scpdf-color-primary: #fa541c;
}
```

## 宿主接入（数据注入，零业务）

```ts
import type { StorageAdapter } from '@scholar-club/pdf-viewer/core';

// 宿主实现该接口接自家后端（主项目实现见其 src/adapters/pdf-storage.ts）
const storage: StorageAdapter = {
  async load(docId) {
    return fetchNotes(docId); // GET 笔记列表
  },
  async create(docId, h) {
    await createNote(docId, h); // POST /note
  },
  async update(docId, h) {
    await updateNote(docId, h); // PUT /note/:uuid
  },
  async remove(docId, id, opts) {
    // opts.withNote: true = 整条笔记删除; false = 仅移除高亮色
    await removeNote(docId, id, opts); // DEL
  },
};
```

## 错误码

| code                   | 含义                            |
| ---------------------- | ------------------------------- |
| `E_LOAD_HTTP`          | HTTP 状态错误（4xx/5xx）        |
| `E_LOAD_NETWORK`       | 网络不可达                      |
| `E_PDF_INVALID`        | 文件不是有效 PDF                |
| `E_EMPTY`              | PDF 0 页                        |
| `E_PDF_ENCRYPTED`      | 加密且未提供密码                |
| `E_PDF_PASSWORD_WRONG` | 密码错误                        |
| `E_RENDER_PAGE`        | 某页渲染失败（带 `pageNumber`） |
| `E_LINK_INVALID`       | PDF 链接目标非法                |
| `E_CACHE_QUOTA`        | IndexedDB 缓存配额超限          |

## 坐标三空间（wire 兼容）

- **PDF 点**（72dpi，原点左下，y 向上）——后端 `BboxData`
- **归一化 0–1**（`NormRect`，与后端 `ScaledPosition` 同构）——持久化
- **视口 px**——渲染

包对后端格式零转换，存量数据原样读写。

## 开发

```sh
pnpm install
pnpm verify   # 质量门禁：lint + typecheck + test + build + demo typecheck（与 CI 同一脚本）
pnpm demo     # 启动 demo（消费 dist 产物，真实消费者路径）
```

工作区布局：根 = 包本体；`demo/` = 消费者（Vite 8 + React 19，零 antd）。

## Roadmap

- [x] 阶段 0：包骨架（构建 / 测试 / CI / 类型契约 / 样式 / demo）
- [ ] 阶段 1：core（坐标换算 / 选区 / 高亮 wire / IndexedDB 缓存 / 文档加载 / 搜索）
- [ ] 阶段 2：`<PdfViewer>` 组件（渲染 / 虚拟化 / 工具栏 / 弹层 / 主题）
- [ ] 阶段 3：主项目集成（PageCom → 本包迁移）

## License

MIT
