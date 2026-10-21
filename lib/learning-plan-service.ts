import { readAbilityProfile } from "./ability-profile-service";
import { ABILITY_LABELS, type Ability } from "./diagnostic-types";
import { measureIntervention } from "./intervention-support";
import { isRecommendationDue, rankLearningPlan } from "./learning-loop";
import type { EvidencePlanItem, PlanBasis } from "./learning-plan-types";
import { nextSequenceStage, SEQUENCE_STAGE_LABELS, sequenceTaskId, sequenceTime, TEACHING_DECISION_LABELS, type LearningSequence } from "./learning-sequence-types";
import type { PlatformContext } from "./platform-store";

type Row = Record<string, unknown>;
const skillAbility: Record<string, Ability> = { 听力: "listening", 听力理解: "listening", 口语: "speaking", 口语表达: "speaking", 阅读: "reading", 书写: "writing", 汉字书写: "writing" };
const text = (value: unknown) => typeof value === "string" ? value : "";

export async function readLearningPlan(context: PlatformContext, studentId: string | null, sequences: LearningSequence[], objectives: Row[]): Promise<EvidencePlanItem[]> {
  if (!studentId) return [];
  let profile;
  try { profile = await readAbilityProfile(context, studentId); }
  catch (error) {
    // 无有效学生身份或授权时不生成个人计划；数据库等真实错误仍向上抛出。
    if (error instanceof Error && error.message === "ability_profile_not_found") return [];
    throw error;
  }
  if (profile.available === false) return [];
  const { db, tenantId } = context;
  const [assignments, recommendations] = await Promise.all([
    db.prepare(`SELECT a.*,group_concat(DISTINCT ao.objective_id) AS objectiveIds,
        EXISTS(SELECT 1 FROM submissions s WHERE s.tenant_id=a.tenant_id AND s.assignment_id=a.id AND s.student_user_id=?) AS submittedByFocus
      FROM assignments a LEFT JOIN assignment_objectives ao ON ao.tenant_id=a.tenant_id AND ao.assignment_id=a.id
      WHERE a.tenant_id=? AND a.status='published' AND EXISTS (
        SELECT 1 FROM enrollments e WHERE e.tenant_id=a.tenant_id AND e.class_id=a.class_id AND e.student_user_id=? AND e.status='active')
      GROUP BY a.id`).bind(studentId, tenantId, studentId).all<Row>(),
    db.prepare(`SELECT lr.*,di.ability AS reviewAbility,di.prompt AS reviewPrompt,di.options_json AS reviewOptionsJson,
        fs.review_status AS familyReviewStatus,fs.family_confirmed_at AS familyConfirmedAt
      FROM learning_recommendations lr
      LEFT JOIN diagnostic_items di ON di.id=lr.source_id AND di.tenant_id=lr.tenant_id
      LEFT JOIN submissions fs ON fs.id=(SELECT latest.id FROM submissions latest
        WHERE latest.tenant_id=lr.tenant_id AND latest.family_task_id=lr.id AND latest.student_user_id=lr.student_user_id
        ORDER BY latest.created_at DESC,latest.rowid DESC LIMIT 1)
      WHERE lr.tenant_id=? AND lr.student_user_id=? AND lr.status='pending' AND lr.archived_at IS NULL
        AND lr.source_type IN ('teacher','family','diagnostic')
        AND (lr.source_type!='diagnostic' OR lr.objective_id=di.objective_id)`).bind(tenantId, studentId).all<Row>(),
  ]);
  const eligible = new Map(assignments.results.map((item) => [text(item.id), item]));
  const goals = new Map(objectives.map((item) => [text(item.id), item]));
  const measures = new Map<string, ReturnType<typeof measureIntervention>>();
  const goalBasis = (ids: string[], ability?: Ability): { basis: PlanBasis[]; supportMatch: boolean } => {
    let supportMatch = false;
    const basis = ids.map((objectiveId) => {
      let measured = measures.get(objectiveId);
      if (!measured) { measured = measureIntervention(profile, objectiveId); measures.set(objectiveId, measured); }
      if (ability && measured.supports.includes(ability)) supportMatch = true;
      return { objectiveId, title: text(goals.get(objectiveId)?.title) || objectiveId,
        note: !measured.ready ? "证据不足，待评估：至少两个分项各需两次有评分的记录，暂不据此区分强弱。"
          : measured.supports.length ? `本目标的已有诊断记录提示${measured.supports.map((item) => ABILITY_LABELS[item]).join("、")}支持需求；任务难度与评价方式仍需教师核对。`
            : "已有分项记录的差值不足 20 分，暂不自动区分强弱。",
        records: measured.measures.flatMap((measure) => measure.records.map((record) => ({
          id: record.id, title: record.title, measuredAt: record.measuredAt, score: record.score, ability: measure.ability,
          kind: profile.evidence.find((item) => item.id === record.id)!.kind,
          helpLevel: profile.evidence.find((item) => item.id === record.id)?.helpLevel,
        }))),
      };
    });
    return { basis, supportMatch };
  };
  const now = new Date();
  const candidates: EvidencePlanItem[] = [];
  for (const item of recommendations.results) {
    const dueAt = text(item.due_at) || null;
    const family = item.source_type === "family";
    const review = item.source_type === "diagnostic";
    const assignment = eligible.get(text(item.assignment_id));
    if ((family && !assignment) || (review && (!item.reviewPrompt || !isRecommendationDue(dueAt, now)))) continue;
    const mode = family ? text(assignment?.diagnostic_mode) : review ? text(item.reviewAbility) : "";
    const ability = Object.hasOwn(ABILITY_LABELS, mode) ? mode as Ability : undefined;
    const waitingReview = family && !!item.familyReviewStatus && item.familyReviewStatus !== "reviewed";
    const measured = goalBasis(text(item.objective_id) ? [text(item.objective_id)] : [], ability);
    candidates.push({ ...item, id: text(item.id), title: text(item.title), studentUserId: studentId,
      kind: family ? "family" : review ? "review" : "teacher", dueAt, waitingReview, ...measured,
      selectionReason: waitingReview ? item.familyConfirmedAt ? "作品已提交，等待教师评价；可操作的任务会排在前面。" : "作品已提交，等待交流确认；可操作的任务会排在前面。"
        : review ? "这道诊断错题已到复习时间，先完成复习，再继续其他自主任务。"
          : family ? measured.supportMatch ? `这项家庭任务标注${ABILITY_LABELS[ability!]}分项，与已有支持需求匹配；完成自己的作品并记录实际帮助。`
            : "已有与课程目标关联的家庭交流任务，按原要求完成自己的作品并记录实际帮助。"
            : "教师已确认这项支持安排，优先按教师发布的要求练习。",
    });
  }
  for (const assignment of assignments.results.filter((item) => !Number(item.submittedByFocus))) {
    const ids = text(assignment.objectiveIds).split(",").filter(Boolean);
    const mode = text(assignment.diagnostic_mode);
    const declared = ids.map((id) => skillAbility[text(goals.get(id)?.skill)]);
    // 只匹配任务明确标注的分项；不从任务标题猜测能力或把综合任务当成某一项专项练习。
    const ability = Object.hasOwn(ABILITY_LABELS, mode) ? mode as Ability
      : declared.length && declared.every((item) => item && item === declared[0]) ? declared[0] : undefined;
    const measured = goalBasis(ids, ability);
    candidates.push({ ...assignment, id: text(assignment.id), title: text(assignment.title), studentUserId: studentId,
      kind: "assignment", dueAt: text(assignment.due_at) || null, ...measured,
      selectionReason: measured.supportMatch ? `这项已发布任务标注${ABILITY_LABELS[ability!]}分项，与已有诊断中的支持需求匹配，优先于一般自主任务。`
        : "这项课程任务尚未提交；按截止时间和既有任务顺序安排，不凭总分推断支持方向。",
    });
  }
  for (const sequence of sequences.filter((item) => item.studentUserId === studentId && eligible.has(item.assignmentId))) {
    const stage = nextSequenceStage(sequence);
    if (!stage) continue;
    const reference = stage === "practice" ? sequence.baseline : stage === "transfer" ? sequence.practice.find((item) => item.reviewed)
      : sequence.transfer.find((item) => item.id === sequence.retestReferenceId);
    const waitingReview = sequence[stage].some((item) => !item.reviewed);
    const decision = sequences.flatMap((item) => item.decisions).find((item) => item.nextSequenceId === sequence.id);
    const note = stage === "practice" ? `教师已根据初次作品发布针对性练习${decision ? `，后续方向为“${TEACHING_DECISION_LABELS[decision.kind]}”` : ""}。`
      : stage === "transfer" ? "练习已有教师评价，现在换一个对象或情境检验本目标的使用。"
        : `延后复测已于 ${sequenceTime(sequence.retestAvailableAt!)} 开放，使用安排时固定的迁移作品作参照。`;
    candidates.push({ id: sequenceTaskId(sequence.id, stage), kind: "sequence", studentUserId: studentId,
      title: `${sequence.title} · ${SEQUENCE_STAGE_LABELS[stage]}`, sequenceId: sequence.id, dueAt: null, waitingReview,
      selectionReason: waitingReview ? "本阶段作品已提交，等待教师评价；可操作的任务会排在前面。" : note,
      basis: [{ objectiveId: sequence.objectiveId, title: sequence.objectiveTitle,
        note: `${note}${decision ? ` 教师理由：${decision.rationale} 仍待观察：${decision.remaining}` : ""}`,
        records: reference ? [{ id: reference.id, title: reference.title, measuredAt: reference.reviewedAt,
          score: reference.objectives.find((item) => item.id === sequence.objectiveId)?.score ?? null,
          kind: "work", helpLevel: reference.helpLevel, promptCount: reference.promptCount }] : [],
      }],
    });
  }
  return rankLearningPlan(candidates, now);
}
