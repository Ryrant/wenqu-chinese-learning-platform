import { lazy } from "react";
import type { AdminProps } from "../shared/staff-display";
import { RetainedFeature } from "../shared/retained-feature";

const OverviewPage = lazy(() => import("./overview-page"));
const ContentPage = lazy(() => import("./content-page"));
const MembersPage = lazy(() => import("./members-page"));
const AuditPage = lazy(() => import("./audit-page"));
const KnowledgePage = lazy(() => import("./knowledge-page"));
const SettingsPage = lazy(() => import("./settings-page"));
const ObjectiveLibrary = lazy(() => import("./objective-library"));
const EnrollmentEditor = lazy(() => import("./enrollment-editor"));

export default function AdminView(props: AdminProps) {
  const { nav, data, act, notify } = props;
  return <>
    <RetainedFeature active={nav === "机构总览"}><OverviewPage {...props}/></RetainedFeature>
    <RetainedFeature active={nav === "内容中心"}>
      <ContentPage {...props}/><ObjectiveLibrary data={data} act={act} notify={notify}/>
    </RetainedFeature>
    <RetainedFeature active={nav === "成员管理"}>
      <MembersPage {...props}/><section className="loop-section enrollment-section"><EnrollmentEditor data={data} act={act} notify={notify}/></section>
    </RetainedFeature>
    <RetainedFeature active={nav === "权限审计"}><AuditPage {...props}/></RetainedFeature>
    <RetainedFeature active={nav === "知识检索"}><KnowledgePage {...props}/></RetainedFeature>
    <RetainedFeature active={nav === "平台设置"}><SettingsPage {...props}/></RetainedFeature>
  </>;
}
