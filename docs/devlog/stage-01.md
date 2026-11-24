# 阶段 1 · 第 1.5 步：范围收窄 —— 确立"只做 PDF"的边界（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

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
