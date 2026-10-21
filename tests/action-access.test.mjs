import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  stdin: { contents: `
    export { ApiError } from './lib/workspace/api';
    export { workspaceAccessFailure, errorMessage } from './lib/workspace/access-error';
    export { NodeSqliteDatabase } from './lib/platform-runtime-node';
    export { setPlatformRuntime } from './lib/platform-runtime';
    export { ensurePlatformSchema } from './lib/platform-store';
    export { POST as actions } from './app/api/v1/workspace/actions/route';
  `, resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("对象或动作被拒绝时保留会话，仅身份和账号授权失效触发退出", () => {
  assert.equal(api.workspaceAccessFailure(new api.ApiError(403, "forbidden")), null);
  assert.equal(api.workspaceAccessFailure(new api.ApiError(404, "notification_not_found")), null);
  assert.equal(api.workspaceAccessFailure(new api.ApiError(409, "enrollment_conflict")), null);
  assert.equal(api.workspaceAccessFailure(new api.ApiError(401, "authentication_required")), "signed-out");
  assert.equal(api.workspaceAccessFailure(new api.ApiError(403, "session_changed")), "signed-out");
  assert.equal(api.workspaceAccessFailure(new api.ApiError(403, "account_access_denied")), "account-denied");
  assert.equal(api.workspaceAccessFailure(new api.ApiError(403, "password_change_required")), "password-change");
  assert.notEqual(api.errorMessage(new api.ApiError(403, "forbidden")), api.errorMessage(new api.ApiError(403, "account_access_denied")));
});

test("所有已授权角色可标记自己的通知，不能标记其他账号或机构的通知", async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: null });
  t.after(() => {
    db.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  });
  await api.ensurePlatformSchema(db);
  const roles = ["admin", "teacher", "guardian", "student"];
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','测试学校'),('other-school','另一学校')"),
    ...roles.flatMap((role) => [
      db.prepare("INSERT INTO users(id,email,display_name) VALUES (?,?,?)").bind(role, `${role}@example.test`, role),
      db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role,status) VALUES ('school',?,?,'active')").bind(role, role),
      db.prepare("INSERT INTO notifications(id,tenant_id,user_id,title,detail) VALUES (?,'school',?,'通知','测试通知')").bind(`notice-${role}`, role),
    ]),
    db.prepare("INSERT INTO notifications(id,tenant_id,user_id,title,detail) VALUES ('foreign-notice','other-school','teacher','其他机构通知','测试通知')"),
  ]);
  const mark = (role, id) => api.actions(new Request("http://127.0.0.1/api/v1/workspace/actions", {
    method: "POST", headers: { "content-type": "application/json", "x-huawen-zhixing-dev-user": `${role}@example.test` },
    body: JSON.stringify({ action: "mark_notification", id }),
  }));
  for (const role of roles) {
    const response = await mark(role, `notice-${role}`);
    assert.equal(response.status, 200, `${role}: ${await response.text()}`);
    assert.ok((await db.prepare("SELECT read_at FROM notifications WHERE id=?").bind(`notice-${role}`).first()).read_at);
  }
  await db.prepare("UPDATE notifications SET read_at=NULL").run();
  for (const id of ["notice-student", "foreign-notice", "missing-notice"]) {
    const response = await mark("teacher", id);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "notification_not_found" });
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE read_at IS NOT NULL").first()).count, 0);
});
