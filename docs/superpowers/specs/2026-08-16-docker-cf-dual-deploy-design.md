# 文趣平台 Docker + Cloudflare 双部署设计

## 背景

当前项目以 Cloudflare Workers 为主要运行环境：

- Worker 入口位于 `worker/index.ts`。
- `wrangler.toml` 绑定 D1 数据库 `DB` 与 R2 Bucket `CONTENT`。
- `app/lib/platform-store.ts` 直接从 `cloudflare:workers` 读取运行时绑定。
- 教材、音频和内容重处理直接使用 R2 API。
- 认证、租户、角色、学习数据、审计和平台设置都保存在 D1。

目标不是抛弃 Cloudflare，而是让平台同时具备两种部署形态：

- Cloudflare 部署继续使用 Workers + D1 + R2。
- Docker 部署使用 Node runtime + SQLite + 本地文件存储。

第一阶段优先实现单机自部署能力，避免引入 Postgres、MinIO、Redis、队列或外部身份服务。

## 目标

1. 保留现有 Cloudflare 部署方式和现有用户功能。
2. 新增 Docker Compose 部署方式。
3. Docker 版使用 SQLite 文件保存结构化数据。
4. Docker 版使用本地目录保存上传教材、图片和音频。
5. 抽离 Cloudflare 专属依赖，使业务 API 不直接依赖 `cloudflare:workers`。
6. 保持现有数据模型、角色模型和页面交互基本不变。

## 非目标

以下事项不纳入第一阶段：

- 不实现 D1 与 SQLite 之间的自动双向迁移。
- 不引入 Postgres 或 MySQL。
- 不引入 MinIO 或外部 S3 服务。
- 不重做用户体系、权限模型或页面信息架构。
- 不把 Cloudflare 部署降级为二等路径。
- 不做多实例横向扩展支持。
- 不做生产级集中式日志、队列或对象生命周期管理。

## 推荐架构

采用“业务层不感知具体云厂商”的结构：

```text
页面 / API Route
  ↓
平台上下文 platformContext
  ↓
PlatformRuntime
  ├─ database: PlatformDatabase
  │   ├─ CloudflareD1Adapter
  │   └─ NodeSqliteAdapter
  └─ storage: PlatformStorage
      ├─ CloudflareR2Adapter
      └─ LocalFileStorageAdapter
  ↓
部署入口
  ├─ Cloudflare Worker
  └─ Docker Node Server
```

业务代码只依赖 `PlatformRuntime`，不直接读取 Cloudflare `env`。

## 数据库设计

### 统一接口

定义一个最小数据库接口，兼容当前 D1 调用风格：

```ts
export interface PlatformDatabase {
  prepare(sql: string): PlatformPreparedStatement;
  batch<T = unknown>(statements: PlatformPreparedStatement[]): Promise<T[]>;
}

export interface PlatformPreparedStatement {
  bind(...values: unknown[]): PlatformPreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
}
```

Cloudflare 适配器包装 D1；Docker 适配器包装 Node SQLite 库。

### SQLite 选型

第一阶段建议使用 SQLite，数据库文件挂载到 Docker volume：

```text
/data/wenqu.db
```

原因：

- 与 D1 同属 SQLite 方言，迁移成本低。
- 部署简单，适合个人、学校或小机构自托管。
- 不需要额外数据库容器。

Node SQLite 具体库应在实施阶段评估。优先选择维护稳定、支持 prepared statement、部署复杂度低的库。新增依赖前需要说明理由。

### Schema 策略

保留当前运行时幂等建表逻辑，改为通过 `PlatformDatabase` 执行。这样 D1 与 SQLite 可以共享初始化路径。

Drizzle schema 继续作为模型定义来源，但第一阶段不要求完整改造成 Drizzle runtime 查询。

## 文件存储设计

### 统一接口

定义对象存储接口：

```ts
export interface PlatformStorage {
  put(key: string, body: ReadableStream, options?: StoragePutOptions): Promise<void>;
  get(key: string): Promise<PlatformStoredObject | null>;
}
```

Cloudflare 部署映射到 R2。

Docker 部署映射到本地目录：

```text
/data/uploads
```

对象 key 继续沿用当前格式：

```text
<tenantId>/sources/<documentId>/<safeName>
<tenantId>/submissions/<submissionId>/recording.webm
```

本地存储适配器必须防止路径穿越：写入前将 key 解析到绝对路径，并确认最终路径仍位于上传根目录内。

## 运行时上下文设计

新增运行时解析层：

```ts
export type PlatformRuntime = {
  database: PlatformDatabase;
  storage: PlatformStorage;
};
```

Cloudflare 入口从 Worker env 构建 runtime：

```ts
createCloudflareRuntime(env)
```

Node/Docker 入口从环境变量构建 runtime：

```ts
createNodeRuntime({
  databaseUrl: process.env.DATABASE_URL,
  uploadDir: process.env.UPLOAD_DIR,
})
```

`platformContext(request)` 不再直接 import `cloudflare:workers`，而是通过运行时解析函数拿到 database 和 storage。

## Docker 部署设计

新增文件：

- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `scripts/start-node-server.mjs` 或等价 Node 启动入口

Docker Compose 默认配置：

```yaml
services:
  wenqu:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: file:/data/wenqu.db
      UPLOAD_DIR: /data/uploads
    volumes:
      - wenqu-data:/data

volumes:
  wenqu-data:
```

端口默认使用 `3000`。

首次启动时：

1. 创建 SQLite 数据库文件。
2. 初始化 schema。
3. 页面进入现有首次管理员初始化流程。
4. 上传文件写入 `/data/uploads`。

## Cloudflare 部署保持方式

Cloudflare 路径继续保留：

- `npm run build`
- `npm run cf:preview`
- `npm run cf:deploy`
- `wrangler.toml`
- D1 binding：`DB`
- R2 binding：`CONTENT`

Cloudflare 适配器应尽量薄，只负责把 D1/R2 转成统一接口。

## 认证与角色模型

第一阶段不重做认证模型。

继续使用：

- 首次初始化创建管理员账号。
- `users` 保存账号身份。
- `role_memberships` 保存租户内角色。
- `guardian_student_links` 保存家长与学生绑定。
- `invitations` 保存邀请。
- `audit_logs` 保存管理员和关键业务操作。

需要补充文档说明：

- 管理员：成员、内容、课程目标、诊断题、班级编排、审计。
- 教师：班级、作业、批阅、干预、教案。
- 学生：诊断、学习计划、作业提交、错题复习。
- 家长：孩子切换、成长报告、家庭任务、授权。

`reviewer` 当前只出现在 schema 枚举和 review 字段语义中，第一阶段建议不作为独立可选角色暴露。要么后续补完整 reviewer 工作流，要么清理为字段命名语义，避免角色模型误导。

## 错误处理

运行时错误应区分：

- 数据库不可用：返回 `database_unavailable`。
- 存储不可用：上传和重处理返回 `storage_unavailable`。
- 本地路径非法：返回 `invalid_storage_key`。
- SQLite 初始化失败：启动失败并输出明确日志。
- Cloudflare binding 缺失：保持现有健康检查降级语义。

Docker 版启动时必须 fail-fast，避免在没有可写 `/data` 的情况下伪成功运行。

## 测试策略

最小验证集：

1. 现有 `npm run lint` 通过。
2. 现有 `npm test` 通过，证明 CF 路径未回归。
3. 新增 SQLite 适配器单元测试：
   - `prepare().bind().first()`
   - `all()`
   - `run()` changes
   - `batch()`
4. 新增本地存储测试：
   - 写入文件
   - 读取文件
   - 拒绝路径穿越 key
5. Docker Compose 冒烟测试：
   - 容器启动成功
   - `/api/v1/health` 返回可用或预期状态
   - 首次初始化页面可访问

## 实施分期

### Phase 1：抽象接口

- 新增 `PlatformDatabase` 和 `PlatformStorage` 接口。
- 包装 D1/R2 为 Cloudflare 适配器。
- 让现有业务通过 runtime 获取数据库和存储。
- 保持功能行为不变。

### Phase 2：Node SQLite 与本地存储

- 新增 SQLite 适配器。
- 新增本地文件存储适配器。
- 新增 Node runtime 构建逻辑。
- 补充适配器测试。

### Phase 3：Docker 入口与文档

- 新增 Dockerfile 与 docker-compose.yml。
- 新增 Docker 启动命令。
- README 增加 Docker 部署方式。
- 保留 Cloudflare 部署说明。

### Phase 4：验证与收敛

- 跑现有测试。
- 跑 Docker 冒烟测试。
- 复核 Cloudflare 相关命令未被破坏。
- 明确第一阶段限制和后续可选扩展。

## 风险与约束

- Vinext 当前是否支持标准 Node server 入口需要在实施计划阶段验证。如果不支持，需要选择最小可行的 Node 运行入口或调整 Docker 策略。
- SQLite Node 依赖可能涉及原生模块，Dockerfile 需要固定 Node 版本和构建方式。
- D1 与 SQLite 方言接近但不完全等价，必须用测试覆盖 schema 初始化和关键查询。
- 本地文件存储必须严格防路径穿越。
- 第一阶段不支持多容器横向扩展，文档必须写清楚。

## 验收标准

1. Cloudflare 部署路径仍存在且命令不变。
2. Docker Compose 可以在空数据卷下启动。
3. Docker 版可以完成首次管理员初始化。
4. Docker 版可以创建成员并看到角色列表。
5. Docker 版可以上传文本或教材文件，并在本地数据卷中保存对象。
6. 现有测试通过。
7. README 明确区分 Cloudflare 部署和 Docker 自部署。

