import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

import { useState } from "react";
import { EXCHANGE_PARTNERS, FAMILY_HELP_EN, readFamilyWorkSnapshot, type BilingualText, type FamilyPlan } from "./lib/family-task";
import { FAMILY_HELP_LABELS, stringValue, type Act, type Notify, type Row } from "./lib/platform-types";
import styles from "./family-task-guide.module.css";

function Bilingual({ text }: { text: BilingualText }) {
  return <><span>{text.zh}</span><span className={styles.english} lang="en">{text.en}</span></>;
}

export function FamilyTaskGuide({ plan, title = "交流步骤、提问卡与句式 / Conversation guide", detail, objectiveTitle, expanded = false }: {
  plan: FamilyPlan | null; title?: string; detail?: string; objectiveTitle?: string; expanded?: boolean;
}) {
  const template = plan?.template;
  return <details className={styles.guide} open={expanded}>
    <summary>{title}</summary>
    {objectiveTitle && <p>学习目标 / Learning goal：{objectiveTitle}</p>}
    {detail && <p className={styles.copy}>{detail}</p>}
    {plan && <p>建议交流对象 / Suggested partner：{EXCHANGE_PARTNERS[plan.partner].zh} / {EXCHANGE_PARTNERS[plan.partner].en}</p>}
    {template ? <><h4><Bilingual text={template.title}/></h4><h5>交流步骤 / Steps</h5>
      <ol>{template.steps.map((step, index) => <li key={index}><Bilingual text={step}/></li>)}</ol>
      <h5>提问与追问卡 / Questions and follow-ups</h5>
      {template.questions.map((card, index) => <div className={styles.question} key={index}><p><Bilingual text={card.ask}/></p><p>追问 / Follow-up：<Bilingual text={card.followUp}/></p></div>)}
      <h5>可选句式 / Optional sentence starters</h5><ul>{template.stems.map((stem, index) => <li key={index}><Bilingual text={stem}/></li>)}</ul>
      <h5>自己的作品 / Your own work</h5><p><Bilingual text={template.work}/></p>
    </> : <p><Bilingual text={{ zh: "请按上方任务说明完成。", en: "Follow the task instructions above." }}/></p>}
    <p className={styles.english}>没有合适家人时，可和同伴或教师交流，并在提交时记录实际对象。<span lang="en"> If no family partner is available, talk with a peer or teacher and record your actual partner when submitting.</span></p>
  </details>;
}

export function FamilyWorkEvidence({ value }: { value: unknown }) {
  const snapshot = readFamilyWorkSnapshot(value);
  if (!snapshot) return <p className={styles.english}>这份历史作品未保留原交流要求。 / The original instructions are unavailable.</p>;
  return <section><p>本次实际交流对象 / Actual partner：{EXCHANGE_PARTNERS[snapshot.partner].zh} / {EXCHANGE_PARTNERS[snapshot.partner].en}</p>
    <FamilyTaskGuide plan={snapshot.plan} title={`提交时的交流要求：${snapshot.title}`} detail={snapshot.detail} objectiveTitle={snapshot.objectiveTitle}/>
  </section>;
}

export function FamilyExchangeConfirmation({ work, actor, act, notify }: { work: Row; actor: "guardian" | "teacher"; act: Act; notify: Notify }) {
  const [helpLevel, setHelpLevel] = useState(stringValue(work.family_help_level, ""));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const snapshot = readFamilyWorkSnapshot(work.family_snapshot_json);
  const canConfirm = actor === "guardian" || (!!snapshot && snapshot.partner !== "family");
  const confirmed = !!work.family_confirmed_at;
  const status = confirmed ? [work.family_confirmation_role === "teacher" ? "教师已见证 / Witnessed by teacher" : work.family_confirmation_role === "guardian" ? "家长已确认 / Confirmed by guardian" : "交流已确认 / Exchange confirmed", stringValue(work.familyConfirmedName, ""), FAMILY_HELP_LABELS[stringValue(work.family_help_level, "")] ?? "未记录帮助程度"].filter(Boolean).join(" · ") : "等待确认交流与帮助情况 / Awaiting confirmation of the exchange and help used";
  if (!canConfirm || work.review_status === "reviewed") return <p>{status}</p>;
  if (confirmed && !editing) return <div><p>{status}</p><Button variant="outline" type="button" onClick={() => setEditing(true)}>修改帮助记录 / Edit help record</Button></div>;
  return <form className="form-card" onSubmit={async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await act(actor === "teacher" ? "confirm_alternative_exchange" : "confirm_family_submission", { submissionId: work.id, helpLevel });
      setEditing(false); notify("交流与帮助情况已记录", "等待教师评价作品。");
    } catch (reason) { notify("确认失败", reason instanceof Error ? reason.message : "请重试，当前选择已保留。", "error"); }
    finally { setBusy(false); }
  }}>
    <p className={styles.english}>{actor === "teacher" ? "仅在本人见证本次同伴或教师交流后确认。 / Confirm only if you witnessed this peer or teacher exchange." : "请确认这次交流确实发生，并记录实际帮助；不需要家长给语言成绩。 / Confirm the exchange happened and report the actual help. Parents do not assign a language score."}</p>
    <label>本次交流中的帮助程度 / Help used<NativeSelect className="w-full" required value={helpLevel} disabled={busy} onChange={(event) => setHelpLevel(event.target.value)}><option value="">请选择 / Please select</option>{Object.entries(FAMILY_HELP_LABELS).map(([value, label]) => <option key={value} value={value}>{label} / {FAMILY_HELP_EN[value]}</option>)}</NativeSelect></label>
    <Button className="h-auto min-h-10 max-w-full whitespace-normal" type="submit" variant="outline" disabled={busy}>{busy ? "保存中… / Saving…" : actor === "teacher" ? "确认已见证交流及帮助 / Confirm witnessed exchange" : "确认交流及帮助情况 / Confirm exchange and help"}</Button>
  </form>;
}
