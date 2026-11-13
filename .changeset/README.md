# Changesets

本目录用 [changesets](https://github.com/changesets/changesets) 管理版本与变更日志。

## 日常开发

不需要手动改版本号。改动代码后写一条 changeset：

```bash
pnpm changeset
```

选包 → 选 bump 类型（patch / minor / major）→ 写一句人话描述 → 提交。

## 发版

```bash
pnpm changeset version   # 应用版本号 + 生成 CHANGELOG
pnpm changeset publish   # 发布到 npm
```

## 为什么用 changesets

- **一次发多个包时版本不会打架**（自动处理依赖关系）
- **CHANGELOG 自动生成**（不用手写）
- **改动和版本分离**：合并 PR 时不用纠结版本号
