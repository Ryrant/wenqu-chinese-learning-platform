import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { SectionHeading } from "../workspace/workspace-ui";

import { useState } from "react";
import type { Act, Notify } from "../../lib/platform-types";
import { HELP_LEVEL_LABELS, TEACHING_DECISION_LABELS, sequenceTime, type LearningSequence, type TeachingDecisionKind } from "../../lib/learning-sequence-types";
import styles from "../learning/learning-sequences.module.css";

const publishErrors: Record<string, string> = {
  invalid_sequence_context: "练习与迁移要求需要不同，请修改后再发布；当前输入已保留。",
  sequence_decision_already_published: "这份依据作品已有后续安排，请选择另一份已评价作品；当前输入已保留。",
  sequence_decision_id_conflict: "这次发布请求已有保存结果，请先查看已发布安排；当前输入已保留。",
};

export function TeachingNextStepPlanner({ sequence, act, notify }: { sequence: LearningSequence; act: Act; notify: Notify }) {
  const [editing, setEditing] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<TeachingDecisionKind | "">("");
  const [rationale, setRationale] = useState("");
  const [remaining, setRemaining] = useState("");
  const [title, setTitle] = useState(`${sequence.title}的下一轮任务`.slice(0, 120));
  const [practicePrompt, setPracticePrompt] = useState("");
  const [transferPrompt, setTransferPrompt] = useState("");
  const [transferContext, setTransferContext] = useState("");
  const [busy, setBusy] = useState(false);
  const sources = [...sequence.retest, ...sequence.transfer].filter((work) => work.reviewed);
  const used = (id: string) => sequence.decisions.some((item) => item.reference.id === id);
  const available = sources.filter((work) => !used(work.id));
  const reference = sources.find((work) => work.id === referenceId);
  if (!sources.length) return <p>迁移或复测作品经教师评价后，可据此安排下一轮教学任务。</p>;
  return <div className={styles.scheduler}>
    {(!!available.length || editing) && <Button variant="outline" type="button" disabled={busy} onClick={() => {
      if (!editing && (!reference || used(referenceId))) { setReferenceId(available[0].id); setRequestId(crypto.randomUUID()); }
      setEditing(!editing);
    }}>{editing ? "收起后续安排" : "安排下一轮教学任务"}</Button>}
    {editing && <form className="form-card rounded-xl border bg-muted/20 p-5" onSubmit={async (event) => {
      event.preventDefault(); if (busy || !reference || used(referenceId)) return; setBusy(true);
      try {
        await act("publish_teaching_next_step", { id: requestId, sequenceId: sequence.id, referenceSubmissionId: referenceId, kind, rationale, remaining, title, practicePrompt, transferPrompt, transferContext });
        setEditing(false); setReferenceId(""); setRequestId(crypto.randomUUID()); setKind(""); setRationale(""); setRemaining(""); setPracticePrompt(""); setTransferPrompt(""); setTransferContext("");
        notify("后续安排已发布", `“${title}”已加入学生任务；教学判断与依据已保存。`);
      } catch (reason) { notify("后续安排发布失败", reason instanceof Error ? publishErrors[reason.message] ?? reason.message : "请重试，输入已保留。", "error"); }
      finally { setBusy(false); }
    }}><SectionHeading title="下一轮教学安排" description={sequence.objectiveTitle}/><fieldset className={styles.fields} disabled={busy}>
      <label>教学判断依据<NativeSelect className="w-full" required value={referenceId} onChange={(event) => { setReferenceId(event.target.value); setRequestId(crypto.randomUUID()); }}>
        {sources.map((work) => <option key={work.id} value={work.id} disabled={used(work.id)}>{work.title} · {sequenceTime(work.submittedAt)} · {work.id.slice(0, 8)}{used(work.id) ? "（已有安排）" : ""}</option>)}
      </NativeSelect></label>
      {reference && <p>本次目标评价：{reference.objectives.find((item) => item.id === sequence.objectiveId)?.score ?? "未评价"}；帮助程度：{HELP_LEVEL_LABELS[reference.helpLevel]}；新情境：{reference.contextConfirmed ? "教师已确认" : "尚未确认"}。</p>}
      {used(referenceId) && <p role="alert">该依据作品已有后续安排，请选择另一份已评价作品。当前输入仍保留。</p>}
      <label>教师后续判断<NativeSelect className="w-full" required value={kind} onChange={(event) => setKind(event.target.value as TeachingDecisionKind)}><option value="">请选择教学方向</option>{Object.entries(TEACHING_DECISION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
      <label>判断理由<Textarea required maxLength={2000} value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="结合该作品的目标表现、实际帮助和新情境，说明下一步为什么这样安排。"/></label>
      <label>仍待观察的能力或证据边界<Textarea required maxLength={1000} value={remaining} onChange={(event) => setRemaining(event.target.value)} placeholder="例如：仍需观察撤去关键词后能否独立追问；未评价的目标不能视为已掌握。"/></label>
      <div className="my-2 border-t pt-5"><h4 className="font-medium">新任务</h4></div>
      <label>下一轮任务组名称<Input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)}/></label>
      <label>下一轮练习要求<Textarea required maxLength={2000} value={practicePrompt} onChange={(event) => setPracticePrompt(event.target.value)}/></label>
      <label>下一轮迁移要求<Textarea required maxLength={2000} value={transferPrompt} onChange={(event) => setTransferPrompt(event.target.value)}/></label>
      <label>下一轮对象或情境变化<Textarea required maxLength={1000} value={transferContext} onChange={(event) => setTransferContext(event.target.value)}/></label>
      <details className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground"><summary className="cursor-pointer">任务规则</summary><p className="mt-2">沿用“{sequence.objectiveTitle}”、本组量规与{sequence.medium === "audio" ? "录音" : "文字"}提交方式，练习经教师评价后开放迁移。每份依据作品只能发布一份后续安排；发布后保留原判断。</p></details>
      <Button type="submit" disabled={busy || !reference || used(referenceId)}>{busy ? "发布中…" : "发布下一轮任务"}</Button>
    </fieldset></form>}
  </div>;
}
