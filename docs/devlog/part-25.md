# 收官：README 重写 + PLAN 更新 + 全量复跑（2026-11-13）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 收官：README 重写 + PLAN 更新 + 全量复跑（2026-11-13）

**做了什么**
- `README.md` **整体重写**：v1 的 `StorageAdapter` / `PopoverAction` / `BboxData` 全部移除，
  改为 v2 的真实 API（受控 props + 事件回调 + 宿主接线示例 + 能力清单 + 坐标三空间 + 12 错误码）
- `PLAN.md` §13 里程碑表更新为实际完成状态（阶段 0/1/2/4/5，阶段 3 按需进行）
- `tests/readme-example.test.tsx`：**README 示例的可编译性测试**
  - README 是用户看到的第一份契约，示例编译不过 = 用户第一步就卡住 → 用测试锁住

**遇到的问题**
1. **README 里写错了错误码**：凭记忆写的是 `E_LOAD_ABORTED` / `E_RENDER_CANCELLED` /
   `E_INTERACTION`，实际是 `E_LOAD_TIMEOUT` / `E_FONT_MISSING` / `E_LINK_INVALID` 等
   - 修复：以 `src/core/errors.ts` 为准逐个核对
   - 教训：**文档里的枚举值必须对着源码核**，凭记忆写必错
2. **CSS 变量数量写错**：写了 27（把暗色主题的重复定义也算进去了）→ 实际 `:root` 下 15 个
   - 修复：数 `:root` 块内的定义
3. **biome 报"不要在函数内定义组件"**：README 测试里把 `Reader` 组件写在 `it()` 内部
   - 修复：提到模块级
   - 教训：**每次渲染重建组件**会丢状态（这里是无意，但也是真实性能问题）

**最终验证（全量）**
- `pnpm verify`：**8 门禁全绿**
  （lint / typecheck / test / build / demo:typecheck / size / publint / attw）
- `pnpm test`：**229 passed**（19 个测试文件）
- E2E（真 Chromium，真实 PDF 18 页）：
  - `e2e-smoke` 13/13 · `e2e-text-layer` 7/7 · `e2e-panels` 12/12 · `e2e-links` 5/5
  - **合计 37 项断言全通过**
- E2E（合成样张，CI 场景）：13/13 · 7/7 · 8/8 · 4/4 → **CI 可跑**
- 包体积：主入口 **11.74 kB** / core 1.15 kB / CSS 11.7 kB
- attw：node10 / node16(CJS+ESM) / bundler 全 🟢

**交付清单（15 个提交）**
```
49d5787 阶段 0  包骨架
2ea055e 阶段 1  geometry
516c470 阶段 1  document loader + errors
db84146 阶段 1  cache
d1ec0af 阶段 1  selection
7092e8b 阶段 1  search
b22b125 阶段 1  store
6386b20 阶段 2  hooks
5fd37fd 阶段 2  components
46d823f 阶段 2  demo 真实接入 + E2E
e4eaa7c 阶段 4  text-layer
b82941a 阶段 4  样张不入库
72eb1b6 阶段 4  三个面板
33d151a 阶段 4  链接层 + 密码框
809286f 阶段 5  发布基建
```

**遗留 / 可选**
- 阶段 3（主项目迁移）：按用户要求暂不进行；包已具备迁移所需能力
- AcroForm 表单填写：未实现（不在 P0/P1 范围）
- 印刷级分页（print CSS）：未实现（`onPrint` 走浏览器原生打印）

---
