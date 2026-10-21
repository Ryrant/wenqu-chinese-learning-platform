export type EnrollmentDraft = { classId: string; baseIds: string[]; studentUserIds: string[]; awaitingRead?: boolean };

function sameRoster(left: readonly string[], right: readonly string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((id) => rightSet.has(id));
}

/** 未编辑时直接使用服务端名单；已有草稿时保留原始基线，以发现其他会话的修改。 */
export function enrollmentDraftView(classId: string, currentIds: string[], draft: EnrollmentDraft | null, selectableIds?: readonly string[]) {
  const activeDraft = draft?.classId === classId ? draft : null;
  const pendingRead = !!activeDraft?.awaitingRead && !sameRoster(activeDraft.baseIds, currentIds);
  const dirty = !!activeDraft && !sameRoster(activeDraft.studentUserIds, activeDraft.baseIds)
    && !sameRoster(activeDraft.studentUserIds, currentIds);
  const selectedIds = pendingRead || dirty ? activeDraft!.studentUserIds : currentIds;
  return {
    // 停用学生的当前学籍仍参与并发比较，但不能进入新的可用学生名单。
    studentUserIds: selectableIds ? selectedIds.filter((id) => selectableIds.includes(id)) : selectedIds,
    expectedStudentUserIds: pendingRead || dirty ? activeDraft!.baseIds : currentIds,
    dirty,
    pendingRead,
    conflict: !pendingRead && dirty && !sameRoster(activeDraft!.baseIds, currentIds),
  };
}
