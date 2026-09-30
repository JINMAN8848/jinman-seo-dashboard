# SEO Dashboard · 部署指南

> 本文档只描述部署到 Cloudflare Pages 的步骤。  
> 构建脚本本身是 0 依赖（纯 Node 18+ 内置 + 内联 SVG），无需 npm install。

---

## 1. 准备（一次性）

### 1.1 GitHub 仓库

建一个独立仓库，例如：

```
github.com/JINMAN8848/jinman-seo-dashboard
```

把当前 `F:\OpenClaw\workspace\seo-dashboard\` 整个目录推上去：

```powershell
cd F:\OpenClaw\workspace\seo-dashboard
git init
git remote add origin git@github.com:JINMAN8848/jinman-seo-dashboard.git
git add .
git commit -m "feat: initial seo dashboard scaffold"
git push -u origin main
```

> **不要**把 `F:\OpenClaw\workspace\seo-data\` 推进去。CSV 数据留本机，运行时读。

### 1.2 Cloudflare Pages 项目

1. 登录 [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Pages** → **Direct Upload** 暂时跳过（先建空项目）
2. 项目名：**jinman-seo-dashboard**（这个名硬编码在 `.github/workflows/dashboard-build.yml`，改的话同步改）
3. 拿到 **Account ID**（32 位 hex）→ 备用

### 1.3 GitHub Secrets

进仓库 → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**：

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | CF 控制台 → My Profile → API Tokens → Create Token → Edit Cloudflare Pages 模板 → 选 `jinman-seo-dashboard` 账户范围 |
| `CLOUDFLARE_ACCOUNT_ID` | 上面 1.2 拿到的 32 位 hex |

---

## 2. 首次部署

```powershell
cd F:\OpenClaw\workspace\seo-dashboard
git push origin main
```

GitHub Actions 会在 30-90 秒内：

1. checkout 仓库
2. 验证 `dist/index.html` 存在
3. 跑 `wrangler pages deploy dist --project-name=jinman-seo-dashboard`
4. CF Pages 部署完返回 URL：`https://jinman-seo-dashboard.pages.dev`

去 [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → jinman-seo-dashboard → 看 deployment 历史确认绿。

---

## 3. 自定义域名（可选）

CF Pages 项目 → **Custom domains** → **Set up a custom domain**：

- 主域：`seo.jinman-plastics.com.cn`（如果愿意分一个子域名）
- 或放本 CDN 上 `dash.jinman-plastics.com.cn`

DNS：CF 自动加 CNAME。

---

## 4. 数据刷新流程

cron 在周一 09:00 Asia/Shanghai 自动跑（仅 deploy 已提交的 dist，不重建）。  
数据刷新的真正节奏是 PowerShell 手动：

### 方案 A：每周手动（5 分钟）

```powershell
# 1. 确保 seo-data/ 有最新 CSV（来自 cron `Jinman SEO Monitor Weekly`）
# 2. 本地重建
cd F:\OpenClaw\workspace\seo-dashboard
node build.mjs
# 3. commit + push（触发 GitHub Actions 自动 deploy）
git add dist/index.html
git commit -m "chore: refresh dashboard data"
git push origin main
```

### 方案 B：半自动（AI 跑 build，您 PowerShell 跑 git）

在 `F:\OpenClaw\workspace\seo-dashboard\` 准备好后，告诉调度师"刷新 SEO dashboard"，AI 会：

1. 跑 `node build.mjs`
2. 生成 commit message
3. **不**直接 push（exec 没 GitHub write access + 避免 secrets 路径）

您 PowerShell 跑：

```powershell
cd F:\OpenClaw\workspace\seo-dashboard
git add dist/index.html
git commit -m "chore: refresh dashboard data"
git push origin main
```

→ GitHub Actions 自动 deploy 到 CF Pages。

---

## 5. 回滚

部署错乱？两个办法：

### 5.1 CF Pages 控制台回滚

1. dash.cloudflare.com → jinman-seo-dashboard → **Deployments**
2. 找到上一个绿 deployment → **...** → **Rollback to this deployment**

### 5.2 Git 回滚

```powershell
cd F:\OpenClaw\workspace\seo-dashboard
git log --oneline dist/index.html    # 找上一个绿 commit
git revert HEAD~1 -- dist/index.html
git push origin main                 # 触发自动 deploy
```

---

## 6. 红线

- ❌ **不**把 `F:\OpenClaw\workspace\seo-data\*.csv` 推到 GitHub（隐私 + 大文件）
- ❌ **不**在 workflow 里 echo secrets
- ❌ **不**改 CF Pages project name 而忘改 workflow（`jinman-seo-dashboard` 硬编码在 line 70）
- ❌ **不**加 Co-authored-by trailer（commit message 干净）
- ❌ **不**花美元 / 调 Tavily / 抓爬虫

---

## 7. 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| Action 红，403 | `CLOUDFLARE_API_TOKEN` 没权限 | CF 控制台 → API Tokens → 检查 scope 包含目标账户 |
| Action 红，401 | Token 过期或撤销 | 重新 Create Token，更新 GitHub Secret |
| `dist/index.html missing` | 仓库没 commit `dist/` | 本地跑 `node build.mjs` 后 `git add dist/` 提交 |
| CF Pages 部署成功，URL 404 | project name 不匹配 | 检查 `.github/workflows/dashboard-build.yml` line 70 的 `--project-name` |
| deploy 后 dashboard 还显示老数据 | CF 边缘缓存（HTML 5min）| 等 5 分钟或强制刷新 Ctrl+F5 |