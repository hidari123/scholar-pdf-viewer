# 第 18 轮（检查内置配置）

> 本轮记录已从 `DEVLOG.md` 拆出。

# 第 18 轮（检查内置配置）

## 用户需求

> "你看看是否高亮和语言都有内置配置了 没有的话加上
>  需要内置一些高亮选项 语言先内置中文和英文两种 这些都可以宿主再次配置"

## 排查：**确实有两个真问题**（不是"已经有了"，是"有但拿不到"）

### ① `core` 子路径拿不到内置的默认值 ❌

`src/core/config/index.ts` 是 `core` 子路径的出口，但它**没重新导出** `builtin-defaults`
-> 宿主 `import { BUILTIN_LOCALES } from '@scholar-club/pdf-viewer/core'` -> **undefined** ❌

实测：在页面里 `import('/node_modules/.../dist/core.js')` -> `hasBuiltinLocales: false`

-> **修法**：重新导出 ✅

### ② 内置的中文 / 英文不在同一张表里 ❌

-> `zh` / `en` 在 `MESSAGES` 里
-> `ja` / `fr` 在 `BUILTIN_LOCALES` 里
-> **两套地方** -> 宿主想覆盖中文里的某一句时，不知道该改哪里 ❌

-> **修法**：把 `zh` / `en` 也放进 `BUILTIN_LOCALES`（权威来源仍是 `MESSAGES`）
-> 内置语言和扩展语言的**处理方式完全一致** ✅

## 内置的高亮选项 6 -> 8 种

`yellow` `green` `blue` `pink` `purple` `orange` `cyan` `red`

-> 色板是 **6 列 grid** -> 8 种自动排两行，不会挤 ✅

## 优先级（不变）

- 色板：宿主传了 -> **完全覆盖**
- 语言表：宿主传了 -> **合并到内置的上面**（只覆盖某一句也行）

## 验证

- E2E（`scripts/e2e-builtin-config.mjs`，新）**12/12**
- 单元测试重写（`builtin-defaults.test.ts`）**28 项**
- `pnpm test` -> **582 passed**（47 files）
- `pnpm verify` -> **8/8 全绿**
- E2E -> **457/457 —— 0 个套件失败**（40 个套件）
- 提交：`9f93b3f`

---
