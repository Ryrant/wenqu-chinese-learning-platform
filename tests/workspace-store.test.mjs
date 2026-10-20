import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../app/features/workspace/workspace-store.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
});
const { createWorkspaceStore } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const resumeBundled = await build({
  entryPoints: [fileURLToPath(new URL("../app/features/workspace/observe-page-resume.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
});
const { observePageResume } = await import(`data:text/javascript;base64,${Buffer.from(resumeBundled.outputFiles[0].text).toString("base64")}`);

function patch(studentId = "child-a", fields = {}) {
  return {
    workspace: { tenantId: "school-a", name: "测试学校", region: "CN" },
    user: { id: "guardian", email: "guardian@example.test", displayName: "监护人", roles: ["guardian"] },
    availableStudents: ["child-a", "child-b", "child-c"].map((id) => ({ id, displayName: id })),
    selectedStudent: studentId ? { id: studentId, displayName: studentId } : null,
    generatedAt: "2026-10-21T00:00:00.000Z", ...fields,
  };
}

function controlledStore() {
  const requests = [];
  const store = createWorkspaceStore((sections, studentId, signal) => new Promise((resolve, reject) => {
    // 故意允许已中止的响应返回，验证快照本身也能拒绝过期结果。
    requests.push({ sections, studentId, signal, resolve, reject });
  }));
  return { store, requests };
}

async function seed(store, requests, sections = [], fields = {}) {
  const reading = store.load(sections);
  requests.at(-1).resolve(patch("child-a", fields));
  await reading;
}

test("workspace reads merge only the requested sections and retain other data", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["teaching"], { classes: [{ id: "class-a" }], assignments: [{ id: "task-a" }], documents: [{ id: "unsolicited" }] });
  assert.deepEqual(store.getSnapshot().data.classes, [{ id: "class-a" }]);
  assert.deepEqual(store.getSnapshot().data.documents, []);
  assert.equal(store.ready(["teaching"]), true);
  assert.equal(store.ready(["content"]), false);

  const content = store.load(["content"]);
  requests.at(-1).resolve(patch("child-a", { documents: [{ id: "source-a" }], classes: [] }));
  await content;
  assert.deepEqual(store.getSnapshot().data.documents, [{ id: "source-a" }]);
  assert.deepEqual(store.getSnapshot().data.classes, [{ id: "class-a" }]);
  assert.equal(store.ready(["teaching", "content"]), true);
});

test("independent concurrent sections both survive reverse response order", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests);
  const teaching = store.load(["teaching"]);
  const teachingRequest = requests.at(-1);
  const notifications = store.load(["notifications"]);
  requests.at(-1).resolve(patch("child-a", { notifications: [{ id: "notice" }], generatedAt: "2026-10-21T00:02:00.000Z" }));
  await notifications;
  assert.equal(store.getSnapshot().data.generatedAt, "2026-10-21T00:00:00.000Z", "notifications must not change the learning snapshot clock");
  teachingRequest.resolve(patch("child-a", { assignments: [{ id: "task" }], generatedAt: "2026-10-21T00:01:00.000Z" }));
  await teaching;
  assert.deepEqual(store.getSnapshot().data.notifications, [{ id: "notice" }]);
  assert.deepEqual(store.getSnapshot().data.assignments, [{ id: "task" }]);
  assert.equal(store.getSnapshot().data.generatedAt, "2026-10-21T00:01:00.000Z");
  assert.equal(store.ready(["notifications", "teaching"]), true);
});

test("a newer response for the same section cannot be overwritten by an older read", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests);
  const oldRead = store.load(["progress"], { force: true });
  const oldRequest = requests.at(-1);
  const newRead = store.load(["progress"], { force: true });
  requests.at(-1).resolve(patch("child-a", { submissions: [{ id: "new-work" }] }));
  await newRead;
  const committed = store.getSnapshot();
  oldRequest.resolve(patch("child-a", { submissions: [{ id: "old-work" }] }));
  await oldRead;
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "new-work" }]);
  assert.equal(store.getSnapshot(), committed);
});

test("overlapping reads keep a valid independent section from the older request", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests);
  const combined = store.load(["teaching", "notifications"]);
  const combinedRequest = requests.at(-1);
  const notices = store.load(["notifications"], { force: true });
  requests.at(-1).resolve(patch("child-a", { notifications: [{ id: "latest-notice" }] }));
  await notices;
  combinedRequest.resolve(patch("child-a", { assignments: [{ id: "task" }], notifications: [{ id: "old-notice" }] }));
  await combined;
  assert.deepEqual(store.getSnapshot().data.assignments, [{ id: "task" }]);
  assert.deepEqual(store.getSnapshot().data.notifications, [{ id: "latest-notice" }]);
});

test("invalidation rejects an in-flight result until a subsequent read completes", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress"], { submissions: [{ id: "saved" }] });
  const stale = store.load(["progress"], { force: true });
  const staleRequest = requests.at(-1);
  store.invalidate(["progress"]);
  staleRequest.resolve(patch("child-a", { submissions: [{ id: "stale" }] }));
  await stale;
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "saved" }]);
  assert.equal(store.ready(["progress"]), false);
  const fresh = store.load(["progress"]);
  requests.at(-1).resolve(patch("child-a", { submissions: [{ id: "fresh" }] }));
  await fresh;
  assert.equal(store.ready(["progress"]), true);
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "fresh" }]);
});

test("equivalent pending reads deduplicate and loaded sections stay cached", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  const first = store.load(["teaching", "content", "teaching"]);
  const second = store.load(["content", "teaching"]);
  assert.equal(requests.length, 1);
  requests[0].resolve(patch("child-a", { classes: [{ id: "class" }], documents: [{ id: "doc" }] }));
  await Promise.all([first, second]);
  await store.load(["content", "teaching"]);
  assert.equal(requests.length, 1);
  const forced = store.load(["content"], { force: true });
  assert.equal(requests.length, 2);
  requests[1].resolve(patch("child-a", { documents: [{ id: "updated" }] }));
  await forced;
  assert.deepEqual(store.getSnapshot().data.documents, [{ id: "updated" }]);
});

test("revisiting a page revalidates its cached groups without rereading unrelated data", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress", "content"], { submissions: [{ id: "previous-work" }], documents: [{ id: "source" }] });
  const returning = store.load(["progress"], { revalidate: true });
  assert.equal(requests.length, 2, "returning to a page must read other sessions' changes");
  assert.deepEqual(requests.at(-1).sections, ["progress"]);
  requests.at(-1).resolve(patch("child-a", { submissions: [{ id: "new-work" }] }));
  await returning;
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "new-work" }]);
  assert.deepEqual(store.getSnapshot().data.documents, [{ id: "source" }]);
});

test("simultaneous revalidation requests share one read and failed reads preserve a retryable snapshot", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress"], { submissions: [{ id: "saved-work" }] });
  const previous = store.getSnapshot();
  const first = store.load(["progress"], { revalidate: true });
  const second = store.load(["progress"], { revalidate: true });
  assert.equal(requests.length, 2, "focus and visibility recovery must share an in-flight read");
  const failures = Promise.all([assert.rejects(first, /unavailable/), assert.rejects(second, /unavailable/)]);
  requests.at(-1).reject(new Error("read unavailable"));
  await failures;
  assert.equal(store.getSnapshot(), previous);
  const retry = store.load(["progress"], { revalidate: true });
  assert.equal(requests.length, 3);
  requests.at(-1).resolve(patch("child-a", { submissions: [{ id: "latest-work" }] }));
  await retry;
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "latest-work" }]);
});

test("window recovery reads only when visible, coalesces paired events and removes listeners", () => {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  documentTarget.visibilityState = "hidden";
  let clock = 0;
  let resumes = 0;
  const stop = observePageResume(() => { resumes++; }, windowTarget, documentTarget, () => clock);
  windowTarget.dispatchEvent(new Event("focus"));
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(resumes, 0, "a background tab must not read hidden pages");
  documentTarget.visibilityState = "visible";
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  windowTarget.dispatchEvent(new Event("focus"));
  assert.equal(resumes, 1, "one foreground transition must not issue two reads");
  clock = 1500;
  windowTarget.dispatchEvent(new Event("focus"));
  assert.equal(resumes, 2, "a later return must revalidate again");
  stop();
  clock = 3000;
  windowTarget.dispatchEvent(new Event("focus"));
  documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(resumes, 2, "unmounted or logged-out pages must not retain recovery listeners");
});

test("rapid child switches publish only the latest complete child snapshot", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress", "teaching"], { submissions: [{ id: "a-work" }], classes: [{ id: "a-class" }] });
  const childB = store.load(["progress", "teaching"], { studentId: "child-b" });
  const requestB = requests.at(-1);
  const childC = store.load(["progress", "teaching"], { studentId: "child-c" });
  const requestC = requests.at(-1);
  assert.equal(requestB.signal.aborted, true);
  assert.equal(store.getSnapshot().data.selectedStudent.id, "child-a");
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "a-work" }]);
  requestC.resolve(patch("child-c", { submissions: [{ id: "c-work" }], classes: [{ id: "c-class" }] }));
  await childC;
  requestB.resolve(patch("child-b", { submissions: [{ id: "b-work" }], classes: [{ id: "b-class" }] }));
  await childB;
  assert.equal(store.getSnapshot().data.selectedStudent.id, "child-c");
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "c-work" }]);
  assert.deepEqual(store.getSnapshot().data.classes, [{ id: "c-class" }]);
});

test("failed child selection keeps the committed child and rolls future reads back", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress"], { submissions: [{ id: "a-work" }] });
  const previous = store.getSnapshot();
  const childB = store.load(["progress"], { studentId: "child-b" });
  const failed = assert.rejects(childB, /read failed/);
  const waiting = assert.rejects(store.load(["notifications"]), /read failed/);
  requests.at(-1).reject(new Error("read failed"));
  await Promise.all([failed, waiting]);
  assert.equal(store.getSnapshot(), previous);
  assert.equal(store.ready(["progress"]), true);
  const refreshed = store.load(["progress"], { force: true });
  assert.equal(requests.at(-1).studentId, "child-a");
  requests.at(-1).resolve(patch("child-a", { submissions: [{ id: "a-refreshed" }] }));
  await refreshed;
  assert.equal(store.getSnapshot().data.selectedStudent.id, "child-a");
});

test("reset aborts invalidated reads and prevents their late responses from restoring the session", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress"], { submissions: [{ id: "a-work" }] });
  const stale = store.load(["progress"], { revalidate: true });
  const oldRequest = requests.at(-1);
  store.invalidate(["progress"]);
  store.reset();
  assert.equal(oldRequest.signal.aborted, true);
  assert.deepEqual(store.getSnapshot(), { data: null, receivedAt: 0 });
  assert.equal(store.ready(["progress"]), false);
  const newSession = store.load(["teaching"]);
  requests.at(-1).resolve(patch(null, { user: { id: "admin", roles: ["admin"] }, classes: [{ id: "new-session" }] }));
  await newSession;
  oldRequest.resolve(patch("child-a", { submissions: [{ id: "old-session" }] }));
  await stale;
  assert.equal(store.getSnapshot().data.user.id, "admin");
  assert.deepEqual(store.getSnapshot().data.classes, [{ id: "new-session" }]);
  assert.deepEqual(store.getSnapshot().data.submissions, []);
});

test("account or tenant changes clear the previous identity's cache and reject late reads", { timeout: 5000 }, async () => {
  for (const changed of ["account", "tenant"]) {
    const { store, requests } = controlledStore();
    const previousUser = { id: "teacher-a", email: "a@example.test", displayName: "A", roles: ["teacher"] };
    await seed(store, requests, ["lessons", "progress"], { selectedStudent: null, user: previousUser, lessonPlans: [{ id: "a-private-lesson" }] });
    const oldRead = store.load(["lessons"], { revalidate: true });
    const oldRequest = requests.at(-1);
    const foregroundRead = store.load(["progress"], { revalidate: true });
    const rejected = assert.rejects(foregroundRead, { status: 401, code: "session_changed" });
    requests.at(-1).resolve(patch(null, {
      user: changed === "account" ? { ...previousUser, id: "teacher-b", displayName: "B" } : previousUser,
      workspace: { tenantId: changed === "tenant" ? "school-b" : "school-a", name: "测试学校", region: "CN" },
      submissions: [{ id: "new-identity-work" }],
    }));
    await rejected;
    assert.equal(store.getSnapshot().data, null, "an identity switch must unmount old-role editors rather than merge identities");
    assert.deepEqual(store.loaded(), []);
    assert.equal(oldRequest.signal.aborted, true);
    oldRequest.resolve(patch(null, { user: previousUser, lessonPlans: [{ id: "late-a-lesson" }] }));
    await oldRead;
    assert.equal(store.getSnapshot().data, null, "a late response must not restore the previous identity");
  }
});

test("reset also cancels callers waiting behind a previous child switch", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress"]);
  const switching = store.load(["progress"], { studentId: "child-b" });
  const oldRequest = requests.at(-1);
  const queued = store.load(["notifications"]);
  store.reset();
  oldRequest.resolve(patch("child-b", { submissions: [{ id: "b-work" }] }));
  await switching;
  await Promise.resolve();
  assert.equal(requests.length, 2, "a read from the logged-out context must not restart after reset");
  await queued;
  assert.equal(store.getSnapshot().data, null);
});

test("a synchronously failed reader reports its error and allows a retry", { timeout: 5000 }, async () => {
  let reads = 0;
  const store = createWorkspaceStore(() => {
    if (++reads === 1) throw new Error("reader unavailable");
    return Promise.resolve(patch("child-a", { classes: [{ id: "retry" }] }));
  });
  await assert.rejects(store.load(["teaching"]), /reader unavailable/);
  await store.load(["teaching"]);
  assert.equal(reads, 2);
  assert.deepEqual(store.getSnapshot().data.classes, [{ id: "retry" }]);
});

test("an invalidated child-switch response cannot replace the committed child's snapshot", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress"], { submissions: [{ id: "a-work" }] });
  const reading = store.load(["progress"], { studentId: "child-b" });
  const rejected = assert.rejects(reading, /更新|过期|重试/);
  store.invalidate(["progress"]);
  requests.at(-1).resolve(patch("child-b", { submissions: [{ id: "stale-b-work" }] }));
  await rejected;
  assert.equal(store.getSnapshot().data.selectedStudent.id, "child-a");
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "a-work" }]);
  assert.equal(store.ready(["progress"]), false);
});

test("a failed latest child switch cannot fall back to an earlier in-flight selection", { timeout: 5000 }, async () => {
  const { store, requests } = controlledStore();
  await seed(store, requests, ["progress"], { submissions: [{ id: "a-work" }] });
  const childB = store.load(["progress"], { studentId: "child-b" });
  const requestB = requests.at(-1);
  const failed = assert.rejects(store.load(["progress"], { studentId: "child-c" }), /unavailable/);
  requests.at(-1).reject(new Error("child-c unavailable"));
  await failed;
  requestB.resolve(patch("child-b", { submissions: [{ id: "b-work" }] }));
  await childB;
  assert.equal(store.getSnapshot().data.selectedStudent.id, "child-a");
  assert.deepEqual(store.getSnapshot().data.submissions, [{ id: "a-work" }]);
  const refresh = store.load(["progress"], { force: true });
  assert.equal(requests.at(-1).studentId, "child-a");
  requests.at(-1).resolve(patch("child-a", { submissions: [{ id: "a-refreshed" }] }));
  await refresh;
});
