# AGENTS.md

## 项目协作规则

- 默认在 feature 分支开发，通过 PR 合并到 `main`。
- 不在 `main` 上直接做较大实现；紧急小修也要保持提交范围清晰。
- Commit message 使用中文。
- 修改认证、部署、D1/R2、API 权限或数据持久化逻辑后，至少运行 `npm test`；可行时同时运行 `npm run lint`。

## 部署规则

- ChatGPT Platform Sites 继续使用 `.openai/hosting.json`，不要删除该文件。
- 默认 `npm run build` 使用 `wrangler.chatgpt.toml`，不得设置 `AUTH_MODE=standard`；标准 Workers 构建使用 `npm run build:standard` 和 `wrangler.toml`。
- 标准 Cloudflare Workers 部署使用 `AUTH_MODE=standard`。
- `DB` 是 D1 binding，`CONTENT` 是 R2 binding。
- `ADMIN_PASSWORD`、`JWT_SECRET`、`CLOUDFLARE_API_TOKEN`、真实 D1 database id 和真实 R2 bucket 名称不得提交。
- GitHub Actions 使用 Variables `D1_DATABASE_ID`、`R2_BUCKET_NAME`、`ADMIN_EMAIL`，使用 Secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`、`JWT_SECRET`；缺失或占位配置必须在部署前失败。
- 应用内 `/api/v1/auth/login` 限流只在单个 Worker isolate 内尽力生效。公开部署前必须配置 Cloudflare WAF Rate Limiting，或使用 Cloudflare Access 保护应用。
- GitHub Actions 部署前必须先执行 `npm test`。

## 本地开发

- Node.js 版本要求为 `>=22.13.0`。
- 本地开发可使用 `AUTH_MODE=local` 和 `DEV_USER_EMAIL`。
- 标准登录本地预览可复制 `.env.example` 到 `.env.local` 或使用 Wrangler 本地变量文件，并填入本机专用测试密码和 JWT secret。
- `.wrangler/`、`.env*`、`node_modules/` 和构建产物不得提交。
