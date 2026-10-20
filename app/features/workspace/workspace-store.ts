import type { WorkspaceData, WorkspacePatch, WorkspaceSection } from "../../lib/platform-types";
import { ApiError, readWorkspace } from "./api";

type Reader = typeof readWorkspace;
type LoadOptions = { force?: boolean; revalidate?: boolean; studentId?: string };
export type WorkspaceSnapshot = { data: WorkspaceData | null; receivedAt: number };

const sectionFields: Record<WorkspaceSection, readonly (keyof WorkspaceData)[]> = {
  teaching: ["classes", "assignments", "enrollments"], curriculum: ["learningObjectives", "diagnosticItems"],
  progress: ["submissions", "submissionReviews", "mastery", "masteryMatrix", "diagnosticSummary", "recommendations", "learningPlan", "learningSequences", "sequenceSources", "weeklyReport"],
  lessons: ["lessonPlans"], content: ["documents"], members: ["members", "guardianLinks", "invitations"],
  notifications: ["notifications"], consents: ["consents"], audits: ["audits"], quality: ["qualityMetrics"], trials: ["trialEntries"], settings: ["platformSettings", "services"],
};

function initialData(patch: WorkspacePatch): WorkspaceData {
  return {
    classes: [], assignments: [], submissions: [], submissionReviews: [], mastery: [], masteryMatrix: [], learningObjectives: [], diagnosticItems: [],
    diagnosticSummary: null, recommendations: [], learningPlan: [], learningSequences: [], sequenceSources: [], trialEntries: [], enrollments: [],
    documents: [], lessonPlans: [], notifications: [], consents: [], audits: [], invitations: [], members: [], guardianLinks: [], qualityMetrics: null, services: {},
    weeklyReport: { submittedCount: 0, reviewedCount: 0, averageScore: null, masteryAverage: null, pendingRecommendations: 0 },
    workspace: patch.workspace, user: patch.user, availableStudents: patch.availableStudents,
    selectedStudent: patch.selectedStudent, generatedAt: patch.generatedAt,
  };
}

/** 一个登录会话拥有一份快照；不同孩子的数据只能在完整响应后原子切换。 */
export function createWorkspaceStore(reader: Reader = readWorkspace) {
  let snapshot: WorkspaceSnapshot = { data: null, receivedAt: 0 };
  let generation = 0;
  let committedStudent: string | undefined;
  let requestedStudent: string | undefined;
  let requestNumber = 0;
  let metadataNumber = 0;
  const loaded = new Set<WorkspaceSection>();
  const dirty = new Set<WorkspaceSection>();
  const versions = new Map<WorkspaceSection, number>();
  const latestRequests = new Map<WorkspaceSection, number>();
  let switching: Promise<void> | null = null;
  const pending = new Map<string, Promise<void>>();
  const controllers = new Set<AbortController>();
  const listeners = new Set<() => void>();
  const publish = (data: WorkspaceData, updateClock: boolean) => {
    snapshot = { data, receivedAt: updateClock ? performance.now() : snapshot.receivedAt };
    listeners.forEach((listener) => listener());
  };

  function reset() {
    generation++;
    controllers.forEach((controller) => controller.abort()); controllers.clear(); pending.clear();
    loaded.clear(); dirty.clear(); versions.clear(); latestRequests.clear(); switching = null; committedStudent = undefined; requestedStudent = undefined; metadataNumber = 0;
    snapshot = { data: null, receivedAt: 0 };
    listeners.forEach((listener) => listener());
  }

  function invalidate(sections: readonly WorkspaceSection[]) {
    for (const section of sections) { dirty.add(section); versions.set(section, (versions.get(section) ?? 0) + 1); }
  }

  async function load(sections: readonly WorkspaceSection[] = [], options: LoadOptions = {}) {
    // 切换孩子是一笔快照事务，其他局部读取等待它完成，不能先提交新孩子的空页面。
    const waitingGeneration = generation;
    if (switching && (options.studentId === undefined || options.studentId === requestedStudent)) {
      await switching;
      if (waitingGeneration !== generation) return;
    }
    const selected = options.studentId ?? requestedStudent;
    const changingStudent = selected !== requestedStudent;
    if (changingStudent) {
      generation++; requestedStudent = selected;
      controllers.forEach((controller) => controller.abort()); controllers.clear(); pending.clear(); switching = null;
    }
    const token = generation;
    const needsNewContext = selected !== committedStudent && Boolean(snapshot.data);
    // 页面重访和窗口恢复绕过已加载缓存，但仍与等价的在途读取合并。
    const requested = [...new Set(sections)].filter((section) => options.force || options.revalidate || needsNewContext || !loaded.has(section) || dirty.has(section));
    if (snapshot.data && !requested.length && !changingStudent && !options.force) return;
    const key = `${token}:${selected ?? ""}:${options.force ? ++requestNumber : "cached"}:${requested.slice().sort().map((section) => `${section}.${versions.get(section) ?? 0}`).join(",")}`;
    if (pending.has(key)) return pending.get(key);
    const number = ++requestNumber;
    const tickets = new Map(requested.map((section) => [section, versions.get(section) ?? 0]));
    requested.forEach((section) => latestRequests.set(section, number));
    const controller = new AbortController(); controllers.add(controller);
    const operation = (async () => {
      try {
        const patch = await reader(requested, selected, controller.signal);
        if (token !== generation) return;
        // 其他标签页可能切换了共享 Cookie；旧身份的缓存和草稿不能交给新账号或机构。
        if (snapshot.data && (snapshot.data.user.id !== patch.user.id || snapshot.data.workspace.tenantId !== patch.workspace.tenantId)) {
          reset();
          throw new ApiError(401, "session_changed");
        }
        // 每个分组独立判旧，较晚的通知请求不会吞掉并行的课程请求。
        const accepted = requested.filter((section) => (versions.get(section) ?? 0) === tickets.get(section) && latestRequests.get(section) === number);
        // 切换必须提交完整的新孩子快照；写入令在途数据失效时仍保留原孩子。
        if (needsNewContext && accepted.length !== requested.length) throw new Error("工作区数据已更新，请重试切换孩子。");
        if (snapshot.data && requested.length && !accepted.length) return;
        const replacing = Boolean(snapshot.data) && patch.selectedStudent?.id !== committedStudent;
        const current = replacing || !snapshot.data ? initialData(patch) : { ...snapshot.data! };
        if (replacing) { loaded.clear(); dirty.clear(); }
        for (const section of accepted) {
          for (const field of sectionFields[section]) {
            if (Object.hasOwn(patch, field)) Object.assign(current, { [field]: patch[field] });
          }
          loaded.add(section); dirty.delete(section);
        }
        if (number >= metadataNumber) {
          current.workspace = patch.workspace; current.user = patch.user; current.availableStudents = patch.availableStudents;
          current.selectedStudent = patch.selectedStudent;
          metadataNumber = number;
        }
        // 服务端时间与本地接收时间来自同一次响应，避免独立通知读取扰动复测计时。
        const updateClock = accepted.some((section) => section !== "notifications") || !snapshot.data;
        if (updateClock) current.generatedAt = patch.generatedAt;
        requestedStudent = patch.selectedStudent?.id; committedStudent = requestedStudent;
        publish(current, updateClock);
      } catch (error) {
        // reset 已推进 generation，这个主动失效错误仍需到达控制器以退出旧角色视图。
        if (error instanceof ApiError && error.code === "session_changed") throw error;
        if (token !== generation) return;
        if (needsNewContext) { requestedStudent = committedStudent; generation++; }
        throw error;
      }
    })();
    const task = operation.finally(() => {
      controllers.delete(controller);
      if (pending.get(key) === task) pending.delete(key);
      if (switching === task) switching = null;
    });
    pending.set(key, task);
    if (needsNewContext) switching = task;
    return task;
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ready: (sections: readonly WorkspaceSection[]) => Boolean(snapshot.data) && sections.every((section) => loaded.has(section) && !dirty.has(section)),
    loaded: () => [...loaded], reset, invalidate, load,
  };
}
