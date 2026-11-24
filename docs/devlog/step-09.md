# 第 9 步：CI — GitHub Actions（2026-10-30）

> 本轮记录已从 `DEVLOG.md` 拆出。

## 第 9 步：CI — GitHub Actions（2026-10-30）

**做了什么**
- `.github/workflows/ci.yml`，两个 job：
  - `verify`：主管线 = `pnpm verify`（与本地同一个脚本）
  - `react-matrix`：demo 在 react 18 / 19 下都能 typecheck + vite build（持续验证 peer 范围 `>=18 <20`）
- 触发：push main + PR；`concurrency` 同分支只留最新一次

**为什么这么实现**
- CI 跑 `pnpm verify` 而不是列步骤：门禁清单单一事实源（scripts/verify.mjs），加/改门禁 = 改一个文件，"本地绿 = CI 绿"结构上成立
- `--frozen-lockfile`：CI 必须装 lockfile 记录的那棵树（deps 表达意图、lockfile 表达事实）；有分歧 = lockfile 过期或有人装完没提交
- 为什么有 react 矩阵：peer 范围是写进 package.json 的对消费者承诺，"18 也能用"必须由机器持续证明。阶段 0 矩阵成本低（只有类型 + demo），阶段 2 组件（hooks）落地后同一矩阵自动覆盖 react 18/19 的类型与 hook 行为差异——提前铺好，到时候零成本
- 矩阵 job 先跑根 build：demo 消费 dist（保真纪律），CI 全新 checkout 没有 dist
- Node 24：最新 LTS 线，且在 `engines: node>=22.13` 声明的范围内
- yml 本身即交付物：推送到 GitHub 远端后自动生效

**验证**
- 本地：`pnpm verify` 全绿；react 矩阵本地模拟通过（demo 换装 react@18 → typecheck + build 绿 → 换回 19，`git restore pnpm-lock.yaml demo/package.json` + `pnpm install` 还原基线）
- GitHub 侧：推送到远端后首跑确认两个 job 全绿

---
