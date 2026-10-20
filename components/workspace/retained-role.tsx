import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { Act, Notify, Role, WorkspaceData } from "../../lib/platform-types";
import { FeatureBoundary } from "./feature-boundary";

const StudentView = lazy(() => import("../student"));
const TeacherView = lazy(() => import("../teacher"));
const GuardianView = lazy(() => import("../guardian"));
const AdminView = lazy(() => import("../admin"));

type Props = {
  role: Role; active: boolean; nav: string; data: WorkspaceData; receivedAt: number;
  act: Act; notify: Notify; refresh: () => Promise<void>; navigate: (label: string) => void;
  selectStudent: (id: string) => Promise<void>;
};
type Snapshot = Pick<Props, "nav" | "data" | "receivedAt">;

/** 已访问的角色保留会话内草稿；隐藏角色使用原快照，避免其他孩子的数据改变编辑对象。 */
export function RetainedRole(props: Props) {
  const { role, active, nav, data, receivedAt } = props;
  const navigation = useRef({ active, navigate: props.navigate });
  useLayoutEffect(() => { navigation.current = { active, navigate: props.navigate }; });
  const navigate = useCallback((label: string) => {
    if (navigation.current.active) navigation.current.navigate(label);
  }, []);
  const [retained, setRetained] = useState<Snapshot | null>(active ? { nav, data, receivedAt } : null);
  if (active && (retained?.nav !== nav || retained?.data !== data || retained?.receivedAt !== receivedAt)) {
    setRetained({ nav, data, receivedAt });
  }
  if (!retained) return null;
  const shared = { ...props, ...retained, navigate };
  // 保持录音所属组件挂载，让停止录音的异步回调能生成草稿并保留对象 URL。
  return <div hidden={!active}>
    <FeatureBoundary><Suspense fallback={<p className="py-6 text-sm text-muted-foreground" role="status">正在加载页面…</p>}>
      {role === "student" && <StudentView {...shared} active={active}/>}
      {role === "teacher" && <TeacherView {...shared} active={active}/>}
      {role === "guardian" && <GuardianView {...shared}/>}
      {role === "admin" && <AdminView {...shared}/>}
    </Suspense></FeatureBoundary>
  </div>;
}
