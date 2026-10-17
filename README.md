<div align="center">
  <!-- <img src="./public/og.png" alt="华文知行协同教学平台 Logo" width="120" /> -->
  <h1>华文知行协同教学平台</h1>
  <p>支持 Cloudflare Workers + D1/R2 与 Docker + SQLite/本地文件存储的海外华文学校多租户教学平台</p>
</div>

<p align="center">
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/releases"><img src="https://img.shields.io/github/v/release/Ryrant/wenqu-chinese-learning-platform?label=Release&color=3b82f6" alt="Release" /></a>
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Ryrant/wenqu-chinese-learning-platform?color=10b981" alt="License" /></a>
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ryrant/wenqu-chinese-learning-platform/ci.yml?branch=main&label=CI" alt="CI" /></a>
</p>

---

## ✨ 为什么做这个项目

华文知行协同教学平台面向海外华文学校和华裔青少年，提供学生、教师、家长和机构管理员四端工作台。项目围绕“诊断—学习—反馈—学情分析”闭环设计。Cloudflare 部署使用用户自己的 D1/R2；Docker 自部署使用容器数据卷中的 SQLite 和本地上传目录。

## 🚀 核心能力

- 学生端：客观题入学诊断、最多 3 项的今日学习计划、错题复习中心，以及原有文字/录音作业和来源化知识问答。
- 教师端：关联目标与三维评分量规的任务、班级学情热力图、学生分层干预，以及原有来源化备课和人工批阅。
- 家长端：多孩子切换、最近 7 天真实成长报告、亲子家庭任务，以及原有学习分析授权管理。
- 机构端：课程目标与诊断题库、幂等班级编班、教学质量看板，以及原有内容权属审核、成员管理和审计日志。
- 数据持久化：Cloudflare 部署使用 D1 保存结构化数据、R2 保存教材和音频；Docker 自部署使用 SQLite 和本地文件目录。
- 安全降级：未配置模型或语音服务时，明确使用来源化模板或教师复核，不展示虚假 AI 状态。
- 自托管部署：支持本地开发、标准 Cloudflare Workers 部署和 Docker 自部署。

### v1.2.0 UI 与工作流优化

- 四端统一正文、表单、按钮、辅助信息的字号与行高；桌面端提高信息密度，390px 手机端改为纵向布局，不靠缩小文字容纳内容。
- 学生 AI 课堂按“问题标题 → 回答 → 可参考内容 → 引用来源”展示；本地来源化模式直接提取已审核片段，找不到依据时明确拒答。
- 教师端采用 4:6 班级任务布局，教案草稿支持查看、编辑和归档，作业批阅拆分为待办列表与独立批阅面板。
- 家长端统一当前孩子切换入口；家庭任务关联课程作业与目标，经学生提交、家长确认帮助程度、教师评价后完成，支持编辑、重新打开和归档。成长报告只展示真实近七天记录。
- 机构端将服务状态、内容状态和审计操作中文化，提供内容重新处理与归档、审计筛选、班级编班和可钻取质量指标。
- 所有“删除”操作均为可追溯归档，不删除 D1 历史记录或 R2 原文件。

## ⚡ 快速开始

### 📋 前置要求

- [Cloudflare 账号](https://dash.cloudflare.com/)
- [GitHub 账号](https://github.com/)
- Docker 与 Docker Compose（仅 Docker 自部署需要）

### 方式一：Cloudflare Workers 连接 GitHub 仓库（推荐）

这种方式适合长期自托管，后续同步 Fork 后可以在 Cloudflare 中重新部署。

1. 在 GitHub 点击右上角 **Fork**，把仓库复制到你自己的账号。
2. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
3. 进入 **Workers & Pages**，点击 **Create application**。
4. 选择 **Import a repository** 或 **Continue with GitHub**，授权并选择你 Fork 的仓库。
5. Project Name 可填写 `huawen-zhixing-platform`。
6. Build command 填写：

   ```bash
   npm run build
   ```

7. Deploy command 填写：

   ```bash
   npx wrangler deploy
   ```

8. Cloudflare 会根据 `wrangler.toml` 自动创建并绑定 D1/R2。部署前是零变量、零密钥配置，不需要手动填写 D1 database ID、R2 bucket 名称或任何运行参数。部署后在项目绑定中确认：

   - D1 binding：`DB`
   - R2 binding：`CONTENT`

部署成功后，访问 Cloudflare 分配的 `workers.dev` 域名，页面会提示初始化华文知行工作区。按提示创建首个管理员邮箱和密码后即可进入后台。

如需接入外部模型、语音评测或内容审核，进入后台 **平台设置** 添加 OpenAI Key、通用 AI Key、模型名、语音评测 Key 和内容审核 Key。配置会保存到你自己的 D1，不配置时系统会使用来源化模板或教师复核降级，不影响基础部署。

### 方式二：一键部署

点击按钮进入 Cloudflare 部署向导：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Ryrant/wenqu-chinese-learning-platform)

一键部署适合快速试用。部署过程中只需确认：

- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`
- D1 binding：`DB`
- R2 binding：`CONTENT`

D1/R2 会在一键部署流程中自动创建，不需要手动填写变量、D1 database ID、R2 bucket 名称、管理员密码或登录签名密钥。部署完成后打开站点，按页面提示完成首次初始化。

一键部署后续同步更新不如 GitHub 仓库连接方式方便；长期使用建议迁移到方式一。

### 方式三：本地 Wrangler 部署

本地部署会发布到当前 `wrangler login` 登录的 Cloudflare 账号。

```bash
npm ci
npx wrangler login
npm run cf:deploy
```

本地 Wrangler 部署同样使用 `wrangler.toml` 中的 `DB` / `CONTENT` 绑定。首次部署时 Wrangler 会为缺少资源 ID 或 bucket 名的绑定自动创建 D1/R2；不要提交密码、登录签名密钥或 Cloudflare Token。

### 方式四：Docker 自部署

Docker 自部署适合希望在自有服务器、NAS 或学校内网运行的场景。该方式不依赖 Cloudflare D1/R2，默认使用容器数据卷中的 SQLite 与本地文件目录：

- 结构化数据：`/data/huawen-zhixing.db`
- 上传教材、图片和音频：`/data/uploads`

启动：

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:3000/
```

首次访问会进入管理员初始化流程。Docker 版与 Cloudflare 版使用同一套数据模型和角色模型；第一阶段不提供 D1 与 SQLite 的自动迁移工具，也不面向多容器横向扩展。

### 访问后台

标准 Cloudflare Workers 部署完成后，打开 Worker URL：

```text
https://你的项目名.你的子域.workers.dev/
```

首次打开时会显示初始化表单。填写管理员邮箱、显示名称和密码后，系统会创建首个管理员、租户、四端角色、示例工作区，并在 D1 中生成站点级登录签名密钥。初始化完成后再次访问会显示登录页。

### 升级 Cloudflare Workers

- Cloudflare Workers 连接 GitHub 仓库：在你的 Fork 页面点击 **Sync fork** → **Update branch**，Cloudflare 会检测代码变化并重新部署。
- 一键部署：建议重新部署，或迁移到 Cloudflare 连接 GitHub 仓库方式。
- 本地 Wrangler 部署：拉取最新代码后重新执行 `npm ci` 和 `npm run cf:deploy`。

### v1.2.0 升级提示

`v1.2.0` 将 Next.js 升级到 `16.2.12`，并增加 `drizzle/0004_learning_loop.sql` 与 `drizzle/0005_ui_workflow.sql`。迁移只新增学习闭环表、工作流时间与归档字段，不删除或重命名已有结构。旧记录会使用创建时间回填更新时间；`wrangler.toml` 已将迁移目录指定为 `drizzle/`，运行时仍会幂等校验基础表和增量字段。

本次基础流程修复另增 `drizzle/0006_learning_workflow_evidence.sql`，为评分维度、家庭作品及帮助程度增加字段和待评作品唯一索引，不回填或重算历史成绩。

已有 Cloudflare 环境升级时，先备份 D1，再执行安全基线脚本。基线脚本仅在对应结构完整存在时登记迁移；旧环境会登记已经完整存在的基线结构，再执行尚未应用的 `0004`、`0005`、`0006`，空库不会被误标记。随后查看并执行远端增量迁移：

```bash
npx wrangler d1 export huawen-zhixing-db --remote --output=huawen-zhixing-db-before-v1.2.sql
npx wrangler d1 execute huawen-zhixing-db --remote --file=scripts/baseline-d1-migrations.sql
npx wrangler d1 migrations list huawen-zhixing-db --remote
npx wrangler d1 migrations apply huawen-zhixing-db --remote
```

随后执行发布验证：

```bash
npm ci
npm run lint
npm test
npm audit --omit=dev
npx wrangler deploy --dry-run --outdir .wrangler-dry-run
```

如需回滚，恢复 `v1.1.0` 应用代码并重新部署，保留 `0004_learning_loop.sql` 和 `0005_ui_workflow.sql` 新增的表与列，避免破坏已产生的诊断、推荐、量规、编班和归档数据。回滚旧代码不会读取这些新增结构。

## 📖 使用说明

推荐按 **机构配置 → 教师发布 → 学生学习 → 家长查看** 的顺序完成一次学习闭环。

### 机构管理员

1. 使用管理员账号登录。
2. 在成员管理中创建教师、学生和家长成员账号，并设置临时密码。
3. 维护学生与监护人绑定关系，并使用班级编班为班级配置学生。
4. 在内容中心维护课程目标和四选一诊断题。
5. 上传 PDF/DOCX/TXT 教材，确认内容权属、文本抽取和切片结果后发布。
6. 在机构总览查看目标覆盖、待批阅、低掌握度、内容审核、授权覆盖和 AI 使用情况。

### 教师

1. 创建班级，以及关联至少一个学习目标和三维评分量规的任务。
2. 审核并发布任务。
3. 查看班级学情热力图，并按学生和目标创建分层干预。
4. 查看学生文字和语音提交。
5. 对文字作业生成 AI 辅助批阅建议，填写总分并按实际观察评价目标和量规维度，确认后发布最终评分；家庭作品须先由家长确认帮助程度。

### 学生

1. 首次登录修改临时密码，并完成四选一入学诊断。
2. 按今日学习计划依次完成教师干预、到期错题、家庭任务和作业。
3. 选择普通作业或家庭任务并提交文字或录音；录音停止后可试听、重录，再确认上传。在 AI 课堂中基于已发布资料提问。
4. 在错题复习中心重新作答；答对后完成，答错则安排次日复习。
5. 在成长档案查看教师确认后的反馈。

### 家长

1. 登录后在顶部账号区切换已绑定学生。
2. 查看最近 7 天的本周成长报告。
3. 选择孩子已发布的课程作业与目标，创建亲子家庭任务；查看孩子的文字或录音作品，确认独立完成、提供提示或共同完成，等待教师评价。可编辑、重新打开或归档本人创建的任务。
4. 按孩子维护学习分析授权。

### 用户、角色与管理边界

- 管理员：管理成员、课程目标、诊断题、班级编排、内容审核、平台设置和审计日志。
- 教师：管理自己的班级、作业、批阅、干预和教案。
- 学生：完成诊断、查看学习计划、提交作业和复习错题。
- 家长：查看已绑定孩子的成长报告，维护家庭任务和学习分析授权。

账号身份保存在 `users`，租户内角色保存在 `role_memberships`，家长与学生关系保存在 `guardian_student_links`。当前版本不把 `reviewer` 暴露为独立可选角色。

## 🔁 自适应学习闭环

1. **诊断**：学生完成机构配置的四选一题目，系统按“目标正确题数 ÷ 已答题数”计算目标分数，不依赖外部模型。
2. **掌握度**：首次证据直接作为掌握度；后续使用“旧掌握度 × 0.7 + 新证据 × 0.3”更新。诊断结果与教师确认评分使用同一服务。
3. **推荐**：今日计划最多显示 3 项，固定优先级为教师干预、到期错题、家庭任务、临近截止作业、普通作业。排序规则可解释，未配置 AI 时仍完整运行。
4. **人工复核**：开放性作业和 AI 批阅建议必须由教师确认后，才形成成绩与掌握度证据；质量看板和家长周报不生成虚构指标。

AI 未配置、返回内容无法解析或评分不合法时，建议分数为空，由教师填写，不使用默认分数。作业总分、目标分数与量规维度分数分别保存；只有教师明确评价的目标才更新掌握度，留空表示未评价。量规维度名称须唯一。

录音支持停止后试听、重录及上传失败后重试；同次录音重试不重复创建作品。保存后的录音通过鉴权接口播放，仅本人、绑定家长、本班教师与本租户管理员可访问。

家庭任务按“学生提交作品 → 家长确认本次帮助程度 → 教师评分与反馈”完成，家长确认不会生成成绩。每次重做均需重新确认；有待评作品时不能归档，已有作品后不能更换关联作业或目标。旧家庭任务可先编辑补充作业与目标关联，再提交作品。

## 🧠 功能细节

### 认证模式

项目支持两种认证模式：

| 模式 | 适用场景 | 身份来源 |
| --- | --- | --- |
| `local` | 本地开发 | 默认测试身份，或请求头 `x-huawen-zhixing-dev-user` |
| `standard` | 用户自托管 Cloudflare Workers | 部署后首次初始化管理员 + HttpOnly JWT Cookie |

默认 `npm run build` 使用 `wrangler.toml` 生成标准 Cloudflare Workers 构建。`npm run build:standard` 保留为兼容入口，当前同样用于标准 Workers 部署。

### 数据与绑定

Cloudflare Workers + D1 + R2 部署需要以下绑定：

- `DB`：D1 数据库 binding，一键部署或首次 Wrangler 部署会自动创建默认数据库
- `CONTENT`：R2 Bucket binding，一键部署或首次 Wrangler 部署会自动创建默认 Bucket

基础表与 v1.2 增量字段会在运行时进行幂等校验，正式数据库变更仍应通过 `drizzle/` 中的迁移文件管理。`lesson_plans`、`learning_recommendations` 和 `source_documents` 使用 `updated_at` 与 `archived_at` 保留更新时间和归档状态；归档内容会立即停止发布其知识片段。

Docker 自部署不需要 Cloudflare 绑定，默认使用 `DATABASE_URL=file:/data/huawen-zhixing.db` 和 `UPLOAD_DIR=/data/uploads`。首次启动会创建 SQLite 数据库文件和上传目录，并沿用同一套运行时幂等建表逻辑。

`v1.2.0` 的诊断数据包括题目、选择结果、正误、目标得分和完成时间；推荐数据记录来源、截止时间和状态。家长读取或操作孩子数据前，服务端会验证有效监护绑定；教师只能干预自己班级的学生；全部查询和写操作均限制在当前租户。

### 安全注意事项

- 不要提交 `.env.local`、真实 API Key、学生信息、Cloudflare Token、管理员密码或 JWT 密钥。
- `/api/v1/auth/login` 内置的是 Worker isolate 内的尽力限流。公开访问前，建议在 Cloudflare WAF 中对登录接口配置 Rate Limiting，或使用 Cloudflare Access 保护应用。
- 学生数据、作业、音频和教材文件会存入你自己的 D1/R2 或 Docker 数据卷，请按当地未成年人数据保护要求管理访问权限。
- 采集诊断数据和学习分析前，应取得适用地区要求的未成年人授权，并保持监护绑定准确；撤回授权会写入审计日志。
- 上传教材、图片和音频前，应确认内容权属为机构自有或已获授权；只有通过权属与发布审核的知识片段会进入检索。

## 🧱 技术栈

- TypeScript：应用与 Worker 代码
- React 19：前端交互
- Next.js 16 + Vinext + Vite：应用路由与 Cloudflare 构建
- Cloudflare Workers：边缘运行环境
- Cloudflare D1 / SQLite：结构化数据存储
- Cloudflare R2 / 本地文件目录：教材与音频对象存储
- Docker Compose：单机自部署运行方式
- Drizzle ORM / Drizzle Kit：数据模型与迁移
- ESLint、Node.js Test Runner：代码检查与回归测试

## 🗂️ 项目结构

```text
huawen-zhixing-platform/
├── app/                       # 页面、四端工作台与版本化 API
├── app/lib/                   # 身份、租户、数据初始化与共享类型
├── db/                        # Drizzle 数据模型
├── drizzle/                   # 数据库迁移
├── worker/                    # Cloudflare Worker 入口
├── Dockerfile                 # Docker 镜像构建
├── docker-compose.yml         # Docker 自部署编排
├── public/                    # 静态资源
├── scripts/                   # 标准 Cloudflare 构建辅助脚本
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

本地开发默认使用 `dev@huawen-zhixing.local` 作为测试身份。需要模拟其他账号时，可在请求中带上 `x-huawen-zhixing-dev-user` 请求头；不需要为本地启动配置认证环境变量。

### 命令

```bash
npm run dev
npm run lint
npm test
npm run build
npm run build:standard
npm run start:docker
```

常用命令说明：

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器和 Cloudflare 本地绑定 |
| `npm run lint` | 运行代码规范检查 |
| `npm test` | 默认构建并运行 `tests/` 下的回归测试 |
| `npm run build` | 生成标准 Cloudflare Workers 构建 |
| `npm run build:standard` | 标准 Cloudflare Workers 构建兼容入口 |
| `npm run start:docker` | 以 Node runtime 启动 Docker 自部署服务 |
| `npm run cf:preview` | 使用标准 Cloudflare 配置启动 Wrangler 预览 |
| `npm run cf:deploy` | 使用标准 Cloudflare 配置部署到当前账号 |
| `npm run db:generate` | 根据 `db/schema.ts` 生成 Drizzle 迁移 |

本地 D1/R2 模拟状态保存在 `.wrangler/`。如需重新体验“全新机构首次进入”，停止开发服务器后删除本项目的 `.wrangler/`，再执行 `npm run dev`。

当前自动化测试目录是 `tests/`：

- `tests/rendered-html.test.mjs`：检查页面、API、部署配置和安全约束。
- `tests/auth-token.test.mjs`：执行 JWT 创建、校验、过期、篡改和畸形输入行为测试。
- `tests/learning-loop.test.mjs`：执行诊断完整题卷、次日复习门禁、重复评分保护，并检查掌握度、推荐排序、评分量规和增量迁移。
- `tests/learning-workflows.test.mjs`：使用真实 SQLite、存储、认证及 API 验证评分、受保护录音播放、家庭任务闭环、并发归档与增量迁移；仅外部模型响应使用测试替身。
- `tests/learning-loop-actions.test.mjs`：检查四端写操作、角色权限、租户范围和最新快照查询。
- `tests/learning-loop-ui.test.mjs`：检查十二项页面入口、空状态、移动端布局和 v1.2 文档约束。
- `tests/ui-polish.test.mjs`：检查来源化回答、工作流迁移、教案/家庭任务/内容归档、审计筛选、结构化质量指标、字体规范和家长数据去重。

## 🔐 安全报告

如果发现安全问题，请不要公开披露细节。请优先参考仓库中的 [SECURITY.md](./SECURITY.md) 提交安全报告。

## 📄 许可证

本项目基于 [GPL-3.0](./LICENSE) 开源。
