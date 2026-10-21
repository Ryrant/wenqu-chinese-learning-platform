import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../lib/workspace/enrollment-draft.ts", import.meta.url))],
  bundle: true, format: "esm", platform: "node", target: "node22", write: false,
});
const { enrollmentDraftView } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("未编辑的编班页返回时采用最新完整名单，不能停用其他会话新增的学生", () => {
  assert.deepEqual(enrollmentDraftView("class", ["student-a"], null).studentUserIds, ["student-a"]);
  const view = enrollmentDraftView("class", ["student-a", "student-b"], null);
  assert.deepEqual(view.studentUserIds, ["student-a", "student-b"]);
  assert.deepEqual(view.expectedStudentUserIds, ["student-a", "student-b"]);
  assert.equal(view.conflict, false);
});

test("编辑中的完整名单保留草稿与提交基线，其他会话的改动必须产生冲突", () => {
  const draft = { classId: "class", baseIds: ["student-a"], studentUserIds: [] };
  const unchanged = enrollmentDraftView("class", ["student-a"], draft);
  assert.equal(unchanged.dirty, true);
  assert.equal(unchanged.conflict, false);
  const changed = enrollmentDraftView("class", ["student-a", "student-b"], draft);
  assert.equal(changed.conflict, true);
  assert.deepEqual(changed.studentUserIds, [], "不静默丢弃用户正在编辑的草稿");
  assert.deepEqual(changed.expectedStudentUserIds, ["student-a"], "不把未确认的服务端变化升级为提交基线");
  const adopted = enrollmentDraftView("class", ["student-a", "student-b"], null);
  assert.equal(adopted.conflict, false);
  assert.deepEqual(adopted.studentUserIds, ["student-a", "student-b"]);
});

test("保存后的服务端确认以及撤销全部本地编辑均释放旧基线", () => {
  const saved = enrollmentDraftView("class", ["student-a", "student-b"], {
    classId: "class", baseIds: ["student-a"], studentUserIds: ["student-b", "student-a"],
  });
  assert.equal(saved.dirty, false);
  assert.equal(saved.conflict, false);
  assert.deepEqual(saved.expectedStudentUserIds, ["student-a", "student-b"]);
  const reverted = enrollmentDraftView("class", ["student-a", "student-b"], {
    classId: "class", baseIds: ["student-a"], studentUserIds: ["student-a"],
  });
  assert.equal(reverted.dirty, false);
  assert.deepEqual(reverted.studentUserIds, ["student-a", "student-b"]);
});

test("不同班级的草稿不能成为当前班级的选择或提交基线", () => {
  const view = enrollmentDraftView("other-class", ["student-c"], {
    classId: "class", baseIds: ["student-a"], studentUserIds: ["student-b"],
  });
  assert.deepEqual(view.studentUserIds, ["student-c"]);
  assert.deepEqual(view.expectedStudentUserIds, ["student-c"]);
  assert.equal(view.conflict, false);
});
