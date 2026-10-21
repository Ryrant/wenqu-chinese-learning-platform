import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema } from './lib/platform-store';
    export { lessonsCommands } from './lib/commands/lessons';
    export { contentCommands } from './lib/commands/content';
    export { publishContent } from './lib/content-processing';
    export { membershipCommands } from './lib/commands/membership';
    export { notificationsCommands } from './lib/commands/notifications';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function fixture(t, { sourceStatus = "published", sourceText = "重新解析后的阅读教材。" } = {}) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: {
    get: async () => ({ arrayBuffer: () => new Response(sourceText).arrayBuffer() }),
  } });
  t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','测试学校')"),
    db.prepare("INSERT INTO users(id,email,display_name) VALUES ('teacher','teacher@example.test','教师')"),
    db.prepare("INSERT INTO source_documents(id,tenant_id,title,object_key,media_type,rights_status,processing_status,created_by) VALUES ('source','school','教材.txt','school/source.txt','text/plain','approved',?,'teacher')").bind(sourceStatus),
    db.prepare("INSERT INTO knowledge_chunks(id,tenant_id,source_document_id,content,published) VALUES ('chunk','school','source','阅读教材讲述人物、动作和主题。',?)").bind(sourceStatus === "published" ? 1 : 0),
    db.prepare("INSERT INTO lesson_plans(id,tenant_id,title,topic,level,duration_minutes,created_by) VALUES ('lesson','school','原教案','原主题','A2',30,'teacher')"),
  ]);
  const context = { db, tenantId: "school", userId: "teacher", userEmail: "teacher@example.test", displayName: "教师", roles: ["admin", "teacher"] };
  const count = async (table, where = "1=1") => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${where}`).first()).count;
  const rejectAudit = (action) => db.prepare(`CREATE TRIGGER reject_command_audit BEFORE INSERT ON audit_logs WHEN NEW.action='${action}' BEGIN SELECT RAISE(ABORT,'fixture_audit_failed'); END`).run();
  const resumeAudit = () => db.prepare("DROP TRIGGER reject_command_audit").run();
  const command = (name, body = {}) => {
    const handler = api.lessonsCommands[name] ?? api.contentCommands[name] ?? api.membershipCommands[name] ?? api.notificationsCommands[name];
    return handler({ action: name, ...body }, context, name);
  };
  return { db, context, count, rejectAudit, resumeAudit, command };
}

test("生成教案的正文、AI 会话、引用和审计共同回滚，重试只保存一次", async (t) => {
  const f = await fixture(t);
  await f.rejectAudit("lesson_plan.generated");
  await assert.rejects(f.command("generate_lesson", { topic: "阅读教材" }), /fixture_audit_failed/);
  assert.equal(await f.count("lesson_plans"), 1, "只保留原有教案");
  for (const table of ["ai_sessions", "citations", "audit_logs"]) assert.equal(await f.count(table), 0);
  await f.resumeAudit();
  const response = await f.command("generate_lesson", { topic: "阅读教材" });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(await f.count("lesson_plans"), 2);
  assert.equal(await f.count("ai_sessions"), 1);
  assert.equal(await f.count("citations"), result.citations.length);
  assert.ok(result.citations.length > 0);
  assert.equal(await f.count("audit_logs", "action='lesson_plan.generated'"), 1);
});

for (const [action, auditAction, body] of [
  ["update_lesson_plan", "lesson_plan.updated", { id: "lesson", title: "新教案", topic: "新主题", level: "B1", duration: 45, objectives: ["新目标"], activities: [{ title: "阅读" }] }],
  ["archive_lesson_plan", "lesson_plan.archived", { id: "lesson" }],
]) {
  test(`${action} 的审计失败保留原教案，重试只记录一次变更`, async (t) => {
    const f = await fixture(t);
    const before = await f.db.prepare("SELECT * FROM lesson_plans WHERE id='lesson'").first();
    await f.rejectAudit(auditAction);
    await assert.rejects(f.command(action, body), /fixture_audit_failed/);
    assert.deepEqual(await f.db.prepare("SELECT * FROM lesson_plans WHERE id='lesson'").first(), before);
    assert.equal(await f.count("audit_logs"), 0);
    await f.resumeAudit();
    assert.equal((await f.command(action, body)).status, 200);
    const after = await f.db.prepare("SELECT * FROM lesson_plans WHERE id='lesson'").first();
    if (action === "update_lesson_plan") assert.equal(after.title, "新教案");
    else { assert.equal(after.status, "archived"); assert.ok(after.archived_at); }
    assert.equal(await f.count("audit_logs", `action='${auditAction}'`), 1);
  });
}

for (const [action, auditAction, table, body] of [
  ["create_reminder", "reminder.created", "notifications", { title: "阅读提醒", scheduledFor: "2026-10-22T12:00:00Z" }],
]) {
  test(`${action} 的审计失败不留下记录，重试只创建一次`, async (t) => {
    const f = await fixture(t);
    await f.rejectAudit(auditAction);
    await assert.rejects(f.command(action, body), /fixture_audit_failed/);
    assert.equal(await f.count(table), 0);
    assert.equal(await f.count("audit_logs"), 0);
    await f.resumeAudit();
    assert.equal((await f.command(action, body)).status, 201);
    assert.equal(await f.count(table), 1);
    assert.equal(await f.count("audit_logs", `action='${auditAction}'`), 1);
  });
}

test("并发归档和失效编辑只为真正改变教案的操作写审计", async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([
    f.command("update_lesson_plan", { id: "lesson", title: "失效编辑", topic: "新主题", level: "A2", objectives: ["目标"], activities: [{ title: "阅读" }] }),
    f.command("archive_lesson_plan", { id: "lesson" }),
    f.command("archive_lesson_plan", { id: "lesson" }),
  ]);
  assert.deepEqual(responses.map((response) => response.status), [404, 200, 404]);
  const lesson = await f.db.prepare("SELECT title,status FROM lesson_plans WHERE id='lesson'").first();
  assert.deepEqual(lesson, { title: "原教案", status: "archived" });
  assert.equal(await f.count("audit_logs", "action='lesson_plan.updated'"), 0);
  assert.equal(await f.count("audit_logs", "action='lesson_plan.archived'"), 1);
});

for (const [action, status, sourceStatus, auditAction] of [
  ["review_content", "published", "processed", "source.reviewed"],
  ["review_content", "rejected", "published", "source.reviewed"],
  ["archive_content", "archived", "published", "source.archived"],
]) {
  test(`资料 ${status} 的审计失败回滚文档和知识片段，重试只记录一次`, async (t) => {
    const f = await fixture(t, { sourceStatus });
    const before = await f.db.prepare("SELECT * FROM source_documents WHERE id='source'").first();
    const chunksBefore = await f.db.prepare("SELECT * FROM knowledge_chunks ORDER BY id").all();
    await f.rejectAudit(auditAction);
    await assert.rejects(f.command(action, { id: "source", status }), /fixture_audit_failed/);
    assert.deepEqual(await f.db.prepare("SELECT * FROM source_documents WHERE id='source'").first(), before);
    assert.deepEqual(await f.db.prepare("SELECT * FROM knowledge_chunks ORDER BY id").all(), chunksBefore);
    assert.equal(await f.count("audit_logs"), 0);
    await f.resumeAudit();
    assert.equal((await f.command(action, { id: "source", status })).status, 200);
    assert.equal((await f.db.prepare("SELECT processing_status FROM source_documents WHERE id='source'").first()).processing_status, status);
    assert.equal((await f.db.prepare("SELECT published FROM knowledge_chunks WHERE id='chunk'").first()).published, status === "published" ? 1 : 0);
    assert.equal(await f.count("audit_logs", `action='${auditAction}'`), 1);
  });
}

test("重新解析时审计失败保留已发布内容，重试仅替换一次并增加一个版本", async (t) => {
  const f = await fixture(t);
  const before = await f.db.prepare("SELECT * FROM source_documents WHERE id='source'").first();
  const chunksBefore = await f.db.prepare("SELECT * FROM knowledge_chunks ORDER BY id").all();
  await f.rejectAudit("source.reprocessed");
  await assert.rejects(f.command("reprocess_content", { id: "source" }), /fixture_audit_failed/);
  assert.deepEqual(await f.db.prepare("SELECT * FROM source_documents WHERE id='source'").first(), before);
  assert.deepEqual(await f.db.prepare("SELECT * FROM knowledge_chunks ORDER BY id").all(), chunksBefore);
  assert.equal(await f.count("audit_logs"), 0);
  await f.resumeAudit();
  assert.equal((await f.command("reprocess_content", { id: "source" })).status, 200);
  const after = await f.db.prepare("SELECT processing_status,processing_error,version FROM source_documents WHERE id='source'").first();
  assert.deepEqual(after, { processing_status: "processed", processing_error: null, version: before.version + 1 });
  assert.equal(await f.count("knowledge_chunks"), 1);
  assert.equal(await f.count("knowledge_chunks", "id='chunk'"), 0);
  assert.equal((await f.db.prepare("SELECT content,published FROM knowledge_chunks").first()).published, 0);
  assert.equal(await f.count("audit_logs", "action='source.reprocessed'"), 1);
});

test("真实提取失败仍返回处理错误，不伪称 SQL 审计失败或重新解析成功", async (t) => {
  const f = await fixture(t, { sourceText: "" });
  const response = await f.command("reprocess_content", { id: "source" });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: "empty_text" });
  assert.deepEqual(await f.db.prepare("SELECT processing_status,processing_error,version FROM source_documents WHERE id='source'").first(), {
    processing_status: "failed", processing_error: "empty_text", version: 2,
  });
  assert.equal(await f.count("knowledge_chunks", "id='chunk'"), 1);
  assert.equal(await f.count("audit_logs"), 0);
});

function archiveBeforeNextBatch(f) {
  let interleaved = false;
  return {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      if (!interleaved) {
        interleaved = true;
        assert.equal((await f.command("archive_content", { id: "source" })).status, 200);
      }
      return f.db.batch(statements);
    },
  };
}

test("发布提交前被归档时返回冲突，不能发布旧片段或写入成功审计", async (t) => {
  const f = await fixture(t, { sourceStatus: "processed" });
  f.context.db = archiveBeforeNextBatch(f);
  await assert.rejects(f.command("review_content", { id: "source", status: "published" }), /document_version_conflict/);
  const document = await f.db.prepare("SELECT processing_status,archived_at,version FROM source_documents WHERE id='source'").first();
  assert.equal(document.processing_status, "archived");
  assert.ok(document.archived_at);
  assert.equal(document.version, 2);
  assert.equal((await f.db.prepare("SELECT published FROM knowledge_chunks WHERE id='chunk'").first()).published, 0);
  assert.equal(await f.count("audit_logs", "action='source.reviewed'"), 0);
  assert.equal(await f.count("audit_logs", "action='source.archived'"), 1);
});

test("publishContent 的原两参数调用同样拒绝并发归档，且正常资料仍可发布", async (t) => {
  const f = await fixture(t, { sourceStatus: "processed" });
  await assert.rejects(api.publishContent(archiveBeforeNextBatch(f), { tenantId: "school", sourceDocumentId: "source" }), /document_version_conflict/);
  assert.equal((await f.db.prepare("SELECT published FROM knowledge_chunks WHERE id='chunk'").first()).published, 0);
  assert.equal(await f.count("audit_logs", "action='source.reviewed'"), 0);
  await f.db.prepare("UPDATE source_documents SET processing_status='processed',archived_at=NULL,version=version+1 WHERE id='source'").run();
  await api.publishContent(f.db, { tenantId: "school", sourceDocumentId: "source" });
  assert.equal((await f.db.prepare("SELECT processing_status FROM source_documents WHERE id='source'").first()).processing_status, "published");
  assert.equal((await f.db.prepare("SELECT published FROM knowledge_chunks WHERE id='chunk'").first()).published, 1);
});

test("旧发布请求不能发布并发重新解析产生的同状态新版本", async (t) => {
  const f = await fixture(t, { sourceStatus: "processed" });
  let interleaved = false;
  f.context.db = {
    prepare: (sql) => f.db.prepare(sql),
    batch: async (statements) => {
      if (!interleaved) {
        interleaved = true;
        assert.equal((await f.command("reprocess_content", { id: "source" })).status, 200);
      }
      return f.db.batch(statements);
    },
  };
  await assert.rejects(f.command("review_content", { id: "source", status: "published" }), /document_version_conflict/);
  assert.deepEqual(await f.db.prepare("SELECT processing_status,version FROM source_documents WHERE id='source'").first(), { processing_status: "processed", version: 2 });
  assert.deepEqual(await f.db.prepare("SELECT content,published FROM knowledge_chunks").first(), { content: "重新解析后的阅读教材。", published: 0 });
  assert.equal(await f.count("audit_logs", "action='source.reviewed'"), 0);
  assert.equal(await f.count("audit_logs", "action='source.reprocessed'"), 1);
});

for (const sourceText of ["新的教材内容", ""]) {
  test(`存储读取期间归档后，${sourceText ? "重新解析" : "提取失败"}都不能覆盖归档资料`, async (t) => {
    const f = await fixture(t);
    let entered, release;
    const waiting = new Promise((resolve) => { entered = resolve; });
    const content = new Promise((resolve) => { release = resolve; });
    api.setPlatformRuntime({ kind: "node", database: f.db, storage: { get: async () => {
      entered();
      await content;
      return { arrayBuffer: () => new Response(sourceText).arrayBuffer() };
    } } });
    const pending = f.command("reprocess_content", { id: "source" });
    await waiting;
    assert.equal((await f.command("archive_content", { id: "source" })).status, 200);
    release();
    await assert.rejects(pending, /document_version_conflict/);
    const document = await f.db.prepare("SELECT processing_status,processing_error,archived_at,version FROM source_documents WHERE id='source'").first();
    assert.equal(document.processing_status, "archived");
    assert.equal(document.processing_error, null);
    assert.ok(document.archived_at);
    assert.equal(document.version, 2);
    assert.deepEqual(await f.db.prepare("SELECT id,content,published FROM knowledge_chunks").first(), { id: "chunk", content: "阅读教材讲述人物、动作和主题。", published: 0 });
    assert.equal(await f.count("audit_logs", "action='source.reprocessed'"), 0);
    assert.equal(await f.count("audit_logs", "action='source.archived'"), 1);
  });
}

test("并发重新解析同一版本时仅一次提交，旧请求不能删除胜出请求的新片段", async (t) => {
  const f = await fixture(t, { sourceStatus: "processed" });
  let entered, release, reads = 0;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const content = new Promise((resolve) => { release = resolve; });
  api.setPlatformRuntime({ kind: "node", database: f.db, storage: { get: async () => {
    const index = ++reads;
    if (reads === 2) entered();
    await content;
    return { arrayBuffer: () => new Response(`第${index}份教材`).arrayBuffer() };
  } } });
  const pending = Promise.allSettled([f.command("reprocess_content", { id: "source" }), f.command("reprocess_content", { id: "source" })]);
  await waiting;
  release();
  const results = await pending;
  assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected"]);
  assert.equal(results[0].value.status, 200);
  assert.match(results[1].reason.message, /document_version_conflict/);
  assert.deepEqual(await f.db.prepare("SELECT processing_status,version FROM source_documents WHERE id='source'").first(), { processing_status: "processed", version: 2 });
  assert.equal(await f.count("knowledge_chunks"), 1);
  assert.deepEqual(await f.db.prepare("SELECT content,published FROM knowledge_chunks").first(), { content: "第1份教材", published: 0 });
  assert.equal(await f.count("audit_logs", "action='source.reprocessed'"), 1);
});

test("分块写入失败同时回滚文档版本和此前插入的审计回执", async (t) => {
  const f = await fixture(t);
  const before = await f.db.prepare("SELECT * FROM source_documents WHERE id='source'").first();
  await f.db.prepare("CREATE TRIGGER reject_new_chunk BEFORE INSERT ON knowledge_chunks BEGIN SELECT RAISE(ABORT,'fixture_chunk_failed'); END").run();
  await assert.rejects(f.command("reprocess_content", { id: "source" }), /fixture_chunk_failed/);
  assert.deepEqual(await f.db.prepare("SELECT * FROM source_documents WHERE id='source'").first(), before);
  assert.equal(await f.count("knowledge_chunks", "id='chunk'"), 1);
  assert.equal(await f.count("audit_logs", "action='source.reprocessed'"), 0);
});
