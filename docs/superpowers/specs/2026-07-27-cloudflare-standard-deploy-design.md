# 标准 Cloudflare Workers 部署适配设计

## 背景

项目当前面向 ChatGPT Platform Sites 构建，生产身份依赖 `oai-authenticated-user-email` 等平台注入请求头，D1/R2 绑定由 `.openai/hosting.json` 声明。标准 Cloudflare Workers 环境不会注入这些身份头，因此即使 D1/R2 绑定存在，业务 API 也会在生产环境返回 `authentication_required`。

本次开发目标是实现 B 计划：在保留 ChatGPT Sites 兼容性的前提下，让项目可通过标准 Cloudflare Workers + Wrangler 部署，并在 `AUTH_MODE=standard` 下完成最小可用登录。

## 范围

本次纳入：

- 新增标准 Workers 登录能力：管理员邮箱/密码登录，签发 HttpOnly JWT cookie。
- 扩展 `platformContext()` 身份解析，支持 `chatgpt`、`standard`、`local` 三种模式。
- 新增标准 Cloudflare Workers 部署配置、脚本和 GitHub Actions。
- 更新 `.env.example`，明确环境变量、Secrets 和本地开发方式。
- 新增或更新项目根目录 `AGENTS.md`，记录本项目协作、部署、验证和发布注意事项。
- 更新回归测试，覆盖认证模式、部署配置和密钥不落库/不入仓约束。

本次不纳入：

- 不接入真实第三方 LLM、ASR、向量检索或队列。
- 不改学生、教师、家长、机构端的核心业务视图和数据模型。
- 不迁移现有 D1 表结构。
- 不在代码库中保存真实 Cloudflare 账号、D1 database id、密码、JWT 密钥或 API token。
- 不直接推送远程或合并主分支；完成后通过 PR 审核再合并。

## 分支与集成策略

- 当前开发工作在隔离 worktree 分支 `work-agents-md` 中进行。
- 后续实现完成后，创建 PR，由用户或仓库维护者确认后合并到主分支。
- 主分支只接收已经通过本地验证的提交。
- 本次新增项目 `AGENTS.md` 作为协作规则更新随 PR 一并携带。

## 认证设计

### AUTH_MODE

新增运行时变量 `AUTH_MODE`：

- `chatgpt`：保持现有 ChatGPT Platform 身份头逻辑。
- `standard`：使用项目自己的登录接口和 JWT cookie。
- `local`：仅用于本地开发，读取 `x-wenqu-dev-user` 或 `DEV_USER_EMAIL`，默认 `dev@wenqu.local`。

默认行为：

- `NODE_ENV=development` 且未显式设置时按 `local` 处理。
- 非开发环境未显式设置时按 `chatgpt` 处理，以保持现有 Sites 行为不破坏。

### 标准登录

新增 API：

- `POST /api/v1/auth/login`
  - 入参：`email`、`password`。
  - 校验：`email` 必须等于 `ADMIN_EMAIL`；`password` 必须与 `ADMIN_PASSWORD` 匹配。
  - 成功：签发 JWT，并写入 `HttpOnly; SameSite=Lax; Path=/` cookie。
  - 失败：返回 `401 invalid_credentials`。
- `POST /api/v1/auth/logout`
  - 清除登录 cookie。
- `GET /api/v1/auth/session`
  - 返回当前登录用户基础信息，供前端判断状态。

JWT 设计：

- 使用 Workers Web Crypto 的 HMAC-SHA-256 实现，不新增依赖。
- payload 包含 `email`、`displayName`、`iat`、`exp`。
- 默认有效期 7 天，可通过 `JWT_TTL_SECONDS` 配置。
- `JWT_SECRET` 必须来自 Secret，不写入仓库。

### API 身份流

`platformContext(request, requiredRole?)` 保持对调用方的接口不变：

1. 读取 D1 binding `DB`。
2. 按 `AUTH_MODE` 解析身份。
3. 使用现有 `idPart(email)` 生成稳定用户 ID。
4. 复用现有租户初始化、邀请接受、角色读取和 `requiredRole` 校验。

这样可以避免逐个修改现有业务 API。

## 前端设计

当前 `Dashboard` 已通过 `/api/v1/workspace` 拉取所有工作区数据。改造时保留该入口：

- 初始化请求返回 401 且 `AUTH_MODE=standard` 时，展示最小登录表单。
- 登录成功后重新请求 `/api/v1/workspace`。
- 登出按钮可放在顶部用户区域，调用 `/api/v1/auth/logout` 后回到登录态。
- ChatGPT Sites 模式继续显示原有“请先完成 ChatGPT 登录”提示。

界面改动以最小可用为准，不引入新组件库和动画。

## Cloudflare / Wrangler 配置

使用两份职责分离的 Wrangler 输入配置：

- 默认 `npm run build` 读取 `wrangler.chatgpt.toml`，保留 `DB`、`CONTENT` binding，但不设置 `AUTH_MODE=standard`。
- `npm run build:standard` 通过 `WENQU_DEPLOY_TARGET=standard` 选择 `wrangler.toml`。
- `wrangler.toml` 使用安全占位值并设置 `AUTH_MODE = "standard"`；CI 在验证和部署前写入真实 D1 ID、R2 bucket 名和管理员邮箱。
- 两份配置都包含 Worker 名称、`main = "worker/index.ts"`、`compatibility_date` 和 `nodejs_compat`。
- 标准配置声明必需 Secrets：`ADMIN_PASSWORD`、`JWT_SECRET`。

敏感项处理：

- `ADMIN_PASSWORD`、`JWT_SECRET`、Cloudflare API token 必须通过 Cloudflare Secrets、GitHub Secrets 或本地 `.env.local` / `.dev.vars` 提供。
- `ADMIN_EMAIL` 可作为普通变量或 Secret；为减少误配置，文档中推荐也通过环境配置提供，不硬编码到代码。

Cloudflare Vite plugin 注意点：

- 项目使用 `@cloudflare/vite-plugin`，`npm run build` 会生成用于预览和部署的输出 Worker 配置。
- `wrangler deploy` 应在 build 后执行，让 Wrangler 使用构建产物配置。
- `vite.config.ts` 需要避免程序化配置和根 `wrangler.toml` 对 D1/R2 binding 产生重复或冲突。

## 脚本与 CI

`package.json` 新增：

- `build:standard`：跨平台脚本设置标准部署目标后执行 build。
- `cf:preview`：`npm run build:standard && npx wrangler dev`
- `cf:deploy`：`npm run build:standard && npx wrangler deploy`

`.github/workflows/deploy.yml`：

- push 到 `main` 时触发。
- 使用 Node.js 22。
- 从 GitHub Variables 读取 `D1_DATABASE_ID`、`R2_BUCKET_NAME`、`ADMIN_EMAIL`，拒绝缺失值和占位值，然后渲染 `wrangler.toml`。
- 执行 `npm ci`、`npm run lint`、`npm test`、`npm run build:standard`。
- 使用 `cloudflare/wrangler-action@v3` 部署，并上传 `ADMIN_PASSWORD`、`JWT_SECRET` Worker Secrets。
- 读取 GitHub Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ADMIN_PASSWORD`、`JWT_SECRET`。

## 项目 AGENTS.md 更新

新增项目根目录 `AGENTS.md`，只记录项目协作和本地开发约定：

- 默认在 feature 分支开发，通过 PR 合并主分支。
- 标准 Cloudflare 部署使用 `AUTH_MODE=standard`。
- 密码、JWT secret、Cloudflare token、D1/R2 真实资源标识不写入公共文档或提交。
- 修改认证、部署、D1/R2、API 权限时必须运行 `npm test`；可行时运行 `npm run lint`。
- 保留 ChatGPT Sites 兼容，不删除 `.openai/hosting.json`。

## 错误处理

- 缺少 `DB`：继续返回 `database_unavailable`。
- standard 模式缺少 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 或 `JWT_SECRET`：登录和需要认证的 API 返回明确配置错误，不伪装为凭证错误。
- JWT 缺失、过期、签名错误：返回 `authentication_required`。
- 角色不足：继续返回 `forbidden`。
- 登录失败不输出密码、token 或密钥。
- 畸形 session Cookie 按未认证处理，不因 URI 解码错误返回 500。
- 登录路由按客户端地址提供单 isolate、固定窗口的尽力限流；达到阈值返回 429 和 `Retry-After`。

## 测试计划

最小验证：

- `npm run lint`
- `npm test`

回归测试新增断言：

- `platform-store.ts` 保留 ChatGPT header 支持。
- `platform-store.ts` 支持 `AUTH_MODE` 和 standard JWT 身份。
- 行为测试覆盖 JWT 有效、过期、畸形和签名错误。
- 新增 auth API 路由存在并设置 HttpOnly cookie。
- 默认和标准构建分别选择正确 Wrangler 配置，构建产物中的认证模式符合目标。
- CI 配置渲染脚本拒绝占位值且不输出 Secrets。
- `package.json` 包含 `cf:preview`、`cf:deploy`。
- `.env.example` 不包含真实密码或 token。
- 项目根目录 `AGENTS.md` 存在并包含 PR/分支和 Secrets 约定。

## 主要风险与约束

- `@cloudflare/vite-plugin` 会生成部署用输出配置；如果根 `wrangler.toml` 和 `vite.config.ts` 同时声明 binding，可能出现重复或覆盖。实现时必须通过 build 输出确认。
- 标准密码登录只是部署解耦的最小方案，不等于完整多用户认证系统；后续可替换为 OIDC、Cloudflare Access 或机构账号系统。
- 应用内限流不跨 Worker isolate 共享状态，不能替代 Cloudflare WAF Rate Limiting；公开部署前必须启用 WAF Rate Limiting 或 Cloudflare Access。
- 如果 CI 只执行 `wrangler deploy` 而不先 build，可能部署不到 Vinext 生成的正确产物。因此脚本和 workflow 必须先构建。

## 参考依据

- Cloudflare Vite plugin 支持构建前端资产和 Workers 运行产物。
- Cloudflare Vite plugin 构建后，`wrangler deploy` 会定位输出配置。
- Cloudflare D1 通过 Wrangler binding 暴露给 Worker。
- Cloudflare 官方建议敏感信息使用 Secrets，不写入明文 `vars`。
- Cloudflare 官方 GitHub Actions 部署示例使用 `cloudflare/wrangler-action@v3` 和 GitHub Secrets。
