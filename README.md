# 文趣 · 华文趣味教学助手

面向海外华文学校的多租户教学平台。当前版本已把首版展示页升级为可持久化的学生、教师、家长和机构工作区。

## 已实现的真实模块

- 身份与租户：读取 Sites 转发的登录邮箱，创建隔离工作区，服务端校验角色；受邀成员首次登录自动加入对应租户。
- 学生：读取已发布任务、提交文字作业、浏览器真实录音、R2 保存音频、D1 审核队列、基于已发布来源的问答。
- 教师：创建班级和任务、审核发布、生成并保存来源化教案、查看提交、人工评分与审计记录。
- 家长：查看由掌握度快照和审核结果生成的报告、保存家庭练习提醒、管理学习分析授权。
- 机构：上传教材到 R2、保存权属元数据、审核发布、关键词检索、成员邀请、服务配置状态与审计日志。
- 数据：21 张 D1 表，覆盖教学、内容、授权、通知、邀请、教案、AI 会话、引用和审计；关键查询均带 `tenant_id` 与角色范围。

## 诚实的降级策略

生产环境当前没有配置外部文本生成或语音评分密钥。平台不会返回伪造的模型可用率或发音分数：

- 备课与学生问答使用已审核知识片段驱动的确定性教学模板，并显示引用来源。
- 语音会真实录制并保存到 R2，评分状态进入教师人工复核。
- `/api/v1/health` 明确返回 `configured`、`template` 或 `manual` 状态。

## 主要接口

- `GET /api/v1/workspace`：角色范围内的工作区聚合数据
- `POST /api/v1/workspace/actions`：班级、任务、发布、评分、提醒、授权、邀请与内容审核命令
- `POST /api/v1/ai/generate`：带引用的 SSE 教学草稿
- `POST /api/v1/knowledge/search`：租户隔离的已发布内容检索
- `POST /api/v1/content/upload`：R2 文件上传与 D1 元数据
- `POST /api/v1/speech/submissions`：语音作业上传与人工复核队列
- `POST /api/v1/submissions`、`POST /api/v1/feedback`、`GET /api/v1/health`

## 本地校验

```bash
npm ci
npm run dev
npm run build
node --test tests/rendered-html.test.mjs
```

生产绑定：`DB` 为 D1，`CONTENT` 为 R2。数据库迁移位于 `drizzle/`。
