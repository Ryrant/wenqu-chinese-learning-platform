import { generateGroundedText } from "../ai/grounding";
import { aiProviderSettings, loadPlatformSettings } from "../platform-settings";
import { searchPublishedKnowledge } from "../retrieval";
import { text, requireText, number, auditStatement, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

export const lessonsCommands = {
  generate_lesson: async (body, context) => {
    const { db, tenantId, userId } = context;
    const topic = requireText(body.topic, "topic");
    const level = text(body.level, 20) || "A2";
    const duration = Math.max(20, Math.min(number(body.duration, 40), 90));
    const contextChunks = await searchPublishedKnowledge(db, { tenantId, query: topic, limit: 5 });
    if (!contextChunks.length) return Response.json({ error: "no_reviewed_sources" }, { status: 422 });
    const settings = await loadPlatformSettings(db);
    const result = await generateGroundedText(
      { purpose: "lesson", prompt: topic, contextChunks, role: "teacher", level },
      aiProviderSettings(settings),
    );
    const id = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const title = `《${topic}》互动课`;
    const objectives = [`能用完整句描述${topic}`, "能从人物、事物和动作组织表达", "能说明主题中的文化含义"];
    const activities = [{ minutes: duration, title: "AI 来源化教学草稿", detail: result.text }];
    const citations = result.citations;
    await db.batch([
      db.prepare("INSERT INTO lesson_plans (id,tenant_id,title,topic,level,duration_minutes,objectives_json,activities_json,citations_json,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,'draft',?)").bind(id, tenantId, title, topic, level, duration, JSON.stringify(objectives), JSON.stringify(activities), JSON.stringify(citations), userId),
      db.prepare("INSERT INTO ai_sessions (id,tenant_id,user_id,purpose,provider,model,status,input_tokens,output_tokens) VALUES (?,?,?,?,?,?,?,?,?)").bind(sessionId, tenantId, userId, "lesson", result.provider, result.model, result.status, result.inputTokens, result.outputTokens),
      ...citations.map((item) => db.prepare("INSERT INTO citations (id,tenant_id,ai_session_id,knowledge_chunk_id,quote) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), tenantId, sessionId, item.id, item.excerpt.slice(0, 500))),
      auditStatement(db, tenantId, userId, "lesson_plan.generated", "lesson_plan", id, { sourceCount: citations.length, provider: result.provider, model: result.model }),
    ]);
    return Response.json({ id, title, topic, level, durationMinutes: duration, objectives, activities, citations, status: "draft", provider: result.provider, model: result.model }, { status: 201 });
  },

  update_lesson_plan: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = requireText(body.id, "lesson_plan_id", 120);
    const existing = await db.prepare("SELECT id FROM lesson_plans WHERE id=? AND tenant_id=? AND created_by=? AND status='draft' AND archived_at IS NULL")
      .bind(id, tenantId, userId).first();
    if (!existing) return Response.json({ error: "lesson_plan_not_editable" }, { status: 404 });
    const title = requireText(body.title, "lesson_plan_title", 200);
    const topic = requireText(body.topic, "lesson_plan_topic", 200);
    const level = requireText(body.level, "lesson_plan_level", 20);
    const duration = Math.max(20, Math.min(number(body.duration, 40), 90));
    const objectives = Array.isArray(body.objectives) ? body.objectives.map((item) => text(item, 240)).filter(Boolean).slice(0, 8) : [];
    const activities = Array.isArray(body.activities) ? body.activities.slice(0, 12) : [];
    if (!objectives.length || !activities.length) throw new Error("invalid_lesson_plan_content");
    const [result] = await db.batch([
      db.prepare(`UPDATE lesson_plans SET title=?,topic=?,level=?,duration_minutes=?,objectives_json=?,activities_json=?,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND created_by=? AND status='draft' AND archived_at IS NULL`)
        .bind(title, topic, level, duration, JSON.stringify(objectives), JSON.stringify(activities), id, tenantId, userId),
      auditStatement(db, tenantId, userId, "lesson_plan.updated", "lesson_plan", id, {}, true),
    ]);
    if (!result.meta.changes) return Response.json({ error: "lesson_plan_not_editable" }, { status: 404 });
    return Response.json({ id, status: "draft" });
  },

  archive_lesson_plan: async (body, context) => {
    const { db, tenantId, userId } = context;
    const id = requireText(body.id, "lesson_plan_id", 120);
    const [result] = await db.batch([
      db.prepare(`UPDATE lesson_plans SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND tenant_id=? AND created_by=? AND status='draft' AND archived_at IS NULL`)
        .bind(id, tenantId, userId),
      auditStatement(db, tenantId, userId, "lesson_plan.archived", "lesson_plan", id, {}, true),
    ]);
    if (!result.meta.changes) return Response.json({ error: "lesson_plan_not_editable" }, { status: 404 });
    return Response.json({ id, status: "archived" });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
