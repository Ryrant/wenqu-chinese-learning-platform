export type EnrollmentDraft = { classId: string; baseIds: string[]; studentUserIds: string[] };

function sameRoster(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((id) => rightSet.has(id));
}

/** 未编辑时直接使用服务端名单；已有草稿时保留原始基线，以发现其他会话的修改。 */
export function enrollmentDraftView(classId: string, currentIds: string[], draft: EnrollmentDraft | null) {
  const activeDraft = draft?.classId === classId ? draft : null;
  const dirty = !!activeDraft && !sameRoster(activeDraft.studentUserIds, activeDraft.baseIds)
    && !sameRoster(activeDraft.studentUserIds, currentIds);
  return {
    studentUserIds: dirty ? activeDraft!.studentUserIds : currentIds,
    expectedStudentUserIds: dirty ? activeDraft!.baseIds : currentIds,
    dirty,
    conflict: dirty && !sameRoster(activeDraft!.baseIds, currentIds),
  };
}
