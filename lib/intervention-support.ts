import { readAbilityProfile } from "./ability-profile-service";
import { ABILITY_LABELS, type Ability, type AbilityProfile, type InterventionSuggestion } from "./diagnostic-types";
import type { PlatformContext } from "./platform-store";
import { learningAnalyticsMessage } from "./learning-analytics";

const supportSteps: Record<Ability, string> = {
  listening: "听力支持：使用本单元老师选定的音频，先分段听并记下关键词，再听完整内容，用自己的话复述；最后不看关键词再听一次，核对遗漏。",
  speaking: "口语支持：先从已学内容中选三个关键词，借助句首提示“我想介绍……”“因为……”“先……再……”，说出完整意思；再逐步遮住提示，重新说一次。",
  reading: "阅读支持：先口头说出本单元的关键词，再与教材中的字词、短句配对并圈出对应部分；最后遮住口头提示，自己读出短句并说明意思。",
  writing: "书面表达支持：先口头整理要表达的内容，再列关键词，借助“我想说……”“因为……”“先……再……”写成短文；最后检查句意是否完整，修改一处表达。",
};
const measuredTime = (value: string) => Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);

// 教师草稿与学生计划使用同一门槛，不能各自推断一套能力强弱。
export function measureIntervention(profile: AbilityProfile, objectiveId: string) {
  const measures = (Object.keys(ABILITY_LABELS) as Ability[]).map((ability) => {
    const records = profile.evidence.flatMap((item) => {
      const score = item.scores.find((score) => score.objectiveId === objectiveId)?.score;
      if (item.ability !== ability || item.status !== "assessed" || !item.measuredAt
        || (item.familyHelp && item.familyHelp !== "independent") || item.helpLevel === "prompted" || item.helpLevel === "assisted"
        || score === undefined || !Number.isFinite(score)) return [];
      return [{ id: item.id, title: item.title, score, measuredAt: item.measuredAt, sequence: item.sequence }];
    }).sort((a, b) => measuredTime(b.measuredAt) - measuredTime(a.measuredAt) || b.sequence - a.sequence);
    const recent = records.slice(0, 2);
    // 两次记录仅是生成练习建议的最低门槛，不据此认定稳定能力或正式等级。
    return { ability, availableCount: records.length, records: recent,
      score: recent.length < 2 ? null : Math.round(recent.reduce((sum, item) => sum + item.score, 0) / recent.length) };
  });
  const measured = measures.filter((item) => item.score !== null);
  const ready = measured.length >= 2;
  const best = Math.max(...measured.map((item) => item.score!));
  // 20 分是向教师提示支持方向的固定规则，评价方式和任务难度仍须人工核对。
  const supports = ready ? measured.filter((item) => best - item.score! >= 20).map((item) => item.ability) : [];
  return { measures, ready, supports };
}

export async function suggestIntervention(context: PlatformContext, studentUserId: string, objectiveId: string): Promise<InterventionSuggestion> {
  if (!context.roles.includes("teacher") && !context.roles.includes("admin")) throw new Error("forbidden");
  const objective = await context.db.prepare("SELECT title FROM learning_objectives WHERE id=? AND tenant_id=? AND status='active'")
    .bind(objectiveId, context.tenantId).first<{ title: string }>();
  if (!objective) throw new Error("objective_not_found");
  const profile = await readAbilityProfile(context, studentUserId);
  if (profile.available === false) return { studentUserId, objectiveId, ready: false, title: "", detail: "", rationale: learningAnalyticsMessage(profile.consentStatus), evidenceKey: null, supports: [], measures: [] };
  const { measures, ready, supports } = measureIntervention(profile, objectiveId);
  const direction = supports.length ? supports.map((ability) => ABILITY_LABELS[ability]).join("、") : "综合巩固";
  const summary = measures.map((item) => `${ABILITY_LABELS[item.ability]}：${item.score === null ? `待评估（${item.availableCount} 次可用记录）` : `最近两次${item.ability === "reading" || item.ability === "listening" ? "正确率" : "教师目标评分"}均值 ${item.score}/100`}`).join("；");
  const rationale = `学习目标：${objective.title}\n${summary}。\n${ready
    ? `${supports.length ? `与本目标下较高分项相差至少 20 分，建议提供${direction}支持。` : "已评价分项的差值不足 20 分，先提供综合巩固，不自动区分强弱。"}该规则仅辅助选择练习，不能证明稳定能力差异；请教师核对任务难度与评价方式。`
    : "至少两个分项各需要两次有评分的记录，请先补充同一目标下的诊断或教师评价。"}\n待批阅、未评价目标、缺少历史快照及有提示或共同完成的作品不作为本次选择依据。`;
  const evidence = measures.flatMap((item) => item.records.map((record) => `${ABILITY_LABELS[item.ability]}｜${record.title}｜${record.measuredAt}｜目标表现 ${record.score}/100`)).join("\n");
  const basis = `${rationale}${evidence ? `\n参考记录：\n${evidence}` : ""}`;
  const bytes = ready ? await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ version: 1, studentUserId, objectiveId, measures, supports, basis }))) : null;
  const evidenceKey = bytes ? [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("") : null;
  return { studentUserId, objectiveId, ready, supports, measures, evidenceKey, rationale: basis,
    title: ready ? `${direction}练习：${objective.title}`.slice(0, 120) : "",
    detail: ready ? `学习目标：${objective.title}\n${supports.length ? supports.map((ability) => supportSteps[ability]).join("\n") : "使用本单元已学内容完成一次目标任务，先独立尝试，再对照要求自查，并修改一处表达。"}\n完成标准：围绕目标完成表达或理解任务，说明使用了哪些提示，以及撤去提示后还需要哪些帮助。` : "" };
}
