# npm Access Token 填写指南

生成用于发布 `@scholar-space/pdf-viewer` 的 npm 细粒度访问令牌（Granular Access Token）。

| 项目     | 值                                                      |
|----------|---------------------------------------------------------|
| 目标包   | `@scholar-space/pdf-viewer`                             |
| 页面地址 | https://www.npmjs.com/settings/你的用户名/access-tokens |
| 权限要求 | Read and write (publish and stage)                      |
| 有效期   | 90 天（推荐）                                           |

---

## 填写前的准备

开始之前确认这两件事：

- [ ] npm 组织 `scholar-space` 已创建，且组织邮箱已完成验证
- [ ] 已登录 npm 账号，打开的是**自己的账号设置页**（不是组织页）

> 如果组织还没建好，见 PUBLISHING.md 第 1 步。

---

## 一、General（通用）

页面上第一个区域。

| 字段                  | 填写内容                         | 说明                                     |
|-----------------------|----------------------------------|------------------------------------------|
| **Token name**        | `scholar-pdf-viewer-publish`     | 自定义名称，只在列表里显示，方便日后识别 |
| **Description**       | `发布 @scholar-space/pdf-viewer` | 可留空，填了便于日后辨认用途             |
| **Allowed IP ranges** | **留空**                         | 见下方说明                               |

> **Allowed IP ranges 为什么必须留空**
>
> 填了具体 IP 之后，发布请求只能从这个 IP 发出。换网络（家里 / 公司 / 咖啡厅 / 手机热点）就无法发布。
>
> 如果确实需要限制 IP：走 PUBLISHING.md 的路径 A（GitHub Actions），但 GitHub 托管 runner 的出口 IP 不固定，实际仍需留空。

---

## 二、Packages and scopes（包和 scope）

### 2.1 权限等级

**Packages and scopes** 区域里，把 **Permissions** 设为：

```text
Read and write (publish and stage)
```

| 选项                                   | 能否发布 | 说明                 |
|----------------------------------------|----------|----------------------|
| **No access**                          | 否       | 完全没有该包的权限   |
| **Read only**                          | 否       | 只能读，发包时报 403 |
| **Read and write (publish and stage)** | **是**   | **选定此项**         |

### 2.2 勾选目标包

在权限下方的搜索框中输入：

```text
@scholar-space/pdf-viewer
```

从下拉结果中勾选它。

**如果搜索不到这个包名：**

| 可能原因             | 处理方式                                      |
|----------------------|-----------------------------------------------|
| 组织还没建好         | 回 PUBLISHING.md 第 1 步创建组织              |
| 组织邮箱还没验证     | 打开邮箱点击 npm 的验证链接                   |
| 只是想先发一个包试试 | 勾选 **All packages**，之后可再回来调整 token |

---

## 三、Organizations（组织）

| 字段             | 填写内容             | 是否必需       |
|------------------|----------------------|----------------|
| **Organization** | 选择 `scholar-space` | 手动发布可留空 |
| **Permissions**  | `Read and write`     | 手动发布可留空 |

**这条权限是给 GitHub Actions 自动发版用的。** 如果你只打算在本地手动发布，这两栏可以留空；如果要用自动发版 workflow，请设置成 `Read and write`。

---

## 四、Expiration（过期时间）

| 选项  | 建议   | 说明                       |
|-------|--------|----------------------------|
| 7 天  | 不要选 | 一周就要重新生成，过于繁琐 |
| 30 天 | 可用   | 短期项目适用               |
| 90 天 | 推荐   | 兼顾安全与省事             |
| 1 年  | 最省事 | 适合稳定维护的包           |

选 **90 天**。到期后在 npm 页面重新生成一个即可，原 token 自动失效，不影响已发布的包。

---

## 五、生成与保存

1. 滚到页面底部，点 **Generate token**
2. 弹窗显示完整 token 字符串，**只显示这一次**
3. **立刻复制**，保存到密码管理器
4. 关闭弹窗

> 关闭后无法再次查看这个 token。如果丢了，重新生成一个并更新 GitHub Secret。

---

## 六、确认权限正确

生成后在页面的 **Summary** 区域确认显示内容如下：

```text
This token will:
  - Read and write (publish and stage) to @scholar-space/pdf-viewer
  - Read and write to scholar-space (organization)
```

如果显示 **No access**，说明第二步选错了，回到第二步重新生成。

---

## 七、token 的两个用途

### 用途 1：手动发布

在本地写入认证信息：

```bash
npm config set //registry.npmjs.org/:_authToken <你的 token>
```

验证：

```bash
npm whoami --registry=https://registry.npmjs.org
```

应输出你的 npm 用户名。

### 用途 2：GitHub Actions 自动发版

把 token 存进仓库 Secret：

1. 打开仓库 **Settings → Secrets and variables → Actions**
2. 点 **New repository secret**
3. **Name** 填 `NPM_TOKEN`（大小写敏感）
4. **Secret** 粘贴 token
5. 点 **Add secret**

工作流 `.github/workflows/release.yml` 通过这个 Secret 发包：

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

---

## 八、发布时使用 token

### 手动发布

```bash
pnpm publish --registry=https://registry.npmjs.org
```

### 自动发布

```bash
pnpm changeset
git add .changeset/
git commit -m "chore: 添加 changeset"
git push origin main
```

推送后 GitHub Actions 自动完成升版本、打 tag、发包。详细流程见 PUBLISHING.md 第 3 步。

---

## 九、常见问题

| 现象                       | 原因                         | 处理                                                |
|----------------------------|------------------------------|-----------------------------------------------------|
| 发布时报 **403**           | 权限是 Read only / No access | 重新生成，权限选 Read and write (publish and stage) |
| 搜索框搜不到包名           | 组织未创建或邮箱未验证       | 完成组织创建和邮箱验证                              |
| 换了网络就发不了           | 填了 Allowed IP ranges       | 重新生成 token，IP 留空                             |
| 报 **401**                 | token 过期或被撤销           | 重新生成 token                                      |
| 显示 "No access"           | 第二步权限选错               | 重新生成并检查第二步                                |
| 自动发版 workflow 报权限错 | Secret 名字写错              | Secret 名必须是 `NPM_TOKEN`                         |
