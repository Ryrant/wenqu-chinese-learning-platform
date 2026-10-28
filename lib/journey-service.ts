import { auditStatement } from "./audit";
import type { PlatformContext } from "./platform-store";
import { readingLessons, type ReadingLesson } from "./reading-lessons";
import type { DialogueContent, DialogueScenario, DialogueTurn } from "./dialogue-types";
import type { JourneyCatalog, JourneyRun, PracticeRecord } from "./practice-types";

export function practiceStudent(context: PlatformContext) { if (!context.roles.includes("student")) throw new Error("forbidden"); }
export function practiceId(value: unknown) { if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("invalid_practice_id"); return value; }
export function journeySourceGuard(context: PlatformContext, scenarioId: string, classId: string) {
  return { sql: `EXISTS (SELECT 1 FROM dialogue_scenarios d JOIN enrollments e ON e.tenant_id=d.tenant_id AND e.class_id=d.class_id WHERE d.id=? AND d.tenant_id=? AND d.class_id=? AND d.status='published' AND e.student_user_id=? AND e.status='active')
    AND EXISTS (SELECT 1 FROM users u JOIN role_memberships rm ON rm.user_id=u.id JOIN tenants t ON t.id=rm.tenant_id WHERE u.id=? AND u.status='active' AND u.must_change_password=0 AND rm.tenant_id=? AND rm.role='student' AND rm.status='active' AND t.status='active')`,
  args: [scenarioId, context.tenantId, classId, context.userId, context.userId, context.tenantId] };
}
type JourneySnapshot = { title: string; className: string; lesson: ReadingLesson; characters: string[] };
export type JourneyRow = { id: string; scenario_id: string; class_id: string; snapshot_json: string; dialogue_session_id: string; stage: number; created_at: string; available: number; dialogueStep: number; dialogueHints: number; dialogueSnapshot: string };
const selectRun = `SELECT j.*,s.step AS dialogueStep,s.hint_count AS dialogueHints,s.snapshot_json AS dialogueSnapshot,
  CASE WHEN d.status='published' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=j.tenant_id AND e.class_id=j.class_id AND e.student_user_id=j.user_id AND e.status='active') THEN 1 ELSE 0 END AS available
  FROM journey_runs j JOIN dialogue_sessions s ON s.id=j.dialogue_session_id AND s.tenant_id=j.tenant_id AND s.user_id=j.user_id LEFT JOIN dialogue_scenarios d ON d.id=j.scenario_id AND d.tenant_id=j.tenant_id AND d.class_id=j.class_id`;

export async function ownJourneyRow(context: PlatformContext, id: string) {
  practiceStudent(context);
  const row = await context.db.prepare(`${selectRun} WHERE j.id=? AND j.tenant_id=? AND j.user_id=?`).bind(id, context.tenantId, context.userId).first<JourneyRow>();
  if (!row) throw new Error("journey_run_not_found"); return row;
}
export function journeySnapshot(row: JourneyRow) { return JSON.parse(row.snapshot_json) as JourneySnapshot; }
async function run(context: PlatformContext, row: JourneyRow): Promise<JourneyRun> {
  const snapshot = journeySnapshot(row);
  const records = await context.db.prepare("SELECT id,kind,reference_id AS referenceId,journey_run_id AS journeyRunId,title,result_json AS resultJson,created_at AS createdAt FROM practice_records WHERE rowid IN (SELECT MAX(rowid) FROM practice_records WHERE tenant_id=? AND user_id=? AND journey_run_id=? GROUP BY kind,reference_id) ORDER BY created_at DESC,rowid DESC").bind(context.tenantId, context.userId, row.id).all<Omit<PracticeRecord, "result"> & { resultJson: string }>();
  return { id: row.id, scenarioId: row.scenario_id, ...snapshot, stage: row.stage, dialogueSessionId: row.dialogue_session_id, available: !!row.available,
    records: records.results.map(({ resultJson, ...record }) => ({ ...record, result: JSON.parse(resultJson) as PracticeRecord["result"] })),
    dialogue: { steps: row.dialogueStep, total: (JSON.parse(row.dialogueSnapshot) as DialogueScenario).goals.length, hints: row.dialogueHints }, createdAt: row.created_at };
}

export async function readJourneyCatalog(context: PlatformContext, focusId = ""): Promise<JourneyCatalog> {
  practiceStudent(context);
  const rows = await context.db.prepare(`SELECT d.id,d.title,d.revision,d.content_json,c.name AS className FROM dialogue_scenarios d JOIN classes c ON c.id=d.class_id AND c.tenant_id=d.tenant_id
    WHERE d.tenant_id=? AND d.status='published' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=d.tenant_id AND e.class_id=d.class_id AND e.student_user_id=? AND e.status='active') ORDER BY d.updated_at DESC,d.rowid DESC`).bind(context.tenantId, context.userId).all<{ id: string; title: string; revision: number; content_json: string; className: string }>();
  const journeys = rows.results.flatMap((row) => {
    const definition = (JSON.parse(row.content_json) as DialogueContent).journey;
    const lesson = definition && readingLessons.find((item) => item.id === definition.lessonId);
    return definition && lesson ? [{ id: row.id, title: row.title, className: row.className, lessonTitle: lesson.title, characters: definition.characters, revision: row.revision }] : [];
  });
  const runs = await context.db.prepare(`${selectRun} WHERE j.tenant_id=? AND j.user_id=? ORDER BY CASE WHEN j.id=? THEN 0 ELSE 1 END,j.created_at DESC,j.rowid DESC LIMIT 20`).bind(context.tenantId, context.userId, focusId).all<JourneyRow>();
  return { journeys, runs: await Promise.all(runs.results.map((row) => run(context, row))) };
}

export async function startJourney(context: PlatformContext, body: Record<string, unknown>) {
  practiceStudent(context); const id = practiceId(body.id); const scenarioId = practiceId(body.scenarioId);
  const existing = await context.db.prepare("SELECT scenario_id FROM journey_runs WHERE id=? AND tenant_id=? AND user_id=?").bind(id, context.tenantId, context.userId).first<{ scenario_id: string }>();
  if (existing) { if (existing.scenario_id !== scenarioId) throw new Error("practice_record_conflict"); return readJourneyCatalog(context, id); }
  const source = await context.db.prepare(`SELECT d.*,c.name AS className,u.display_name AS authorName FROM dialogue_scenarios d JOIN classes c ON c.id=d.class_id AND c.tenant_id=d.tenant_id JOIN users u ON u.id=d.created_by WHERE d.id=? AND d.tenant_id=?`).bind(scenarioId, context.tenantId).first<{ id: string; class_id: string; title: string; content_json: string; className: string; authorName: string; revision: number }>();
  if (!source) throw new Error("journey_unavailable");
  const content = JSON.parse(source.content_json) as DialogueContent; const definition = content.journey;
  const lesson = definition && readingLessons.find((item) => item.id === definition.lessonId);
  if (!definition || !lesson) throw new Error("journey_unavailable");
  const snapshot: JourneySnapshot = { title: source.title, className: source.className, lesson, characters: definition.characters };
  const dialogue: DialogueScenario = { ...content, id: source.id, title: source.title, classId: source.class_id, className: source.className, authorName: source.authorName, revision: source.revision, status: "published" };
  const sessionId = crypto.randomUUID(); const guard = journeySourceGuard(context, source.id, source.class_id);
  const turns: DialogueTurn[] = [{ id: crypto.randomUUID(), kind: "role", text: content.opening, step: 0, at: new Date().toISOString(), provider: "script" }];
  const [result] = await context.db.batch([
    context.db.prepare(`INSERT OR IGNORE INTO journey_runs (id,tenant_id,user_id,scenario_id,class_id,snapshot_json,dialogue_session_id) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql} AND EXISTS (SELECT 1 FROM dialogue_scenarios WHERE id=? AND tenant_id=? AND revision=?)`).bind(id, context.tenantId, context.userId, source.id, source.class_id, JSON.stringify(snapshot), sessionId, ...guard.args, source.id, context.tenantId, source.revision),
    context.db.prepare("INSERT INTO dialogue_sessions (id,tenant_id,user_id,class_id,scenario_id,snapshot_json,turns_json) SELECT ?,?,?,?,?,?,? WHERE changes()>0").bind(sessionId, context.tenantId, context.userId, source.class_id, source.id, JSON.stringify(dialogue), JSON.stringify(turns)),
    auditStatement(context.db, context.tenantId, context.userId, "journey.started", "journey-run", id, { scenarioId }, true),
  ]);
  if (!result.meta.changes) {
    const replay = await context.db.prepare("SELECT scenario_id FROM journey_runs WHERE id=? AND tenant_id=? AND user_id=?").bind(id, context.tenantId, context.userId).first<{ scenario_id: string }>();
    if (!replay || replay.scenario_id !== scenarioId) throw new Error("journey_unavailable");
  }
  return readJourneyCatalog(context, id);
}
