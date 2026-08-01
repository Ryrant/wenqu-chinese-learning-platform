import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("local template answers from reviewed excerpts without repeating the question", async () => {
  const { buildTemplateAnswer } = await import("../app/lib/ai/template-answer.mjs");
  const prompt = "中秋节为什么代表团圆？";
  const answer = buildTemplateAnswer(prompt, [
    "中秋节常以圆月和月饼象征家人团聚，圆形代表圆满与相聚。",
    "团圆是中秋节的重要文化主题。",
  ]);
  assert.match(answer, /圆月和月饼象征家人团聚/);
  assert.match(answer, /重要文化主题/);
  assert.doesNotMatch(answer, new RegExp(prompt.replace(/[?？]/g, "")));
  assert.equal(buildTemplateAnswer("没有答案的问题", []), "未从已审核来源中找到足够信息，暂时无法回答这个问题。");
});

test("ui workflow migration is additive and runtime initialization stays idempotent", async () => {
  const [migration, schema, store, baseline] = await Promise.all([
    read("drizzle/0005_ui_workflow.sql"),
    read("db/schema.ts"),
    read("app/lib/platform-store.ts"),
    read("scripts/baseline-d1-migrations.sql"),
  ]);
  for (const table of ["lesson_plans", "learning_recommendations", "source_documents"]) {
    assert.match(migration, new RegExp("ALTER TABLE `" + table + "` ADD COLUMN `updated_at`"));
    assert.match(migration, new RegExp("ALTER TABLE `" + table + "` ADD COLUMN `archived_at`"));
  }
  assert.doesNotMatch(migration, /\bDROP\b|\bRENAME\b/i);
  assert.match(schema, /updatedAt: text\("updated_at"\)/);
  assert.match(schema, /archivedAt: text\("archived_at"\)/);
  assert.match(store, /ALTER TABLE lesson_plans ADD COLUMN updated_at TEXT/);
  assert.match(store, /ALTER TABLE learning_recommendations ADD COLUMN archived_at TEXT/);
  assert.match(store, /ALTER TABLE source_documents ADD COLUMN archived_at TEXT/);
  assert.match(baseline, /0005_ui_workflow\.sql/);
  for (const column of ["lesson_plans.*updated_at", "lesson_plans.*archived_at", "learning_recommendations.*updated_at", "learning_recommendations.*archived_at", "source_documents.*updated_at", "source_documents.*archived_at"]) {
    const [table, name] = column.split(".*");
    assert.match(baseline, new RegExp(`pragma_table_info\\('${table}'\\)[\\s\\S]*name='${name}'`));
  }
});

test("workspace actions expose tenant-scoped editable and archival workflows", async () => {
  const [actions, service, workspace] = await Promise.all([
    read("app/api/v1/workspace/actions/route.ts"),
    read("app/lib/learning-loop-service.ts"),
    read("app/api/v1/workspace/route.ts"),
  ]);
  for (const action of ["update_lesson_plan", "archive_lesson_plan", "update_family_task", "archive_family_task", "reprocess_content", "archive_content"]) {
    assert.match(actions, new RegExp(action));
  }
  assert.match(actions, /status='archived'/);
  assert.match(actions, /updated_at=CURRENT_TIMESTAMP/);
  assert.match(service, /created_by AS createdBy/);
  assert.match(service, /source_type='family'/);
  assert.match(workspace, /archived_at IS NULL/);
  assert.match(workspace, /previewChunks/);
});

test("admin audit API supports tenant-scoped filters and pagination", async () => {
  const route = await read("app/api/v1/workspace/audits/route.ts");
  for (const field of ["action", "actorId", "from", "to", "cursor"]) assert.match(route, new RegExp(field));
  assert.match(route, /platformContext\(request, "admin"\)/);
  assert.match(route, /tenant_id=\?/);
  assert.match(route, /LIMIT \?/);
  assert.match(route, /actorDisplayName/);
  assert.match(route, /nextCursor/);
});

test("workspace returns structured quality metrics with real denominators and details", async () => {
  const [types, workspace, views] = await Promise.all([
    read("app/lib/platform-types.ts"),
    read("app/api/v1/workspace/route.ts"),
    read("app/learning-loop-views.tsx"),
  ]);
  assert.match(types, /export type QualityMetric/);
  for (const key of ["numerator", "denominator", "unit", "details", "trendAvailable"]) {
    assert.match(types, new RegExp(key));
    assert.match(workspace, new RegExp(key));
  }
  assert.match(views, /暂无趋势数据/);
  assert.match(views, /quality-detail/);
});

test("four-end UI uses readable typography and explicit management controls", async () => {
  const [css, student, staff, loop, members] = await Promise.all([
    read("app/globals.css"),
    read("app/student-view.tsx"),
    read("app/staff-views.tsx"),
    read("app/learning-loop-views.tsx"),
    read("app/member-management-view.tsx"),
  ]);
  for (const token of ["--font-body:16px", "--font-control:15px", "--font-caption:13px"]) assert.match(css, new RegExp(token));
  assert.match(css, /\.teacher-class-grid\{grid-template-columns:minmax\(0,2fr\) minmax\(0,3fr\)/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(student, /根据已审核来源：/);
  assert.match(student, /来源化回答 · 已关联审核资料/);
  assert.match(staff, /编辑草稿/);
  assert.match(staff, /归档草稿/);
  assert.match(staff, /选择待批阅作品/);
  assert.match(loop, /重新打开/);
  assert.match(loop, /归档任务/);
  assert.match(loop, /当前孩子/);
  assert.match(loop, /暂无趋势数据/);
  assert.match(members, /监护人/);
  assert.match(members, /学生/);
});

test("institution UI localizes service content and audit status", async () => {
  const staff = await read("app/staff-views.tsx");
  for (const label of ["数据库", "文件存储", "知识检索", "内容生成", "语音评测", "内容审核", "内置模式", "人工复核", "基础规则"]) {
    assert.match(staff, new RegExp(label));
  }
  for (const label of ["查看片段", "重新处理", "归档资料", "操作类型", "操作者", "开始日期", "结束日期", "加载更多"]) {
    assert.match(staff, new RegExp(label));
  }
  assert.match(staff, /TARGET_LABELS/);
  for (const key of ["platform-settings", "content-center", "knowledge-search", "permission-audit"]) assert.match(staff, new RegExp(`key="${key}"`));
});

test("guardian child selector de-duplicates repeated active bindings", async () => {
  const workspaceRoute = await read("app/api/v1/workspace/route.ts");
  assert.match(workspaceRoute, /SELECT DISTINCT u\.id,u\.display_name AS displayName/);
});

test("initial admin audit records include actor display names", async () => {
  const workspaceRoute = await read("app/api/v1/workspace/route.ts");
  assert.match(workspaceRoute, /u\.display_name AS actorDisplayName/);
  assert.match(workspaceRoute, /audit_logs a LEFT JOIN users u ON u\.id=a\.actor_user_id/);
});
