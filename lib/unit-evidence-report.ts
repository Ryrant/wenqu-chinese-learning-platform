import { evidenceStatus, HELP_LEVEL_LABELS, sameRubric, SEQUENCE_STAGE_LABELS, sequencePrompt, sequenceStages, sequenceTime, TEACHING_DECISION_LABELS, unitReportUrl, type LearningSequence, type SequenceEvidence } from "./learning-sequence-types";
import { reportText as text } from "./print-report";
import { trialSummary, TRIAL_KIND_LABELS, TRIAL_METHOD_LABELS, type TrialEntry } from "./trial-types";

const copy = (label: string, value: string) => `<p class="copy">${text(label)}${text(value)}</p>`;
const time = (value: string | null) => value ? text(sequenceTime(value)) : "时间未记录";

function workEvidence(work: SequenceEvidence, objectiveId: string, anchor: string, context = false) {
  const goal = work.objectives.find((item) => item.id === objectiveId);
  const dimensions = work.rubric ?? work.dimensions;
  return `<article class="work evidence" id="${text(anchor)}"><h3>${text(work.title)}</h3>
    <p class="meta">作品 ID：${text(work.id)}<br>提交：${time(work.submittedAt)}；${work.reviewed ? `教师评价：${time(work.reviewedAt)}` : "待教师评价"}</p>
    ${work.prompt ? copy("任务要求：", work.prompt) : ""}
    ${work.mediaId ? `<img src="/api/v1/diagnostic-media/${encodeURIComponent(work.mediaId)}" alt="本次任务的原始图片素材">` : ""}
    ${work.hasAudio ? `<p><a href="/api/v1/submissions/${encodeURIComponent(work.id)}/audio">登录后回放原始录音 · ${text(work.id)}</a></p><audio class="online" controls preload="none" src="/api/v1/submissions/${encodeURIComponent(work.id)}/audio" aria-label="原始录音"></audio><p class="meta">PDF 不嵌入录音，以上链接仍需原账号及有效授权。</p>` : copy("学生原文：", work.textAnswer ?? "文字未记录")}
    <p>本组目标评价：${work.reviewed && goal ? `${text(goal.score)}/100` : "未评价"}；教师确认总分：${work.reviewed && work.score !== null ? text(work.score) : "未评价"}</p>
    ${dimensions.length ? `<table><thead><tr><th>量规维度</th><th>教师评价 /100</th></tr></thead><tbody>${dimensions.map((item) => `<tr><th>${text(item.name)}</th><td>${work.reviewed ? text(work.dimensions.find((score) => score.name === item.name)?.score ?? "未评价") : "未评价"}</td></tr>`).join("")}</tbody></table>` : ""}
    ${!work.rubric ? "<p>历史量规未保留，不使用当前任务补造评价依据。</p>" : ""}
    <p>帮助程度：${text(HELP_LEVEL_LABELS[work.helpLevel])}；经教师核对的提示次数：${text(work.promptCount ?? "未记录")}</p>
    ${context ? `<p>新对象或情境：${work.contextConfirmed ? "教师已核对" : "尚未确认"}</p>` : ""}
    ${work.feedback ? copy("教师反馈：", work.feedback) : "<p>教师反馈未记录。</p>"}</article>`;
}

function comparison(sequence: LearningSequence, before: SequenceEvidence | undefined, after: SequenceEvidence | undefined, labels: [string, string]) {
  const comparable = !!before?.reviewed && !!after?.reviewed && sameRubric(before.rubric, after.rubric);
  const scores = [{ title: `目标：${sequence.objectiveTitle}`, before: before?.objectives.find((item) => item.id === sequence.objectiveId)?.score, after: after?.objectives.find((item) => item.id === sequence.objectiveId)?.score },
    ...[...new Set([...sequence.rubric.map((item) => item.name), ...(before?.dimensions ?? []).map((item) => item.name), ...(after?.dimensions ?? []).map((item) => item.name)])].map((name) => ({ title: name, before: before?.dimensions.find((item) => item.name === name)?.score, after: after?.dimensions.find((item) => item.name === name)?.score }))];
  return `<section><h2>${labels[0]}与${labels[1]}的分项对照</h2>
    <p>${comparable ? "两份作品使用相同量规，差值只描述本次作品表现，仍需结合任务难度和原始作品判断。" : "量规不同、历史量规缺失或作品尚未评价，暂不计算前后差值。"}</p>
    <div class="table"><table><thead><tr><th>评价项</th><th>${labels[0]} /100</th><th>${labels[1]} /100</th><th>差值</th></tr></thead><tbody>${scores.map((row) => {
      const left = before?.reviewed ? row.before : undefined;
      const right = after?.reviewed ? row.after : undefined;
      const delta = comparable && left !== undefined && right !== undefined ? Number((right - left).toFixed(2)) : null;
      return `<tr><th>${text(row.title)}</th><td>${text(left ?? "未评价")}</td><td>${text(right ?? "未评价")}</td><td>${delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</td></tr>`;
    }).join("")}</tbody></table></div></section>`;
}

export function unitEvidenceReport(sequence: LearningSequence, tenantName: string) {
  const latestTransfer = sequence.transfer[0];
  const retestReference = sequence.transfer.find((work) => work.id === sequence.retestReferenceId);
  return `<header><p class="meta">${text(tenantName)} · 单元证据报告</p><h1>${text(sequence.title)}</h1>
    <p>学生：${text(sequence.studentName)}；学习目标：${text(sequence.objectiveTitle)}；提交方式：${sequence.medium === "audio" ? "录音" : "文字"}</p>
    <p class="meta">任务组 ID：${text(sequence.id)}</p></header>
    <p class="notice">完成任务不等于能力提升。缺少的分项、提示次数和历史量规保留为未记录或未评价；报告不推断正式等级，不把前后变化直接归因于平台。</p>
    ${sequence.origin ? `<p>本组来自“${text(TEACHING_DECISION_LABELS[sequence.origin.kind])}”安排：<a href="${unitReportUrl(sequence.origin.sequenceId)}">${text(sequence.origin.title)}</a>。初次作品采用该安排保存的依据快照。</p>` : ""}
    <section><h2>任务与证据范围</h2>${copy("针对性练习要求：", sequence.practicePrompt)}${copy("迁移要求：", sequence.transferPrompt)}${copy("迁移情境变化：", sequence.transferContext)}
      <p>迁移观察：${text(evidenceStatus(latestTransfer, sequence.objectiveId, "迁移"))}</p>
      <p>本组保存初次作品 1 份、练习 ${sequence.practice.length} 份、迁移 ${sequence.transfer.length} 份、复测 ${sequence.retest.length} 份；以下逐份列出。分项对照采用该阶段最近一次提交，待批阅时不回退到旧成绩。</p>
      <p>固定量规：${sequence.rubric.map((item) => `${text(item.name)}（${text(item.weight)}%）`).join("；")}。</p>
      ${sequence.retestAvailableAt ? `<p>复测开放：${time(sequence.retestAvailableAt)}</p>${copy("复测要求：", sequence.retestPrompt)}${copy("复测情境变化：", sequence.retestContext)}<p>固定参照作品 ID：${text(sequence.retestReferenceId ?? "未记录")}；复测观察：${text(evidenceStatus(sequence.retest[0], sequence.objectiveId, "复测"))}</p>` : "<p>尚未安排延后复测，保持情况仍待验证。</p>"}
    </section>
    ${comparison(sequence, sequence.baseline, latestTransfer, ["初次", "迁移"])}
    ${sequence.retestAvailableAt ? comparison(sequence, retestReference, sequence.retest[0], ["固定参照迁移", "复测"]) : ""}
    <section><h2>初次任务</h2>${workEvidence(sequence.baseline, sequence.objectiveId, `work-${sequence.baseline.id}`)}</section>
    ${sequenceStages(sequence).map((stage) => `<section><h2>${SEQUENCE_STAGE_LABELS[stage]} · ${sequence[stage].length} 份作品</h2>${sequence[stage].length ? sequence[stage].map((work) => workEvidence(work, sequence.objectiveId, `work-${work.id}`, stage !== "practice")).join("") : `${copy("要求：", sequencePrompt(sequence, stage))}<p>尚未提交作品。</p>`}</section>`).join("")}
    <section><h2>教师后续安排</h2>${sequence.decisions.length ? sequence.decisions.map((decision) => `<article class="work"><div class="decision-intro"><h3>${text(TEACHING_DECISION_LABELS[decision.kind])} · ${text(decision.nextTitle)}</h3><p>${text(decision.teacherName)} · ${time(decision.createdAt)}</p>${copy("判断理由：", decision.rationale)}${copy("仍待观察：", decision.remaining)}<p><a href="${unitReportUrl(decision.nextSequenceId)}">查看下一轮单元报告</a>；依据作品采用发布安排时保存的快照：</p></div>${workEvidence(decision.reference, sequence.objectiveId, `decision-${decision.id}`, true)}</article>`).join("") : "<p>尚未发布后续教学安排。</p>"}</section>`;
}

export function internalTrialReport(entries: TrialEntry[], tenantName: string, scope: string) {
  const summary = trialSummary(entries, []);
  return `<header><p class="meta">${text(tenantName)} · 内部试用记录报告</p><h1>${text(scope)}</h1></header>
    <p class="notice">教师查看本人耗时与本班观察，管理员查看本机构记录。以下记录不属于学生语言成绩；记录数不等于学生人数。共用备课只记一次，工作方式的任务范围和难度需另行核对，合计不能直接证明节省时间。</p>
    <section><h2>有效工作量记录</h2><div class="table"><table><thead><tr><th>工作内容</th><th>工作方式</th><th>有效记录数</th><th>合计用时</th></tr></thead><tbody>${summary.workload.map((item) => `<tr><th>${TRIAL_KIND_LABELS[item.kind]}</th><td>${TRIAL_METHOD_LABELS[item.method]}</td><td>${item.count}</td><td>${item.minutes === null ? "未记录" : `${item.minutes} 分钟`}</td></tr>`).join("")}</tbody></table></div>
      <p>${summary.observations.map((item) => `${TRIAL_KIND_LABELS[item.kind]}：${item.count} 条`).join("；")}。撤销记录不计入以上汇总。</p></section>
    <section><h2>全部记录与撤销原因 · ${entries.length} 条</h2>${entries.length ? entries.map((entry) => `<article class="work trial-entry"><h3>${TRIAL_KIND_LABELS[entry.kind]}${entry.voidedAt ? " · 已撤销" : ""}</h3>
      <p>${text(entry.className)} · ${text(entry.studentName)} · <a href="${unitReportUrl(entry.sequenceId)}">${text(entry.sequenceTitle)}</a></p>
      <p class="meta">记录 ID：${text(entry.id)}；${text(entry.teacherName)}记录于 ${time(entry.createdAt)}</p>
      ${entry.method ? `<p>${TRIAL_METHOD_LABELS[entry.method]}；实际用时：${entry.minutes === null ? "未记录" : `${entry.minutes} 分钟`}</p>` : ""}
      ${entry.referenceSubmissionId ? `<p>关联作品：<a href="${unitReportUrl(entry.sequenceId)}#work-${encodeURIComponent(entry.referenceSubmissionId)}">${text(entry.referenceTitle)} · ${text(entry.referenceSubmissionId)}</a></p>` : ""}
      ${copy("记录内容：", entry.note)}${entry.voidedAt ? `<p>撤销时间：${time(entry.voidedAt)}</p>${copy("撤销原因：", entry.voidReason ?? "未记录")}` : ""}</article>`).join("") : "<p>当前范围尚无试用记录。</p>"}</section>
    <p>提示次数与作品评价请查看相应单元证据报告。小规模试用用于发现问题，不能据此认定平台导致学习改善。</p>`;
}
