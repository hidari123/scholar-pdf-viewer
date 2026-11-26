# 发布到 npm 的操作手册

本手册说明如何把 `@scholar-space/pdf-viewer` 发布到 npm 公共 registry。

| 项目          | 值                                              |
| ------------- | ----------------------------------------------- |
| 包名          | `@scholar-space/pdf-viewer`                     |
| 仓库          | https://github.com/hidari123/scholar-pdf-viewer |
| 公共 registry | `https://registry.npmjs.org`                    |
| 权限模型      | Public（包名唯一，创建后永久占用）              |
| Node 版本     | `>= 22.13.0`                                    |
| 包管理器      | `pnpm@10.32.1`                                  |

---

## 0. 整体流程

发布分两条路径，选一条走即可。

**路径 A —— 走 GitHub Actions（推荐）**

你只需要做两件事：创建 npm 组织、生成 token 并配置成 GitHub Secret。之后每次发版只要在仓库里写一个 changeset 并推送，流水线自动完成升版本、打 tag、发包。

```text
你                          GitHub Actions                  npm
│                           ─────────────                   ───
├─ 1. 创建 npm 组织 ───────▶│
├─ 2. 生成 token ──────────▶│
├─ 3. 配成 Secret NPM_TOKEN ▶│
│                            ├─ pnpm verify（门禁）
│                            ├─ pnpm build
│                            ├─ changeset version（升版本 + 写 CHANGELOG）
│                            ├─ 提交版本号 + 打 tag ──────▶│
│                            ├─ pnpm release:check（复检）
│                            └─ pnpm release ─────────────▶├─ 包上线
│                                                          └─ npm view 验证
```

**路径 B —— 本地手动发版**

适合第一次发包、或者需要临时补发某个版本。

```text
你
├─ 1. 创建 npm 组织
├─ 2. 生成 token
├─ 3. 本地 npm login
├─ 4. pnpm verify（门禁）
├─ 5. pnpm changeset version（升版本 + 写 CHANGELOG）
├─ 6. pnpm publish --registry=https://registry.npmjs.org
└─ 7. npm view 验证
```

两条路径的第 1、2 步完全相同，先做完这两步。

---

## 1. 创建 npm 组织（scope 归属）

包名里的 `@scholar-space` 是 **scope**，必须先在 npm 上拥有这个 scope，否则无法发布。

### 1.1 确认 scope 是否可用

在浏览器打开：

```text
https://www.npmjs.com/org/scholar-space
```

| 页面结果   | 含义                       | 下一步            |
| ---------- | -------------------------- | ----------------- |
| 404 / 空白 | scope 尚未被占用，可以使用 | 继续 1.2          |
| 已有组织页 | scope 已被占用             | 换 scope 名，见下 |

如果 `@scholar-space` 已被他人占用，改用其它名称，并同步修改 `package.json` 的 `name` 字段。注意 `name` 一旦发布到 npm 就**无法更改**，发布前务必确认。

### 1.2 创建组织

1. 打开 https://www.npmjs.com/org/create
2. 点 **Create a new organization**
3. 选择登录方式：
   - **用 GitHub 登录**（推荐，与仓库同一账号，便于日后协作）
   - 或用 npm 账号 + 邮箱
4. **Organization username** 填 `scholar-space`（**全小写**，不可用空格，不能含特殊字符）
5. **Organization email** 填你的常用邮箱，用于接收组织相关通知
6. 勾选同意条款，点 **Create organization**
7. 创建成功后，npm 会向该邮箱发送验证邮件，**点击邮件里的链接完成验证**

> **免费组织说明**：npm 公共组织本身不收费，公开包（public）免费发布。私有包（private）才需要付费订阅。

---

## 2. 生成 npm Access Token

npm 现在使用 Granular Access Token（细粒度访问令牌），替代了旧的 Classic Token。

### 2.1 进入 token 页面

```text
https://www.npmjs.com/settings/<你的用户名>/access-tokens
```

### 2.2 填写 General 区域

| 字段                  | 填写内容                         |
| --------------------- | -------------------------------- |
| **Token name**        | `scholar-pdf-viewer-publish`     |
| **Description**       | `发布 @scholar-space/pdf-viewer` |
| **Allowed IP ranges** | **留空**                         |

> **Allowed IP ranges 必须留空**。填了具体 IP 之后，换网络（家庭 / 公司 / 咖啡厅 / CI 出口 IP）就无法发布。若安全策略要求限定 IP，请改走路径 A 并使用 GitHub Actions（GitHub 托管 runner 的出口 IP 不固定，仍需留空）。

### 2.3 填写 Packages and scopes 区域

| 字段                               | 设置                                   |
| ---------------------------------- | -------------------------------------- |
| **Packages and scopes permission** | **Read and write (publish and stage)** |

在该区域的搜索框中输入并勾选：

```text
@scholar-space/pdf-viewer
```

如果搜索不到这个包名，说明组织还没建好或还没验证，请回到第 1 步。此时可以先选择 **All packages**，等组织就绪后再回来调整 token 权限。

> 权限必须是 **Read and write (publish and stage)**。
> **No access** 和 **Read only** 都会导致发布时返回 403。

### 2.4 填写 Organizations 区域（可选）

| 字段             | 设置                 |
| ---------------- | -------------------- |
| **Organization** | 选择 `scholar-space` |
| **Permissions**  | **Read and write**   |

这条权限是给 **GitHub Actions 自动发版** 用的。纯手动发布的场景可以留空。

### 2.5 设置 Expiration（有效期）

| 选项  | 建议   | 说明                       |
| ----- | ------ | -------------------------- |
| 7 天  | 不要选 | 一周就要重新生成，过于繁琐 |
| 30 天 | 可用   | 短期项目适用               |
| 90 天 | 推荐   | 兼顾安全与省事             |
| 1 年  | 最省事 | 适合稳定维护的包           |

过期后在 npm 页面重新生成一个即可，原 token 会自动失效。

### 2.6 生成并立即保存

1. 滚到页面底部，点 **Generate token**
2. **token 只显示这一次**，弹出的窗口会展示完整 token 字符串
3. **立刻复制并保存到密码管理器**，关闭窗口后无法再次查看

生成后可以立刻校验权限是否正确。页面下方 **Summary** 区域应显示：

```text
This token will:
  - Read and write (publish and stage) to @scholar-space/pdf-viewer
  - Read and write to scholar-space (organization)
```

如果显示 **No access**，说明上一步选错了，回退检查 2.3 和 2.4。

---

## 3. 路径 A：配置 GitHub Actions 自动发版

### 3.1 在仓库添加 Secret

1. 打开仓库 **Settings → Secrets and variables → Actions**
2. 点 **New repository secret**
3. **Name** 填 `NPM_TOKEN`
4. **Secret** 粘贴第 2 步复制的 token
5. 点 **Add secret**

工作流文件 `.github/workflows/release.yml` 已经读取这个 Secret：

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 3.2 触发一次发布

在仓库根目录执行：

```bash
pnpm changeset
```

命令会进入交互式编辑器，依次填写：

| 提问     | 填写内容                        |
| -------- | ------------------------------- |
| 包名     | `@scholar-space/pdf-viewer`     |
| 变更类型 | `minor`（或 `patch` / `major`） |
| 变更摘要 | 一句话描述本次改动              |

执行后会在 `.changeset/` 下生成一个随机命名的 markdown 文件，例如 `.changeset/tidy-pans-shake.md`：

```markdown
---

## '@scholar-space/pdf-viewer': minor

修复选区跨页高亮位置偏移问题
```

提交并推送：

```bash
git add .changeset/
git commit -m "chore: 添加 changeset"
git push origin main
```

### 3.3 工作流自动执行

`.github/workflows/release.yml` 监听到 `.changeset/**` 变化后自动触发，依次执行：

| 阶段        | 动作                                                              |
| ----------- | ----------------------------------------------------------------- |
| **version** | `pnpm install` → `pnpm verify` → `pnpm build`                     |
|             | → `pnpm changeset version`（改 package.json + 生成 CHANGELOG.md） |
|             | → 提交版本号和 CHANGELOG 回 `main` → 推送 tag                     |
| **publish** | `pnpm install` → `pnpm build` → `pnpm release:check`              |
|             | → `pnpm release`（实际发包）                                      |
|             | → `npm view` 确认版本已上线                                       |

在仓库 **Actions** 标签页可以看到这次运行的实时日志。

> **纯文档改动不会发包**。工作流通过 `changeset version` 的输出来判断版本号是否真的变了，没变就跳过 publish 步骤。

### 3.4 验证发布结果

```bash
npm view @scholar-space/pdf-viewer versions
```

应能看到新版本号。再确认安装可用：

```bash
npm view @scholar-space/pdf-viewer@latest version
```

---

## 4. 路径 B：本地手动发版

### 4.1 登录 npm

```bash
npm login --registry=https://registry.npmjs.org
```

浏览器会打开授权页，确认授权后终端会显示登录成功。

### 4.2 配置 token（可选）

`npm login` 会在本地用户目录写入认证信息，通常无需重复配置 token。若想显式写入：

```bash
npm config set //registry.npmjs.org/:_authToken <你的 token>
```

验证：

```bash
npm whoami --registry=https://registry.npmjs.org
```

应输出你的 npm 用户名。

### 4.3 跑质量门禁

```bash
pnpm install
pnpm verify
```

`pnpm verify` 是发布门禁总入口，按顺序执行下列检查，任意一项失败即中止并返回非零退出码：

| 序号 | 检查项         | 实际命令                     | 作用                        |
| ---- | -------------- | ---------------------------- | --------------------------- |
| 1    | lint           | `pnpm run lint`              | Biome 代码规范              |
| 2    | typecheck      | `pnpm run typecheck`         | TypeScript 类型检查         |
| 3    | test           | `pnpm run test`              | Vitest 单元测试             |
| 4    | coverage       | `pnpm run test:coverage`     | 覆盖率下限校验              |
| 5    | build          | `pnpm run build`             | 构建产物到 `dist/`          |
| 6    | demo:typecheck | `pnpm -C demo run typecheck` | 示例工程类型检查            |
| 7    | size           | `pnpm run size`              | 包体积上限校验              |
| 8    | publint        | `pnpm run publint`           | package.json / 包结构规范   |
| 9    | attw           | `pnpm run attw`              | 类型解析正确性（ESM / CJS） |

全绿时最后一行输出：

```text
[verify] ✓ 全绿：lint + typecheck + test + build + demo typecheck + size + publint + attw
```

> **这一步不能跳过**。npm 上已发布的版本无法撤回，坏包一旦发出只能再发一个新版本号修复。

### 4.4 升版本并生成 CHANGELOG

```bash
pnpm changeset version
```

此命令会：读取 `.changeset/` 下的所有 changeset、累加版本号、写入 `CHANGELOG.md`、删除已消费的 changeset 文件。

检查改动：

```bash
git diff package.json CHANGELOG.md
```

确认版本号递增正确后提交：

```bash
git add package.json CHANGELOG.md pnpm-lock.yaml
git commit -m "chore: 版本发布"
git push origin main --follow-tags
```

### 4.5 发布

```bash
pnpm publish --registry=https://registry.npmjs.org
```

`--registry` 参数必须显式指定，否则可能发到国内镜像源。

发布前会再跑一次 `release:check`（`size` + `publint` + `attw`）：

```bash
pnpm release:check
```

### 4.6 验证发布结果

```bash
npm view @scholar-space/pdf-viewer@latest version
```

或者在浏览器打开：

```text
https://www.npmjs.com/package/@scholar-space/pdf-viewer
```

---

## 5. 常见问题排查

### 5.1 发布返回 403

| 原因                        | 解决办法                                                            |
| --------------------------- | ------------------------------------------------------------------- |
| token 权限是 **Read only**  | 重新生成 token，权限选 **Read and write (publish and stage)**       |
| token 的包范围没勾选目标包  | 重新生成 token，在搜索框勾选 `@scholar-space/pdf-viewer`            |
| npm 账号不是 scope 的拥有者 | 确认用组织 owner 账号登录，或在 token 里给 `scholar-space` 组织授权 |
| 2FA 过期未续期              | 重新完成 2FA 验证                                                   |

### 5.2 报 E403 或搜不到包名

npm 上还没有 `@scholar-space` 这个 scope，或者组织邮箱未验证。回到第 1 步完成组织创建和邮箱验证。

### 5.3 报 "用错了 registry"

发到了国内镜像源。重新发布时加上：

```bash
pnpm publish --registry=https://registry.npmjs.org
```

### 5.4 提示版本号已存在

npm 不允许重复发布同一版本号。先升版本：

```bash
pnpm changeset version
```

或手动修改 `package.json` 的 `version` 字段后再发。

### 5.5 提示 name 已存在

`@scholar-space/pdf-viewer` 这个包名已经被占用。换一个名字，并同步修改 `package.json` 的 `name`。注意：**包名一旦发布就永久占用，无法回收**。

### 5.6 报 401 / token 无效

token 过期或被撤销。回到第 2 步重新生成。

### 5.7 GitHub Actions 发版没反应

| 检查项              | 排查方式                                                |
| ------------------- | ------------------------------------------------------- |
| Secret 名字         | 必须严格是 `NPM_TOKEN`，大小写敏感                      |
| Changeset 文件格式  | 文件必须包含 frontmatter（`---` 包裹的包名 + 版本类型） |
| 提交是否推到 `main` | 工作流只监听 `main` 分支                                |
| 是否只有文档改动    | 纯文档改动不升版本，会被正常跳过（这是预期行为）        |

---

## 6. 发版检查清单

发布前逐项确认：

- [ ] npm 组织 `@scholar-space` 已创建，邮箱已验证
- [ ] token 权限为 **Read and write (publish and stage)**
- [ ] token 的包范围已勾选 `@scholar-space/pdf-viewer`
- [ ] token 未设置 Allowed IP ranges（留空）
- [ ] `pnpm verify` 全绿
- [ ] `package.json` 的 `name` / `version` 正确
- [ ] `publishConfig.registry` 为 `https://registry.npmjs.org`
- [ ] `CHANGELOG.md` 已生成且内容正确
- [ ] `npm view @scholar-space/pdf-viewer@latest version` 返回新版本号
