<div align="center">
  <!-- <img src="./public/og.png" alt="文趣 · 华文趣味教学助手 Logo" width="120" /> -->
  <h1>文趣 · 华文趣味教学助手</h1>
  <p>基于 Cloudflare Workers、D1 与 R2 构建的海外华文学校多租户教学平台</p>
</div>

<p align="center">
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/releases"><img src="https://img.shields.io/github/v/release/Ryrant/wenqu-chinese-learning-platform?label=Release&color=3b82f6" alt="Release" /></a>
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Ryrant/wenqu-chinese-learning-platform?color=10b981" alt="License" /></a>
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ryrant/wenqu-chinese-learning-platform/ci.yml?branch=main&label=CI" alt="CI" /></a>
</p>

---

## ✨ 为什么做这个项目

文趣面向海外华文学校和华裔青少年，提供学生、教师、家长和机构管理员四端工作台。项目围绕“诊断—学习—反馈—学情分析”闭环设计，业务数据保存到用户自己的 Cloudflare D1，教材、音频等文件保存到用户自己的 Cloudflare R2。

## 🚀 核心能力

- 学生端：学习总览、任务学习、文字作业、浏览器录音、来源化知识问答和掌握度展示。
- 教师端：班级管理、任务发布、来源化备课、作业批阅、人工评分和学情查看。
- 家长端：学习报告、薄弱点、家庭练习提醒和学习分析授权管理。
- 机构端：内容上传、权属审核、知识检索、成员邀请、服务状态和审计日志。
- 数据持久化：D1 保存租户、成员、作业、提交、反馈和审计记录；R2 保存教材和音频文件。
- 安全降级：未配置模型或语音服务时，明确使用来源化模板或教师复核，不展示虚假 AI 状态。
- 自托管部署：支持本地开发和标准 Cloudflare Workers 部署。

## ⚡ 快速开始

### 📋 前置要求

- [Cloudflare 账号](https://dash.cloudflare.com/)
- [GitHub 账号](https://github.com/)

### 方式一：Cloudflare Workers 连接 GitHub 仓库（推荐）

这种方式适合长期自托管，后续同步 Fork 后可以在 Cloudflare 中重新部署。

1. 在 GitHub 点击右上角 **Fork**，把仓库复制到你自己的账号。
2. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
3. 进入 **Workers & Pages**，点击 **Create application**。
4. 选择 **Import a repository** 或 **Continue with GitHub**，授权并选择你 Fork 的仓库。
5. Project Name 可填写 `wenqu-chinese-learning-platform`。
6. Build command 填写：

   ```bash
   npm run build
   ```

7. Deploy command 填写：

   ```bash
   npx wrangler deploy --keep-vars
   ```

8. 在 Cloudflare 项目的 **Settings** → **Variables and Secrets** 中配置：

   | 名称 | 类型 | 说明 |
   | --- | --- | --- |
   | `AUTH_MODE` | Variable | 固定填写 `standard` |
   | `ADMIN_EMAIL` | Variable | 管理员登录邮箱 |
   | `JWT_TTL_SECONDS` | Variable | 会话有效期，默认 `604800` |
   | `ADMIN_PASSWORD` | Secret | 管理员登录密码，建议使用随机强密码 |
   | `JWT_SECRET` | Secret | JWT 签名密钥，建议至少 32 位随机字符串 |
   | `AI_API_KEY` | Secret，可选 | 文本生成服务密钥；不填时使用来源化模板 |
   | `SPEECH_API_KEY` | Secret，可选 | 语音评测服务密钥；不填时转人工复核 |
   | `MODERATION_API_KEY` | Secret，可选 | 内容审核服务密钥；不填时使用基础规则 |

9. 在 Cloudflare 项目绑定中确认：

   - D1 binding：`DB`
   - R2 binding：`CONTENT`

部署成功后，访问 Cloudflare 分配的 `workers.dev` 域名即可进入登录页。

### 方式二：一键部署

点击按钮进入 Cloudflare 部署向导：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Ryrant/wenqu-chinese-learning-platform)

一键部署适合快速试用。部署过程中或部署完成后，请在 Cloudflare 控制台确认：

- Build command：`npm run build`
- Deploy command：`npx wrangler deploy --keep-vars`
- D1 binding：`DB`
- R2 binding：`CONTENT`
- 必填变量和密钥：`AUTH_MODE=standard`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`、`JWT_SECRET`

一键部署后续同步更新不如 GitHub 仓库连接方式方便；长期使用建议迁移到方式一。

### 方式三：本地 Wrangler 部署

本地部署会发布到当前 `wrangler login` 登录的 Cloudflare 账号。

```bash
npm ci
npx wrangler login
npm run cf:deploy
```

正式部署前请先在 Cloudflare 中创建 D1/R2，并把 `wrangler.toml` 中的占位值替换为你自己的资源名称和 ID。不要提交真实资源 ID、密码或密钥。

### 访问后台

标准 Cloudflare Workers 部署完成后，打开 Worker URL：

```text
https://你的项目名.你的子域.workers.dev/
```

使用部署时配置的 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 登录。首次进入会自动初始化租户、用户、四端角色和示例工作区。

### 升级 Cloudflare Workers

- Cloudflare Workers 连接 GitHub 仓库：在你的 Fork 页面点击 **Sync fork** → **Update branch**，Cloudflare 会检测代码变化并重新部署。
- 一键部署：建议重新部署，或迁移到 Cloudflare 连接 GitHub 仓库方式。
- 本地 Wrangler 部署：拉取最新代码后重新执行 `npm ci` 和 `npm run cf:deploy`。

## 📖 使用说明

### 机构管理员

1. 使用管理员账号登录。
2. 在成员管理中创建教师、学生和家长成员账号，并设置临时密码。
3. 维护学生与监护人绑定关系。
4. 上传 PDF/DOCX/TXT 教材，确认文本抽取和切片结果后发布。

### 教师

1. 创建班级和任务。
2. 关联学习目标并发布任务。
3. 查看学生文字和语音提交。
4. 对文字作业生成 AI 辅助批阅建议，并在确认或修改后发布最终评分。

### 学生

1. 首次登录修改临时密码。
2. 查看任务并提交文字或录音作业。
3. 在 AI 课堂中基于已发布资料提问。
4. 在成长档案查看教师确认后的反馈。

### 家长

1. 登录后查看已绑定学生。
2. 查看教师确认后的学习报告。
3. 维护家庭练习提醒和学习分析授权。

## 🧠 功能细节

### 认证模式

项目支持两种认证模式：

| 模式 | 适用场景 | 身份来源 |
| --- | --- | --- |
| `local` | 本地开发 | `x-wenqu-dev-user` 或 `DEV_USER_EMAIL` |
| `standard` | 用户自托管 Cloudflare Workers | 管理员密码登录 + HttpOnly JWT Cookie |

默认 `npm run build` 使用 `wrangler.toml` 生成标准 Cloudflare Workers 构建。`npm run build:standard` 保留为兼容入口，当前同样用于标准 Workers 部署。

### 数据与绑定

生产运行需要以下 Cloudflare 绑定：

- `DB`：D1 数据库
- `CONTENT`：R2 Bucket

基础表会在运行时进行幂等校验，正式数据库变更仍应通过 `drizzle/` 中的迁移文件管理。

### 安全注意事项

- 不要提交 `.env.local`、真实 API Key、学生信息、Cloudflare Token、D1 ID、R2 Bucket 名称、管理员密码或 JWT 密钥。
- `/api/v1/auth/login` 内置的是 Worker isolate 内的尽力限流。公开访问前，建议在 Cloudflare WAF 中对登录接口配置 Rate Limiting，或使用 Cloudflare Access 保护应用。
- 学生数据、作业、音频和教材文件会存入你自己的 D1/R2，请按当地未成年人数据保护要求管理访问权限。

## 🧱 技术栈

- TypeScript：应用与 Worker 代码
- React 19：前端交互
- Next.js 16 + Vinext + Vite：应用路由与 Cloudflare 构建
- Cloudflare Workers：边缘运行环境
- Cloudflare D1：SQLite 数据库
- Cloudflare R2：教材与音频对象存储
- Drizzle ORM / Drizzle Kit：数据模型与迁移
- ESLint、Node.js Test Runner：代码检查与回归测试

## 🗂️ 项目结构

```text
wenqu-chinese-learning-platform/
├── app/                       # 页面、四端工作台与版本化 API
├── app/lib/                   # 身份、租户、数据初始化与共享类型
├── db/                        # Drizzle 数据模型
├── drizzle/                   # 数据库迁移
├── worker/                    # Cloudflare Worker 入口
├── public/                    # 静态资源
├── scripts/                   # 标准 Cloudflare 构建与配置渲染脚本
├── tests/                     # 自动化回归测试
├── .github/ISSUE_TEMPLATE/    # GitHub Issue 表单
└── wrangler.toml              # 标准 Cloudflare Workers 自托管配置
```

## 👨‍💻 本地开发

### 环境

- Node.js `22.13.0` 或更高版本
- npm
- Git

### 本地启动

```bash
git clone https://github.com/Ryrant/wenqu-chinese-learning-platform.git
cd wenqu-chinese-learning-platform
npm ci
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。首次访问会自动创建本地 D1 表和一套可操作的示例工作区。

### 本地测试身份

本地开发默认使用 `dev@wenqu.local` 作为测试身份。若要指定自己的测试身份：

```bash
cp .env.example .env.local
```

然后修改：

```dotenv
AUTH_MODE=local
DEV_USER_EMAIL=your-name@wenqu.local
```

### 命令

```bash
npm run dev
npm run lint
npm test
npm run build
npm run build:standard
```

常用命令说明：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器和 Cloudflare 本地绑定 |
| `npm run lint` | 运行代码规范检查 |
| `npm test` | 默认构建并运行 `tests/` 下的回归测试 |
| `npm run build` | 生成标准 Cloudflare Workers 构建 |
| `npm run build:standard` | 标准 Cloudflare Workers 构建兼容入口 |
| `npm run cf:preview` | 使用标准 Cloudflare 配置启动 Wrangler 预览 |
| `npm run cf:deploy` | 使用标准 Cloudflare 配置部署到当前账号 |
| `npm run db:generate` | 根据 `db/schema.ts` 生成 Drizzle 迁移 |

本地 D1/R2 模拟状态保存在 `.wrangler/`。如需重新体验“全新机构首次进入”，停止开发服务器后删除本项目的 `.wrangler/`，再执行 `npm run dev`。

当前自动化测试目录是 `tests/`：

- `tests/rendered-html.test.mjs`：检查页面、API、部署配置和安全约束。
- `tests/auth-token.test.mjs`：执行 JWT 创建、校验、过期、篡改和畸形输入行为测试。

## 🔐 安全报告

如果发现安全问题，请不要公开披露细节。请优先参考仓库中的 [SECURITY.md](./SECURITY.md) 提交安全报告。

## 📄 许可证

本项目基于 [GPL-3.0](./LICENSE) 开源。
