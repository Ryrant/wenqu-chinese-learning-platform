# 文趣 · 华文趣味教学助手

[![Version](https://img.shields.io/badge/version-v1.0.0-0f766e)](https://github.com/Ryrant/wenqu-chinese-learning-platform/releases/tag/v1.0.0)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6)](https://www.typescriptlang.org/)

面向海外华文学校的多租户教学平台，覆盖学生、教师、家长和机构管理员。平台围绕“诊断—学习—反馈—学情分析”闭环构建，业务数据保存到 Cloudflare D1，教材与音频保存到 R2。

线上演示：[wenqu-learning.savory-pike-1800.chatgpt.site](https://wenqu-learning.savory-pike-1800.chatgpt.site/)

## v1.0.0 已实现功能

- 身份与租户：读取生产环境登录身份，服务端实施租户和角色隔离；受邀成员首次登录自动加入机构。
- 学生端：任务学习、文字作业、浏览器录音、音频持久化、来源化知识问答和掌握度展示。
- 教师端：班级与任务管理、任务发布、来源化 AI 备课、提交审核、人工评分和学情查看。
- 家长端：学习报告、薄弱点、家庭练习提醒和学习分析授权管理。
- 机构端：教材上传、权属记录、内容审核发布、成员邀请、服务状态和审计日志。
- 数据与检索：D1 业务模型、R2 对象存储、已发布知识片段关键词检索、引用记录和内容版本信息。
- 安全降级：未配置模型或语音服务时，明确使用来源化模板或教师复核，不生成虚假模型状态和发音分数。

## 技术栈

- TypeScript、React 19、Next.js 16、Vinext、Vite
- Cloudflare Workers、D1、R2
- Drizzle ORM / Drizzle Kit
- ESLint、Node.js Test Runner

## 快速开始

### 1. 环境要求

- Node.js `22.13.0` 或更高版本
- npm（随 Node.js 安装）
- Git

确认版本：

```bash
node --version
npm --version
git --version
```

### 2. 下载代码

使用 Git 克隆：

```bash
git clone https://github.com/Ryrant/wenqu-chinese-learning-platform.git
cd wenqu-chinese-learning-platform
```

也可以在 GitHub Release 页面下载 `v1.0.0` 的 Source code 压缩包，解压后进入项目目录。

### 3. 安装与启动

```bash
npm ci
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。首次访问会自动创建本地 D1 表和一套可操作的示例工作区，不需要单独安装 PostgreSQL、Redis 或本地对象存储。

开发环境默认使用 `dev@wenqu.local` 作为本地测试身份。若要指定自己的测试身份：

```bash
# macOS / Linux
cp .env.example .env.local

# Windows PowerShell
Copy-Item .env.example .env.local
```

然后修改：

```dotenv
DEV_USER_EMAIL=your-name@wenqu.local
```

此回退身份只在 `NODE_ENV=development` 时生效；生产环境没有可信身份头会直接返回 `401`。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器和 Cloudflare 本地绑定 |
| `npm run lint` | 运行代码规范检查 |
| `npm run build` | 生成生产构建 |
| `npm test` | 生产构建并运行回归测试 |
| `npm run db:generate` | 根据 `db/schema.ts` 生成 Drizzle 迁移 |

## 本地数据与重置

本地 D1/R2 模拟数据保存在项目的 `.wrangler/` 目录，并已加入 `.gitignore`。需要重新体验“全新机构首次进入”时，先停止开发服务器，然后只删除本项目的 `.wrangler/`：

```powershell
# Windows PowerShell（在项目根目录执行）
Remove-Item -LiteralPath .wrangler -Recurse -Force
```

```bash
# macOS / Linux（在项目根目录执行）
rm -rf .wrangler
```

重新执行 `npm run dev` 后，基础表和示例数据会自动初始化。

## 可选服务配置

复制 `.env.example` 为 `.env.local` 后可填写以下配置：

| 变量 | 是否必需 | 未配置时行为 |
| --- | --- | --- |
| `DEV_USER_EMAIL` | 否，仅本地 | 使用 `dev@wenqu.local` |
| `AI_API_KEY` | 否 | 使用带知识来源的确定性教学模板 |
| `SPEECH_API_KEY` | 否 | 音频正常保存，进入教师人工复核 |
| `MODERATION_API_KEY` | 否 | 使用基础规则检查 |

不要提交 `.env.local`、真实 API Key、学生信息或生产数据。

## 项目结构

```text
app/
  api/v1/                 # 版本化业务 API
  dashboard.tsx           # 角色工作台与导航
  student-view.tsx        # 学生学习体验
  staff-views.tsx         # 教师、家长、机构视图
  lib/                    # 身份、租户、数据初始化与共享类型
db/                       # Drizzle 数据模型
drizzle/                  # 数据库迁移
worker/                    # Cloudflare Worker 入口
public/                    # 静态资源
tests/                     # 回归测试
.openai/hosting.json       # Sites 项目及 D1/R2 绑定声明
```

## 核心接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/workspace` | 获取当前角色范围内的工作区聚合数据 |
| `POST` | `/api/v1/workspace/actions` | 班级、任务、评分、提醒、授权、邀请和内容审核命令 |
| `POST` | `/api/v1/ai/generate` | 通过 SSE 返回带引用的教学草稿 |
| `POST` | `/api/v1/knowledge/search` | 检索当前租户已发布的知识内容 |
| `POST` | `/api/v1/content/upload` | 上传教材并保存权属元数据 |
| `POST` | `/api/v1/speech/submissions` | 保存语音作业并进入复核队列 |
| `POST` | `/api/v1/submissions` | 提交文字作业 |
| `POST` | `/api/v1/feedback` | 保存用户反馈 |
| `GET` | `/api/v1/health` | 查看数据库、存储和 AI 服务状态 |

## 数据与生产绑定

生产运行需要以下 Cloudflare 绑定：

- `DB`：D1 数据库
- `CONTENT`：R2 Bucket

基础表会在运行时进行幂等校验，正式数据库变更仍应通过 `drizzle/` 中的迁移文件管理。生产站点通过 Sites 注入可信用户身份；如果部署到其他平台，需要替换 `app/lib/platform-store.ts` 中的身份适配层，不能把开发身份回退带入生产。

## 成员协作流程

```bash
git switch -c feature/your-feature
# 修改并验证
npm run lint
npm test
git add <本次修改的文件>
git commit -m "feat: describe your change"
git push -u origin feature/your-feature
```

然后在 GitHub 创建 Pull Request。不要把真实未成年人数据、对象存储文件、密钥或本地 `.wrangler/` 状态提交到仓库。

## 常见问题

### 端口 3000 被占用

开发服务器会自动选择其他端口，请以终端显示的 `Local` 地址为准。

### 页面提示工作区加载失败

1. 确认使用 Node.js 22.13 或更高版本。
2. 停止服务器后删除本项目 `.wrangler/`，再执行 `npm run dev`。
3. 查看终端中的 `platform_api_error`，它会输出服务端错误原因。

### 首次安装依赖失败

删除未完成的 `node_modules` 后重新运行 `npm ci`，并确认公司网络或代理可以访问 npm Registry。

## 版本与授权

当前稳定版本：`v1.0.0`。

仓库未附带开源许可证，默认仅供仓库所有者及获授权成员使用。如需对外开源或商业分发，请先补充合适的 `LICENSE` 和内容版权说明。