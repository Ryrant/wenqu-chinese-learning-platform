import { readDictation } from "./dictation-service";
import { practiceStudent } from "./journey-service";
import { readLearningAnalyticsState } from "./learning-analytics";
import { rankLearningPlan } from "./learning-loop";
import type { EvidencePlanItem } from "./learning-plan-types";
import type { PlatformContext } from "./platform-store";
import type { PracticeOverview } from "./practice-types";

function action(studentId: string, id: string, title: string, reason: string, href: string, priority: "resume" | "due" | "retry"): EvidencePlanItem {
  return { id: "practice:" + id, kind: "practice", studentUserId: studentId, title, selectionReason: reason, basis: [], dueAt: null, practiceHref: href, practicePriority: priority };
}

/** 自主练习只进入本人计划，不借用教师或家长的学生访问权展示私人练习。 */
export async function readPracticeNextActions(context: PlatformContext, studentId: string): Promise<EvidencePlanItem[]> {
  if (studentId !== context.userId || !context.roles.includes("student")) return [];
  if (!(await readLearningAnalyticsState(context.db, context.tenantId, studentId)).available) return [];
  const { db, tenantId } = context;
  const [journey, vocabulary, due, dictation] = await Promise.all([
    db.prepare("SELECT j.id,j.stage,json_extract(j.snapshot_json,'$.title') AS title FROM journey_runs j JOIN dialogue_scenarios s ON s.id=j.scenario_id AND s.tenant_id=j.tenant_id AND s.class_id=j.class_id WHERE j.tenant_id=? AND j.user_id=? AND j.stage<3 AND s.status='published' AND EXISTS (SELECT 1 FROM enrollments e WHERE e.tenant_id=j.tenant_id AND e.class_id=j.class_id AND e.student_user_id=j.user_id AND e.status='active') ORDER BY j.created_at DESC,j.rowid DESC LIMIT 1")
      .bind(tenantId, studentId).first<{ id: string; stage: number; title: string }>(),
    db.prepare("SELECT id FROM vocabulary_review_sessions WHERE tenant_id=? AND user_id=? AND completed_at IS NULL").bind(tenantId, studentId).first<{ id: string }>(),
    db.prepare("SELECT COUNT(*) AS count FROM student_vocabulary v LEFT JOIN vocabulary_review_state s ON s.tenant_id=v.tenant_id AND s.user_id=v.user_id AND s.vocabulary_id=v.id WHERE v.tenant_id=? AND v.user_id=? AND (s.due_at IS NULL OR s.due_at<=?)")
      .bind(tenantId, studentId, new Date().toISOString()).first<{ count: number }>(),
    readDictation(context),
  ]);
  const items: EvidencePlanItem[] = [];
  if (journey) items.push(action(studentId, journey.id, "继续主题：" + journey.title, "本轮已保存 " + journey.stage + "/3 关，继续当前关卡。", "/student/journeys?run=" + encodeURIComponent(journey.id), "resume"));
  if (vocabulary) items.push(action(studentId, vocabulary.id, "继续生词复习", "本人有一轮未完成的生词练习，继续已保存的题目。", "/student/vocabulary?sessionId=" + encodeURIComponent(vocabulary.id), "resume"));
  else if (due?.count) items.push(action(studentId, "vocabulary-due", "复习到期生词", "有 " + due.count + " 个收藏词语已到复习时间，每轮最多安排 5 个。", "/student/vocabulary", "due"));
  if (dictation.active?.available) items.push(action(studentId, dictation.active.id, "继续听写：" + dictation.active.sourceTitle, "本轮已保存 " + dictation.active.answers.length + "/" + dictation.active.total + " 项，可以继续。", "/student/dictation?sessionId=" + encodeURIComponent(dictation.active.id), "resume"));
  else if (!dictation.active) {
    const last = dictation.recent.find((item) => item.id === dictation.retrySessionId);
    const wrong = last?.retryCount ?? 0;
    if (last?.available && wrong) items.push(action(studentId, last.id, "回看并重练听写错项", "待纠正的听写记录还有 " + wrong + " 项与参考文字不同；进入记录后可单独重练。", "/student/dictation?sessionId=" + encodeURIComponent(last.id), "retry"));
  }
  return (await readLearningAnalyticsState(db, tenantId, studentId)).available ? items : [];
}

export async function readPracticeOverview(context: PlatformContext): Promise<PracticeOverview> {
  practiceStudent(context);
  const nextActions = await readPracticeNextActions(context, context.userId);
  const analytics = await readLearningAnalyticsState(context.db, context.tenantId, context.userId);
  return { ...analytics, nextActions: analytics.available ? rankLearningPlan(nextActions) : [] };
}
