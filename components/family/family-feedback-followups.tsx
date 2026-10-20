import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { FEEDBACK_CASE_LABELS, FEEDBACK_RESPONSE_LABELS, FOLLOWUP_OUTCOME_LABELS, feedbackCaseState, type FamilyFeedbackEntry } from "../../lib/family-feedback-types";
import { sequenceTime } from "../../lib/learning-sequence-types";
import styles from "./family-feedback.module.css";

export type SupportDraft = { editing: boolean; kind: string; detail: string; reason: string; error: string; busy: boolean; attempt: { key: string; id: string } | null };
export const emptySupportDraft: SupportDraft = { editing: false, kind: "", detail: "", reason: "", error: "", busy: false, attempt: null };
export function FeedbackSupport({ entry, entries, drafts, update, save }: {
  entry: FamilyFeedbackEntry; entries: FamilyFeedbackEntry[]; drafts: Record<string, SupportDraft>;
  update: (id: string, patch: Partial<SupportDraft>) => void; save: (body: Record<string, unknown>) => Promise<void>;
}) {
  const key = `respond:${entry.id}`; const draft = drafts[key] ?? emptySupportDraft;
  const source = entry.responseId ? entries.find((item) => item.responses.some((response) => response.id === entry.responseId)) : null;
  const linked = source?.responses.find((response) => response.id === entry.responseId);
  return <section aria-label="家庭困难处理记录">
    {entry.responseId ? <><p>后续反馈 / Follow-up：{entry.followupOutcome ? FOLLOWUP_OUTCOME_LABELS[entry.followupOutcome].join(" / ") : "结果未保留 / Outcome unavailable"}</p>
      <p>处理记录 / Support ID：{entry.responseId}</p>{source && <p className={styles.copy}>原反馈 / Original feedback：v{source.revision} · {source.id.slice(0, 8)} · {source.note}</p>}
      {linked && <p className={styles.copy}>{FEEDBACK_RESPONSE_LABELS[linked.kind].join(" / ")}：{linked.detail}{linked.voidedAt ? "（已撤销 / Withdrawn）" : ""}</p>}</> : <>
      <h4>困难处理 / Support</h4><p>{FEEDBACK_CASE_LABELS[feedbackCaseState(entry, entries)].join(" / ")}</p>
      <details className={styles.meta}><summary>处理状态说明 / About support status</summary><p>按最近有效处理及对应的再反馈显示状态；处理结果、任务完成和语言成绩分别记录。 / Status follows active support and the linked follow-up, separately from task completion and language scores.</p></details>
      {entry.responses.map((response) => {
        const voidKey = `void-response:${response.id}`; const withdrawal = drafts[voidKey] ?? emptySupportDraft;
        const followups = entries.filter((item) => item.responseId === response.id);
        return <article className={styles.entry} key={response.id}><p><strong>{FEEDBACK_RESPONSE_LABELS[response.kind].join(" / ")}{response.voidedAt ? " · 已撤销 / Withdrawn" : ""}</strong></p>
          <p>{response.authorName} · {sequenceTime(response.createdAt)} · {response.id.slice(0, 8)}</p><p className={styles.copy}>{response.detail}</p>
          {response.voidedAt && <p className={styles.copy}>撤销 / Withdrawn：{sequenceTime(response.voidedAt)} · {response.voidReason}</p>}
          {followups.length ? followups.map((followup) => <div key={followup.id}><p>{followup.followupOutcome ? FOLLOWUP_OUTCOME_LABELS[followup.followupOutcome].join(" / ") : "结果未保留"} · v{followup.revision} · {sequenceTime(followup.createdAt)} · {followup.id.slice(0, 8)}{followup.voidedAt ? " · 已撤销 / Withdrawn" : ""}</p><p className={styles.copy}>{followup.note || "未补充说明 / No additional note"}</p>{followup.voidedAt && <p className={styles.copy}>{followup.voidReason}</p>}</div>) : <p>尚无对应的再反馈 / No linked family follow-up yet.</p>}
          {response.canVoid && (!withdrawal.editing ? <Button variant="outline" type="button" onClick={() => update(voidKey, { editing: true })}>撤销处理记录</Button> : <form onSubmit={async (event) => {
            event.preventDefault(); if (withdrawal.busy) return; update(voidKey, { busy: true, error: "" });
            try { await save({ action: "void_response", id: response.id, reason: withdrawal.reason.trim() }); update(voidKey, emptySupportDraft); }
            catch (error) { update(voidKey, { error: error instanceof Error ? error.message : "撤销未确认，请重试。" }); }
            finally { update(voidKey, { busy: false }); }
          }}><fieldset className={styles.fields} disabled={withdrawal.busy}><label>处理记录撤销原因<Textarea required maxLength={1000} value={withdrawal.reason} onChange={(event) => update(voidKey, { reason: event.target.value })}/></label>{withdrawal.error && <p role="alert">{withdrawal.error}</p>}<div className={styles.actions}><Button type="submit" variant="outline">保存撤销原因</Button><Button variant="outline" type="button" onClick={() => update(voidKey, { editing: false })}>取消</Button></div></fieldset></form>)}
        </article>;
      })}
      {entry.canRespond && (!draft.editing ? <Button variant="outline" type="button" onClick={() => update(key, { editing: true })}>记录处理办法</Button> : <form onSubmit={async (event) => {
        event.preventDefault(); if (draft.busy || !draft.kind || !draft.detail.trim()) return;
        const payload = { action: "respond", feedbackId: entry.id, kind: draft.kind, detail: draft.detail.trim() };
        const attemptKey = JSON.stringify(payload); const id = draft.attempt?.key === attemptKey ? draft.attempt.id : crypto.randomUUID();
        update(key, { busy: true, error: "", attempt: { key: attemptKey, id } });
        try { await save({ ...payload, id }); update(key, emptySupportDraft); }
        catch (error) { update(key, { error: error instanceof Error ? error.message : "保存未确认，请重试；输入已保留。" }); }
        finally { update(key, { busy: false }); }
      }}><fieldset className={styles.fields} disabled={draft.busy}><label>支持方式<NativeSelect className="w-full" required value={draft.kind} onChange={(event) => update(key, { kind: event.target.value })}><option value="">请选择具体方式</option>{Object.entries(FEEDBACK_RESPONSE_LABELS).map(([id, labels]) => <option key={id} value={id}>{labels[0]}</option>)}</NativeSelect></label>
        <label>给家长的具体处理办法<Textarea required maxLength={2000} value={draft.detail} onChange={(event) => update(key, { detail: event.target.value })}/></label><p>家长可见，请写清如何操作或联系谁；修改任务需另到原任务保存，此处仅记录办法。</p>{draft.error && <p role="alert">{draft.error}</p>}<div className={styles.actions}><Button type="submit" disabled={draft.busy || !draft.kind || !draft.detail.trim()}>{draft.busy ? "保存并核对中…" : "保存处理办法"}</Button><Button variant="outline" type="button" onClick={() => update(key, { editing: false })}>取消</Button></div>
      </fieldset></form>)}
      {!entry.voidedAt && entry.responses.some((response) => !response.voidedAt) && <p>家长可在“记录家庭使用情况”中选择同一任务，再选择对应处理记录并填写结果。 / To follow up, choose the same task and support record in “Record family experience”.</p>}
    </>}
  </section>;
}
