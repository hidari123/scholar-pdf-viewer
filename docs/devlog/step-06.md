# 第 6 步：core 公共类型模型（API 契约）（2026-10-30） / 阶段 1 · 第 6 步：core/store —— 每实例状态容器（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

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

**【阶段 1 更正】以上两条判断均有误**

- 上一条"同名共存是标准模式"不成立：同名文件与同名目录共存时，`src/core.ts` 里 `export * from './core'` 会**解析到它自己**（同名文件优先于同名目录）→ 自引用 → 类型模型与运行时导出**全部没进产物**（`dist/core.d.ts` = `export {}`，`dist/index.d.ts` 只剩 VERSION）。已在阶段 1 · 第 1 步修复：删 `src/core.ts`，tsup entry 指向 `src/core/index.ts`，引用改显式路径 `'./core/index'`
- "空模块属正常"的真实原因不是"契约全是类型"，而是上面的自引用。修复后 `dist/core.js` 导出 6 个函数、`dist/core.d.ts` 6.03KB（含完整类型模型）

**验证**
- `pnpm test` → 4 passed（含 core 子路径 import）
- `pnpm build` → dist 12 个文件（2 入口 × 4 产物 + 4 maps）；`dist/core.js` 为空模块
- node 直接 import `dist/index.js` 与 `dist/core.js` 均成功
- `pnpm typecheck` 通过

---

---

## 阶段 1 · 第 6 步：core/store —— 每实例状态容器（2026-11-13）

**做了什么**
- `src/core/store/instance.ts`：`createStore()`（纯 TS 容器）+ `createViewerStore()` + `ViewerState` + `anchoredScrollTop()` + `findCurrentPage()`
- `src/core/store/instance.test.ts`：17 例
- `src/core/index.ts`：出口接线

**为什么这么实现**
- **自己写而不用 valtio/zustand**：包不该给宿主强加运行时依赖（一个 PDF 查看器不值得拖一个状态库）；`useSyncExternalStore` 是 React 官方方案，够用
- **每实例一份 state**：多个查看器互不干扰（主项目有"主视图 + 缩略图预览"的需求）
- **`setState` 无变化不通知**：避免无谓重渲染（React 的重渲染代价不低）
- **通知时遍历快照**：监听器可能在回调里取消订阅 → 遍历活着的 Set 会出问题
- **`anchoredScrollTop` 抽成纯函数**：缩放锚点保持是"缩放不跳动"的核心，纯函数可单测（渲染层只负责读滚动位置）
- **`findCurrentPage` 用二分**：主项目原实现每次滚动全量遍历所有页 → 长文档卡顿；页顶边数组是单调的 → 二分 O(log n)

**遇到的问题**
1. **`findCurrentPage` 会返回"不存在的第 N 页"**：页顶边数组的最后一项是**文档总高的哨兵**，二分命中它 → 返回 `页数+1`
   - 修复：用 `Math.min(..., pageTops.length - 1)` 夹到真实页数
   - 教训：**哨兵值要显式处理**，否则它会漏进业务结果
2. **`anchoredScrollTop` 的测试期望值算错**（期望 150 / 0，实际 250 / 25）
   - 重新推导：内容坐标 c = (scrollTop + anchorY) / scaleBefore；新 scrollTop = c × scaleAfter − anchorY = 250 / 25 —— **实现是对的，测试的算术错了**
   - 教训：断言写错和实现写错要分清；这里先推导公式再对答案，而不是"看着不对就改实现"

**验证**
- `pnpm test`：101 passed
- `pnpm verify` 5 gate 全绿

---
