import { useState } from "react";
import type { WorkspaceData } from "@/app/lib/platform-types";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";

export function GuardianStudentSwitcher({ data, selectStudent }: { data: WorkspaceData; selectStudent: (studentId: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <Card className="child-switcher" aria-label="多孩子切换">
    <span>当前孩子</span>
    <NativeSelect className="w-full" value={data.selectedStudent?.id ?? ""} disabled={busy || !data.availableStudents.length} onChange={async (event) => {
      setBusy(true);
      try { await selectStudent(event.target.value); } finally { setBusy(false); }
    }}>
      {!data.availableStudents.length && <option value="">暂无已绑定孩子</option>}
      {data.availableStudents.map((student) => <option value={student.id} key={student.id}>{student.displayName}</option>)}
    </NativeSelect>
  </Card>;
}

export default GuardianStudentSwitcher;
