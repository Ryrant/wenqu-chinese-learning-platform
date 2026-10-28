<div align="center">
  <img src="./public/icon.svg" alt="华文知行 Logo" width="120" />
  <h1>华文知行协同教学平台</h1>
  <p>连接课堂学习、教师反馈与家庭交流的华文教学平台</p>
</div>

<p align="center">
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/releases"><img src="https://img.shields.io/github/v/release/Ryrant/wenqu-chinese-learning-platform?label=Release&color=3b82f6" alt="Release" /></a>
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/blob/main/LICENSE"><img src="https://img.shields.io/github/license/Ryrant/wenqu-chinese-learning-platform?color=10b981" alt="License" /></a>
  <a href="https://github.com/Ryrant/wenqu-chinese-learning-platform/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Ryrant/wenqu-chinese-learning-platform/ci.yml?branch=main&label=CI" alt="CI" /></a>
</p>

---

## ✨ 为什么做这个项目

华文教学需要连接课堂练习、教师评价和家庭交流。华文知行为海外华文学校提供学生、教师、家长和机构管理员四端工作台，将课程、作业、学习记录与家校反馈放在同一个平台，支持学校自行部署和管理数据。

## 🚀 核心能力

### 🎓 学习与教学

- 阅读、听力、图片口述与短文表达诊断，记录听说读写表现
- 今日学习计划、错题复习、分层练习与延后复测
- 常用汉字笔顺演示、田字格描红与独立书写，提供逐笔练习反馈
- 原创课文的拼音切换、点词释义、逐句设备朗读、个人生词本与词义自测
- 教师备课、任务发布、文字与录音作业批阅，以及班级学情查看
- 基于已审核教材的知识问答和 AI 辅助批阅，由教师确认最终评价

### 🏠 家校协作

- 家长切换已绑定的孩子，查看近期学习报告与作品
- 发布家庭交流任务，记录实际交流对象和帮助程度
- 家长反馈参与困难，教师追加处理办法并跟进
- 汇总练习、迁移任务与复测作品，生成可打印的单元证据报告

### 🏫 机构管理

- 管理成员账号、角色授权、班级编班和监护绑定
- 维护课程目标、诊断题库，上传并审核 PDF/DOCX/TXT 教材
- 查看教学质量、班级试用记录与操作审计
- 支持 Cloudflare Workers + D1 + R2 或 Docker + SQLite 自部署

## ⚡ 快速开始

### 📋 前置要求

- Docker 方式：Docker Engine 与 Docker Compose V2
- Cloudflare 方式：Cloudflare 账号与 GitHub 账号
- 外部 AI 服务可在部署后配置，不影响基础教学功能

### 📦 Docker 自部署

获取源码并构建仓库 Compose 配置使用的镜像：

```bash
git clone https://github.com/Ryrant/wenqu-chinese-learning-platform.git
cd wenqu-chinese-learning-platform
docker build -t ghcr.io/ryrant/huawen-zhixing:latest .
docker compose up -d --pull never
docker compose logs -f
```

本机访问 [http://localhost:3000](http://localhost:3000)。远程使用时通过 HTTPS 域名访问；同机反向代理可将 `compose.yaml` 的端口映射改为 `127.0.0.1:3000:3000`。

仓库的 `compose.yaml` 也可拉取预构建镜像。具备 `ghcr.io/ryrant/huawen-zhixing:latest` 的访问权限时，可用 `docker compose pull` 和 `docker compose up -d` 替代本地构建；需要认证时先执行 `docker login ghcr.io`。

### ☁️ Cloudflare 部署

Fork 本仓库，在 Cloudflare Workers 连接 GitHub 仓库，并填写：

| 配置项 | 内容 |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

D1/R2 由部署流程自动创建，绑定名分别为 `DB` 和 `CONTENT`。部署后打开分配的 Worker URL。

也可以使用一键部署：

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Ryrant/wenqu-chinese-learning-platform)

已有本地源码时，可用 Wrangler 部署：

```bash
npm ci
npx wrangler login
npm run cf:deploy
```

### 🔧 首次初始化

1. Docker 或 Cloudflare 部署后，打开站点首页，填写机构名称、管理员邮箱和密码，显示名称可选。
2. 初始化完成后进入管理员工作台，创建教师、学生和家长的成员账号，配置角色、班级与监护关系。
3. 需要 AI 功能时，在「平台设置」中填写 OpenAI Key 和模型名称。

首个账号只拥有管理员角色；其他角色需单独授权。新成员首次登录修改临时密码后，才能使用业务功能。

## 📖 使用说明

按 **机构配置 → 教师发布 → 学生学习 → 家长查看** 完成一次教学流程：

| 角色 | 主要操作 |
| --- | --- |
| 机构管理员 | 创建成员、编班和绑定监护人，维护课程目标、诊断题库与教材内容权属 |
| 教师 | 发布诊断和作业，批阅作品，安排分层练习、迁移任务和复测 |
| 学生 | 完成今日任务，提交文字或录音，复习错题并查看反馈 |
| 家长 | 查看孩子报告，参与家庭交流任务，确认帮助程度并反馈困难 |

账号只能进入已授权的工作台，教师按班级、家长按监护绑定访问学生记录。

### 💾 数据与备份

- Docker 数据卷挂载到 `/data`，保存数据库 `/data/huawen-zhixing.db` 和上传目录 `/data/uploads`。
- 备份 Docker 数据时先停止服务，备份整个数据卷后再启动；更新容器时保留原数据卷，不要执行 `docker compose down -v`。
- Cloudflare 的结构化数据保存在 D1，教材、图片和录音保存在 R2，需分别备份。

源码构建方式更新：

```bash
git pull --ff-only
docker build -t ghcr.io/ryrant/huawen-zhixing:latest .
docker compose up -d --pull never
```

## 🧠 功能细节

### 📚 教材与 AI

教材经过内容权属与发布审核后，才参与知识问答和备课检索。未配置外部模型时，平台使用已审核片段提供基础回答；没有依据时提示资料不足。

语音评测与内容审核 Key 目前仅保存凭据，录音由教师人工评价，内容审核使用基础规则。

### 📝 学习与评价

自适应学习闭环围绕诊断数据、目标与实际作品安排后续练习。家庭任务保留交流要求和帮助记录；迁移与复测用于对照新情境中的表现，成绩由教师确认。

练习页面支持直达链接：交互阅读使用 `lessonId`，汉字书写使用 `character`，生词复习和听写使用 `sessionId`。例如 `/student/reading?lessonId=library-friend`、`/student/writing?character=月`；指定轮次不可见时会说明原因，不切换成其他轮次。工作台切页保留原选择，浏览器前进、后退按链接恢复。

学生可在「汉字书写」练习 12 个常用字。笔顺数据随项目提供，练习时无需外部 CDN；完成后按本人账号保存练习方式、重试次数、主动提示次数与本轮用时，刷新后可回看。逐笔反馈不计入课程成绩。笔顺数据与书写库的来源及许可保留在 `public/hanzi/`。

「交互阅读」提供三篇平台原创课文，并展示班级教师发布的课文。学生可切换拼音、点词查看释义，并用设备的中文语音逐句朗读。生词本按机构和本人账号保存，保留收藏时的释义及例句；词义小练习从本篇重点词语生成，由服务器校对答案并保存自测结果，不写入课程成绩。设备没有可用中文语音时，仍可使用其他阅读功能。

教师在「课文工作台」编写自己原创或已获授权的正文，每行一句；可辅助补入现有词库的标注，再编辑拼音、释义与 4–12 个重点词。发布前需补齐正文中文的标注、核对读音和本篇词义，并可使用学生阅读预览。草稿仅教师可见，发布后仅班内有效学籍学生可读取；已发布课文可直接发布修改，或另存为独立新草稿，保留原发布版本。新作答检查课文版本，已收藏的词保留收藏时释义；已开始的主题轮次继续使用开始时快照，课文归档后不再进入新的主题轮次。

教师在「情境任务」勾选“同时发布为主题闯关”，关联平台课文或本班已发布课文，以及其中的 1–4 个练习字。学生在「主题闯关」依次完成阅读自测、汉字书写和情境对话，关卡按实际保存记录推进，刷新或切换工作台后可继续；每轮保留开始时的课文、练习字与对话版本。三关结束后显示本轮学习小结，情境任务归档或学籍撤回后只能回看历史记录。关卡完成表示完成了练习，不自动认定语言能力达标。

「生词复习」从本人收藏词语中安排每轮最多 5 个词，提供词义配对和选词填空；错词在本轮最多回练两次。到期复习按首次回答安排固定的 1、3、7、14 天间隔，首次答错从约一天后重新开始，纠正重答不增加阶段；自由练习保留原到期安排。每人同时保留一轮进行中的练习，可刷新续练、提前结束并保留已做部分，也可回看最近 10 轮。移除收藏后不再为该词安排复习，已完成记录仍保留。复习安排在页面内展示，不发送站外提醒，不用于课程评分。

「接下来做什么」在学习分析授权有效时，把本人未完成的主题、生词和听写，以及到期生词、待纠正听写错项接入今日计划。最多展示三项，教师安排与临近截止任务优先，其后安排续练、到期复习和错项练习；每项保留安排原因并直达对应轮次。进入练习不直接标记完成，保存成功后会刷新计划。错项按显式重练关系追踪后续回答，提前结束重练仍保留未纠正项，原始作答保持不变；私人自主练习不会通过教师或家长查看学生计划的入口共享。

「成长档案 → 日常练习」按保存或开始时间回看最近 7 天或 30 天的书写、阅读自测、生词复习、听写和主题记录，分别统计各模块，不将主题与子练习相加计分。统计覆盖完整选定范围，时间线使用稳定游标分页；可展开查看内容快照、原始作答、参考答案、提示及查看参考情况，也可直达对应内容或轮次。生词首次作答与重复纠正分别保留；提前结束与完整完成明确区分。学习分析授权未生效或撤回时暂停汇总，仍保留本人原始练习的回看。

「听写实验室」支持生词本词语、可访问课文的重点词和短句，每轮最多 5 项。使用设备普通话语音播放，输入后逐字核对漏写、多写与不同字，忽略空格、标点、全半角和英文字母大小写；设备不支持普通话时，可查看参考进行对照练习，并明确记录“已查看参考”。结果按本人账号保存，可刷新续练、回看最近 10 轮，并把错项另开一轮重练。每轮保留开始时的内容快照，课文归档或学籍撤回后只可回看已有结果。播放次数按练习操作记录，不作防作弊或发音评测，不计入课程成绩。

教师在「情境任务」从点餐、借书、问路三个模板中修改角色、表达目标、可匹配表达、追问与提示，并发布到自己的班级。班内学生在「情境闯关」进行多轮文字对话、查看帮助和重练；教师可回看原始发言、匹配表达与提示次数。每轮保留开始时的任务版本，归档情境或移除学籍后不能继续练习，已有记录仍保留。学生页面展示最近 20 轮，教师展示所辖班级最近 50 轮。

情境推进使用教师设定的表达包含规则，每次发言最多推进一项；规则匹配不代表语义正确或语言能力达标，也不写入课程成绩。默认使用教师脚本，可单独启用 AI 辅助角色回复：复用平台已配置的 OpenAI 服务和模型，发送情境、学生发言与最近对话；使用 `store: false`，不请求服务端保存 Responses 对象。未配置或调用失败时回退教师脚本，每条回复显示实际来源。当前功能仅处理文字，不包含语音识别或发音评分。

### 🔐 账号与数据

正式部署使用邮箱、密码登录，按机构、角色和关系校验访问权限。改密会撤销旧会话。公开部署请使用 HTTPS，并在反向代理或 Cloudflare 侧为登录接口设置限流。

管理员可在“权限审计”查看账号登录成功、失败及机构操作，按账号、操作类型、登录 IP 和北京时间日期筛选。登录记录包含邮箱、时间、IP、结果与浏览器信息；新版本上线前未采集的信息无法补录。未知邮箱没有机构归属，不出现在机构审计中。

Node.js 默认记录直接连接的 IP；经反向代理部署时，仅在应用端口只允许可信代理访问、且代理覆盖 `X-Forwarded-For` 的前提下设置 `HUAWEN_ZHIXING_TRUST_PROXY=true`，以记录访客 IP。Cloudflare Workers 使用平台提供的 `CF-Connecting-IP`。

## 🧱 技术栈

- 前端：React、TypeScript、Vite、React Router、shadcn/ui、Tailwind CSS
- 后端：Hono、Drizzle ORM，共用 Cloudflare Workers 与 Node.js API
- 存储：D1 / SQLite、R2 / 本地文件
- 部署：Cloudflare Workers、Docker Compose

## 🗂️ 项目结构

```text
wenqu-chinese-learning-platform/
├── app/                 # 前端入口、全局样式与 API 处理器
├── components/          # 四端页面、业务组件与 UI 基础组件
├── hooks/               # 工作区状态与数据读取
├── lib/                 # 认证、权限及教学业务
├── db/                  # 数据模型
├── server/              # Hono 与 Node.js 服务入口
├── worker/              # Cloudflare Worker 入口
├── public/              # 图标与静态资源
├── scripts/             # 构建与 Docker 启动脚本
├── tests/               # 自动化测试
├── .github/             # CI、镜像发布与 Issue 表单
├── Dockerfile           # 多阶段镜像构建
├── compose.yaml         # Docker 编排
└── wrangler.toml        # Cloudflare 绑定与部署配置
```

## 👨‍💻 本地开发

### 🧰 环境

- Node.js 22.13.0 或更高版本
- npm、Git

### ⚙️ 命令

```bash
git clone https://github.com/Ryrant/wenqu-chinese-learning-platform.git
cd wenqu-chinese-learning-platform
npm ci
npm run dev
```

访问 [http://127.0.0.1:3000](http://127.0.0.1:3000)。开发模式使用本地 D1/R2，空库自动创建开发管理员；正式登录流程可通过 `npm run build` 后执行 `npm start` 验证。

```bash
npm run lint
npm test
npm run build
```

## 🔐 安全报告

如果发现安全问题，请不要公开披露细节。请优先参考仓库中的 [SECURITY.md](./SECURITY.md) 提交安全报告。

## 📄 许可证

本项目基于 [GPL-3.0](./LICENSE) 开源。

<div align="center">
  <sub>Built with ❤️ by Sunny</sub>
</div>
