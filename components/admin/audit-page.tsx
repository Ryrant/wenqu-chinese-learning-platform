import { useCallback, useEffect, useRef, useState } from "react";
import { stringValue } from "@/lib/platform-types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/workspace/workspace-ui";
import type { AdminProps } from "@/lib/staff-display";
import { localDate } from "@/lib/staff-display";

type AuditEvent = Record<string, unknown>;
type AuditQuery = { action: string; actorId: string; from: string; to: string };
type AuditSnapshot = { query: AuditQuery; events: AuditEvent[]; cursor: string | null };

const TARGET_LABELS: Record<string, string> = {
  class: "班级",
  submission: "学生作业",
  lesson_plan: "教案草稿",
  diagnostic_attempt: "入学诊断",
  user: "成员账号",
  learning_recommendation: "学习与家庭任务",
  learning_sequence: "迁移任务组",
  trial_record: "试用记录",
  source_document: "内容资料",
  invitation: "成员邀请",
  consent: "监护授权",
};

const AUDIT_LABELS: Record<string, string> = {
  "class.enrollments_updated": "更新班级名单",
  "submission.reviewed": "教师确认作业",
  "submission.ai_review_suggested": "生成作业批阅建议",
  "submission.created": "学生提交作业",
  "lesson_plan.generated": "生成教案草稿",
  "lesson_plan.updated": "编辑教案草稿",
  "lesson_plan.archived": "归档教案草稿",
  "diagnostic.completed": "完成入学诊断",
  "member.status_changed": "更新成员状态",
  "member.created": "创建成员",
  "family_task.created": "创建家庭任务",
  "learning_sequence.created": "发布练习与迁移任务",
  "learning_sequence.retest_scheduled": "安排延后复测",
  "learning_sequence.next_step_published": "发布后续教学安排",
  "trial_record.created": "添加试用记录",
  "trial_record.voided": "撤销试用记录",
  "family_submission.confirmed": "家长确认交流与帮助",
  "family_submission.witnessed": "教师见证替代交流与帮助",
  "family_task.updated": "编辑家庭任务",
  "family_task.archived": "归档家庭任务",
  "source.reviewed": "审核内容资料",
  "source.reprocessed": "重新处理内容资料",
  "source.archived": "归档内容资料",
  "invitation.created": "创建成员邀请",
  "consent.updated": "更新监护授权",
};

export function AuditPage({ data, act, notify }: AdminProps) {
const [inviteEmail, setInviteEmail] = useState("");
const [inviteRole, setInviteRole] = useState("teacher");
const [inviteResult, setInviteResult] = useState<Record<string, unknown> | null>(null);
const [auditSnapshot, setAuditSnapshot] = useState<AuditSnapshot | null>(null);
const submittedQuery = useRef<AuditQuery | null>(null);
const auditRequest = useRef(0);
const [auditAction, setAuditAction] = useState("");
const [auditActor, setAuditActor] = useState("");
const [auditFrom, setAuditFrom] = useState("");
const [auditTo, setAuditTo] = useState("");
const [auditBusy, setAuditBusy] = useState(false);
const [auditError, setAuditError] = useState<string | null>(null);
const auditEvents = auditSnapshot?.events ?? data.audits;
const auditCursor = auditSnapshot?.cursor ?? null;
const loadAudits = useCallback(async (query: AuditQuery, cursor?: string) => {
    submittedQuery.current = query;
    const requestId = ++auditRequest.current;
    setAuditBusy(true);
    setAuditError(null);
    try {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/v1/workspace/audits?${params}`, { cache: "no-store" });
      const payload = await response.json() as { events?: AuditEvent[]; nextCursor?: string | null; error?: string };
      if (requestId !== auditRequest.current) return;
      if (!response.ok) throw new Error(payload.error ?? "审计记录加载失败");
      setAuditSnapshot((previous) => ({
        query,
        events: [...new Map([...(cursor ? previous?.events ?? [] : []), ...(payload.events ?? [])].map((item) => [String(item.id), item])).values()],
        cursor: payload.nextCursor ?? null,
      }));
    } catch (reason) {
      if (requestId === auditRequest.current) setAuditError(reason instanceof Error ? reason.message : "请重试");
    } finally {
      if (requestId === auditRequest.current) setAuditBusy(false);
    }
  }, []);

useEffect(() => {
  // 默认列表由工作区持有；独立查询保留已提交条件，刷新时不读取仍在编辑的筛选输入。
  if (submittedQuery.current) void loadAudits(submittedQuery.current);
  return () => { auditRequest.current += 1; };
}, [data.audits, loadAudits]);
return <section key="permission-audit">
    <PageHeader title="权限审计" description="查看成员邀请与机构操作记录。"/>
    <section className="audit-invite-grid"><form className="panel form-card compact-form" onSubmit={async (event) => { event.preventDefault(); try { const result = await act("create_invitation", { email: inviteEmail, role: inviteRole }); setInviteResult(result); setInviteEmail(""); notify("邀请已创建", "邀请令牌将在 24 小时后失效。"); } catch (reason) { notify("邀请失败", reason instanceof Error ? reason.message : "请重试", "error"); } }}><h3>邀请成员</h3><label>邮箱<Input type="email" autoComplete="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required/></label><label>角色<NativeSelect className="w-full" value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="teacher">教师</option><option value="guardian">家长</option><option value="student">学生</option><option value="admin">管理员</option></NativeSelect></label><Button type="submit" variant="default">创建 24 小时邀请</Button>{inviteResult && <p className="token-result">邀请码：<code>{stringValue(inviteResult.token)}</code></p>}</form><Card className="panel "><h3>待处理邀请</h3>{data.invitations.length ? data.invitations.map((item) => <div className="history-row" key={String(item.id)}><div><strong>{stringValue(item.email)}</strong><small>{stringValue(item.role)} · 截止 {localDate(item.expiresAt)}</small></div><span className="status draft">待接受</span></div>) : <div className="empty-state formal-empty"><strong>暂无待处理邀请</strong><p>新建的 24 小时邀请会显示在这里。</p></div>}</Card></section>
    <Card className="panel audit-panel"><div className="panel-heading"><div><span className="eyebrow">最近审计</span><h3>操作记录</h3></div></div><form className="audit-filters" onSubmit={(event) => { event.preventDefault(); void loadAudits({ action: auditAction, actorId: auditActor, from: auditFrom, to: auditTo }); }}><label>操作类型<NativeSelect className="w-full" value={auditAction} onChange={(event) => setAuditAction(event.target.value)}><option value="">全部操作</option>{Object.entries(AUDIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label><label>操作者<NativeSelect className="w-full" value={auditActor} onChange={(event) => setAuditActor(event.target.value)}><option value="">全部成员</option>{data.members.map((member) => <option key={String(member.id)} value={String(member.id)}>{member.displayName}</option>)}</NativeSelect></label><label>开始日期<Input type="date" value={auditFrom} onChange={(event) => setAuditFrom(event.target.value)}/></label><label>结束日期<Input type="date" value={auditTo} onChange={(event) => setAuditTo(event.target.value)}/></label><Button type="submit" variant="default" disabled={auditBusy}>{auditBusy ? "查询中…" : "筛选记录"}</Button></form>{auditError && <div className="flex items-center gap-3 text-sm text-destructive" role="alert"><p>审计记录读取失败：{auditError}。已保留当前记录。</p><Button type="button" variant="outline" disabled={auditBusy} onClick={() => { if (submittedQuery.current) void loadAudits(submittedQuery.current); }}>重新读取</Button></div>}<div className="audit-events" aria-busy={auditBusy}>{auditEvents.length ? auditEvents.map((item) => { const targetType = stringValue(item.targetType ?? item.target_type, ""); return <div className="audit-event" key={String(item.id)}><i/><div><strong>{AUDIT_LABELS[stringValue(item.action)] ?? "系统操作"}</strong><p>{stringValue(item.actorDisplayName, "未知操作者")} · {TARGET_LABELS[targetType] ?? "业务对象"}</p><small>{localDate(item.createdAt ?? item.created_at)}</small></div></div>; }) : <div className="empty-state formal-empty"><strong>没有符合条件的审计记录</strong><p>调整筛选条件后重新查询。</p></div>}</div>{auditCursor && <Button type="button" variant="outline" className="load-more" disabled={auditBusy} onClick={() => { if (auditSnapshot && auditCursor) void loadAudits(auditSnapshot.query, auditCursor); }}>加载更多</Button>}</Card>
  </section>;
}

export default AuditPage;
