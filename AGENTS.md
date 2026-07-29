# AGENTS.md

## 项目协作规则

- 默认在 feature 分支开发，通过 PR 合并到 `main`。
- 不在 `main` 上直接做较大实现；紧急小修也要保持提交范围清晰。
- Commit message 使用中文。
- 修改认证、部署、D1/R2、API 权限或数据持久化逻辑后，至少运行 `npm test`；可行时同时运行 `npm run lint`。

## README 维护规则

- 用户已经手动调整过 README 时，不得擅自撤回、重写或恢复为模板化内容；如需调整结构，优先移动原文。
- README 的 `## ⚡ 快速开始` 放面向用户和部署者的启动路径，包括 Cloudflare 自托管、一键部署、Wrangler 部署、GitHub Actions 部署、访问后台和升级部署。
- README 的 `## 📖 使用说明` 只放平台内部功能使用说明，例如学生端、教师端、家长端和机构端的实际使用流程。
- README 的 `## 👨‍💻 本地开发` 放面向开发者的本地启动、clone、依赖安装、dev server、本地环境变量、lint、test 和 build 命令。
- 当前平台处于 demo 阶段时，`## 📖 使用说明` 可以留空或保留极简占位，不应把部署说明放入该章节。
- 参考 `start-your-python` 的 README 信息分层：快速开始负责启动路径，使用说明负责应用内部功能。

## 部署规则

- ChatGPT Platform Sites 继续使用 `.openai/hosting.json`，不要删除该文件。
- 默认 `npm run build` 使用 `wrangler.chatgpt.toml`，不得设置 `AUTH_MODE=standard`；标准 Workers 构建使用 `npm run build:standard` 和 `wrangler.toml`。
- 标准 Cloudflare Workers 部署使用 `AUTH_MODE=standard`。
- `DB` 是 D1 binding，`CONTENT` 是 R2 binding。
- `ADMIN_PASSWORD`、`JWT_SECRET`、`CLOUDFLARE_API_TOKEN`、真实 D1 database id 和真实 R2 bucket 名称不得提交。
- 应用内 `/api/v1/auth/login` 限流只在单个 Worker isolate 内尽力生效。公开部署前必须配置 Cloudflare WAF Rate Limiting，或使用 Cloudflare Access 保护应用。
- `.github/workflows/ci.yml` 只做 PR/push 的必要校验，不读取部署 secrets，不执行 Cloudflare 部署。
- 本仓库不维护默认 GitHub Actions 自动部署 workflow，避免上游仓库缺少用户私有 Cloudflare secrets 时持续失败；用户如需 Actions 部署，应在自己的 Fork 中自行添加。

## 本地开发

- Node.js 版本要求为 `>=22.13.0`。
- 本地开发可使用 `AUTH_MODE=local` 和 `DEV_USER_EMAIL`。
- 标准登录本地预览可复制 `.env.example` 到 `.env.local` 或使用 Wrangler 本地变量文件，并填入本机专用测试密码和 JWT secret。
- `.wrangler/`、`.env*`、`node_modules/` 和构建产物不得提交。
