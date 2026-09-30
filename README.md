# SEO Dashboard · jinman-plastics.com.cn

> 自包含静态 HTML 控制台，零依赖、零 CDN、零外部 API。

## 用法

### 1. 构建（生成 `dist/index.html`）

```powershell
cd F:\OpenClaw\workspace\seo-dashboard
node build.mjs
```

输出 `dist/index.html`，可直接打开或部署。

### 2. 数据源

- 读 `F:\OpenClaw\workspace\seo-data\baidu-keyword-rank-YYYY-MM-DD.csv`
- 读 `F:\OpenClaw\workspace\seo-data\gsc-inspection-YYYY-MM-DD.csv`

CSV 由两个 PowerShell 脚本生成（`F:\OpenClaw\watchdog\seo-monitor.ps1`）：
- 百度站长平台 → `baidu-keyword-rank.ps1`（需 `BAIDU_TONGJI_*` env）
- GSC URL Inspection → `gsc-inspection.ps1`（需 `GOOGLE_APPLICATION_CREDENTIALS`）

### 3. 自动化路径（可选）

- 当前 cron 计划：Jinman SEO Monitor Weekly（2026/10/1 09:00 起跑）
- 跑通后：每周自动写 CSV → 老板 PowerShell 跑 `node build.mjs` → 推送 CF Pages

## 部署位置选项

| 方案 | 操作 | 自动化 | 详细 |
|---|---|---|---|
| **本机看** | `npx serve dist` 或 `python -m http.server -d dist 8765` | ❌ | - |
| **CF Pages 子项目** | 新建 `jinman-seo-dashboard` + 接 GitHub + workflow 自动 deploy | ✅ | [DEPLOY.md](./DEPLOY.md) |
| **主站 docs 路径** | 提交到主仓 `docs/seo-dashboard/`，CF Pages 不打子目录，**不推荐** | ❌ | - |

## 自动化架构（已就绪）

`.github/workflows/dashboard-build.yml`：

- **触发**：
  - `main` 分支 push（dist/index.html / build.mjs / template.html / workflow 改动）
  - 每周一 09:00 Asia/Shanghai cron（auto-deploy latest committed dist）
  - 手动 `workflow_dispatch`
- **行为**：wrangler pages deploy → CF Pages `jinman-seo-dashboard`
- **必需 GitHub Secrets**：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`

数据刷新节奏（手动，因为 `seo-data/` 在本机）：

```
本机 cron 写 CSV → 您 PowerShell 跑 `node build.mjs` →
git add dist/ && git commit && git push → GitHub Actions auto-deploy
```

完整步骤见 [DEPLOY.md](./DEPLOY.md)。

## 数据识别（gsc canonical verdict）

| Bucket | 含义 | 颜色 |
|---|---|---|
| `indexed` | "Submitted and indexed" 或 index_status=PASS | 🟢 绿 |
| `discovered` | "Discovered - currently not indexed" | 🔵 蓝 |
| `crawled` | "Crawled - currently not indexed" | 🔷 浅蓝 |
| `unknown` | "URL is unknown to Google" | 🟡 琥珀 |
| `canonical` | "Alternate page with proper canonical tag" | 🟣 紫 |
| `excluded` | "Excluded by ..." | ⚪ 灰 |
| `fail` | index_status=FAIL | 🔴 红 |
| `api_err` | index_status=ERR 或空 | ⬛ 深灰 |
| `neutral` | index_status=NEUTRAL | ⚪ 浅灰 |
| `other` | 未识别（含 GSC API "SKIPPED" — 无 token 时脚本写） | ⬜ 暗灰 |

## 红线

- ❌ 不动 `F:\projects\jinman-com-cn\`（主站 src/dist）
- ❌ 不抓爬虫、不调 API
- ❌ 不花美元（无 Tavily / DataForSEO / SEMrush）
- ❌ 不把 `seo-data/*.csv` 推到 GitHub（隐私 + 大文件）
- ❌ 无 Co-authored-by trailer

## 当前状态

- 构建产物：`dist/index.html`（16639 bytes / 249 GSC URLs / 76 百度词）
- workflow：`.github/workflows/dashboard-build.yml`（已就绪）
- 部署指南：[DEPLOY.md](./DEPLOY.md)
- Owner：L1 调度师 (32789)
- 创建日期：2026-09-29
- 数据识别 fix：2026-09-30