import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { SectionHeading } from "./workspace/workspace-ui";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

import { useEffect, useState } from "react";
import { ABILITY_LABELS, diagnosticMediaUrl, type AbilityProfile } from "../lib/diagnostic-types";
import { FAMILY_HELP_LABELS, type Notify, type WorkspaceData } from "../lib/platform-types";

export function DiagnosticStimulus({ id, kind }: { id: string; kind: "audio" | "image" }) {
  return kind === "audio"
    ? <audio controls preload="metadata" src={diagnosticMediaUrl(id)} aria-label="听力材料"/>
    : <img className="diagnostic-image" src={diagnosticMediaUrl(id)} width={640} height={360} loading="lazy" decoding="async" alt="口述诊断图片"/>;
}

export function DiagnosticMediaInput({ kind, value, onChange, uploading, setUploading, notify, disabled = false }: {
  kind: "audio" | "image"; value: string; onChange: (id: string) => void;
  uploading: boolean; setUploading: (value: boolean) => void; notify: Notify; disabled?: boolean;
}) {
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData(); form.set("kind", kind); form.set("file", file);
      const response = await fetch("/api/v1/diagnostic-media", { method: "POST", body: form });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "素材未保存");
      onChange(result.id);
    } catch (reason) { notify("素材上传失败", reason instanceof Error ? reason.message : "请重新选择文件", "error"); }
    finally { input.value = ""; setUploading(false); }
  }
  return <div className="diagnostic-media-input">
    <label>{kind === "audio" ? "听力音频" : "题目图片"}<Input type="file" accept={kind === "audio" ? "audio/mpeg,audio/wav,audio/x-wav,audio/webm,audio/ogg,audio/mp4" : "image/png,image/jpeg,image/webp"} disabled={disabled || uploading} onChange={upload}/></label>
    <small>{uploading ? "正在上传素材…" : kind === "image" ? "支持 PNG、JPEG、WebP，最大 12 MB。" : "支持 MP3、WAV、WebM、Ogg、MP4 音频，最大 12 MB。"}</small>
    {value && <DiagnosticStimulus id={value} kind={kind}/>}
  </div>;
}

function evidenceTime(value: string) {
  const utc = /Z|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function AbilityEvidenceProfile({ studentId, revision }: { studentId: string; revision: string }) {
  const [result, setResult] = useState<{ key: string; data: AbilityProfile | null; error: string }>({ key: "", data: null, error: "" });
  const [retry, setRetry] = useState(0);
  const requestKey = `${studentId}:${revision}:${retry}`;
  useEffect(() => {
    if (!studentId) return;
    const controller = new AbortController();
    let active = true;
    fetch(`/api/v1/ability-profile?studentId=${encodeURIComponent(studentId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取该学生的证据画像，请重试。");
        return await response.json() as AbilityProfile;
      }).then((data) => { if (active) setResult({ key: requestKey, data, error: "" }); })
      .catch((reason) => { if (active) setResult({ key: requestKey, data: null, error: reason instanceof Error ? reason.message : "画像加载失败" }); });
    return () => { active = false; controller.abort(); };
  }, [studentId, requestKey]);
  if (!studentId) return <p className="empty-state">选择学生后查看能力证据。</p>;
  const current = result.key === requestKey ? result : null;
  return <Card className="gap-0 p-6 ability-profile" aria-label="能力差异与证据画像">
    <SectionHeading title={`听说读写${current?.data ? ` · ${current.data.student.displayName}` : ""}`} description="查看各项能力的作品与教师评价。"/>
    {!current && <p role="status">正在读取证据…</p>}
    {current?.error && <div role="alert"><p>{current.error}</p><Button variant="outline" type="button" onClick={() => setRetry(retry + 1)}>重试读取画像</Button></div>}
    {current?.data && <>
      {!!current.data.legacyAnswerCount && <p>另有 {current.data.legacyAnswerCount} 条历史答案未保存题面快照，未计入本画像；原诊断记录保持保留。</p>}
      <div className="ability-grid">{Object.entries(ABILITY_LABELS).map(([ability, label]) => {
        const records = current.data!.evidence.filter((item) => item.ability === ability);
        const assessed = records.filter((item) => item.status === "assessed");
        const pending = records.filter((item) => item.status === "pending").length;
        return <Card className="ability-card gap-0 p-5 shadow-none" key={ability}>
          <h4>{label}</h4><strong>{assessed.length ? `${assessed.reduce((sum, item) => sum + item.evidenceCount, 0)} 条证据 · ${assessed.length} 次记录` : "待评估"}</strong>
          {!!pending && <p>{pending} 份作品待教师评价</p>}
          {assessed.length === 1 && <p>目前仅有一次记录，仍需其他情境验证。</p>}
          {assessed[0]?.scores.map((score) => <p key={score.objectiveId}>最近：{score.title} · {assessed[0].kind === "choice" ? `正确率 ${score.score}%` : `${score.score}/100`}</p>)}
          {records.length ? <details><summary>查看 {records.length} 次记录与原始作品</summary>{records.map((item) => <article className="ability-evidence" key={item.id}>
            <h5>{item.title}</h5><small>提交于 {evidenceTime(item.submittedAt)}</small>
            {item.measuredAt && <small>评价于 {evidenceTime(item.measuredAt)} · {item.reviewer ?? "教师"}</small>}
            {item.prompt && <p>{item.prompt}</p>}
            {item.mediaId && <DiagnosticStimulus id={item.mediaId} kind="image"/>}
            {item.textAnswer && <blockquote>{item.textAnswer}</blockquote>}
            {item.hasAudio && item.submissionId && <audio controls preload="metadata" src={`/api/v1/submissions/${encodeURIComponent(item.submissionId)}/audio`} aria-label="诊断原始录音"/>}
            {item.answers.map((answer, index) => <div className="evidence-answer" key={index}>
              <p>{answer.prompt}</p>{answer.mediaId && <DiagnosticStimulus id={answer.mediaId} kind="audio"/>}
              <p>原始回答：{answer.selected} · {answer.correct ? "正确" : `参考答案：${answer.expected}`}</p>
            </div>)}
            {item.status === "pending" ? <p>待教师评价，尚未形成能力成绩。</p> : item.status === "unassessed" ? <p>教师尚未评价具体目标，不能仅凭作品总分判断能力。</p> : item.scores.map((score) => <p key={score.objectiveId}>{score.title}：{score.score}{item.kind === "choice" ? "%（正确率）" : "/100"}</p>)}
            {item.dimensions.map((score) => <small key={score.name}>{score.name}：{score.score}/100</small>)}
            {item.feedback && <p>教师反馈：{item.feedback}</p>}
            {item.familyHelp && <p>家庭帮助情况：{FAMILY_HELP_LABELS[item.familyHelp] ?? item.familyHelp}</p>}
          </article>)}</details> : <p>尚无该能力的诊断作品。</p>}
        </Card>;
      })}</div>
    </>}
  </Card>;
}

export function TeacherAbilityProfiles({ data }: { data: WorkspaceData }) {
  const students = [...new Map(data.enrollments.filter((item) => item.status === "active").map((item) => [String(item.studentUserId), String(item.studentName)])).entries()];
  const [selected, setSelected] = useState(students[0]?.[0] ?? "");
  const studentId = students.some(([id]) => id === selected) ? selected : students[0]?.[0] ?? "";
  return <section className="loop-section">
    <label>查看学生证据<NativeSelect className="w-full" value={studentId} onChange={(event) => setSelected(event.target.value)}><option value="">请选择学生</option>{students.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</NativeSelect></label>
    <AbilityEvidenceProfile key={studentId} studentId={studentId} revision={data.generatedAt}/>
  </section>;
}
