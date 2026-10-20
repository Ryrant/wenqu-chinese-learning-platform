import { readCommandSources } from "./helpers/source-files.mjs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const registryBundle = await build({
  stdin: { contents: `export { workspaceActionRoles } from './lib/workspace-actions'; export { resolveWorkspaceAction } from './lib/commands';`, resolveDir: fileURLToPath(root) },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const registry = await import(`data:text/javascript;base64,${Buffer.from(registryBundle.outputFiles[0].text).toString("base64")}`);

test("workspace command registry resolves supported operations with explicit role requirements", async () => {
  const actions = await readCommandSources();
  const expected = {
    submit_diagnostic: "student",
    answer_review_item: "student",
    create_intervention: "teacher",
    create_family_task: "guardian",
    upsert_learning_objective: "admin",
    upsert_diagnostic_item: "admin",
    set_class_enrollments: "admin",
  };
  for (const [action, role] of Object.entries(expected)) {
    assert.equal(registry.workspaceActionRoles[action], role);
    assert.equal(typeof registry.resolveWorkspaceAction(action), "function");
  }
  for (const name of Object.keys(registry.workspaceActionRoles)) assert.equal(typeof registry.resolveWorkspaceAction(name), "function", name);
  for (const name of ["unsupported", "constructor", "__proto__"]) assert.equal(registry.resolveWorkspaceAction(name), undefined);
  assert.match(actions, /validateRubric/);
  assert.match(actions, /assignment_objectives/);
  assert.match(actions, /objectiveCount/);
  assert.match(actions, /JSON\.parse\(existing\.rubricJson\)/);
});

test("learning-loop service scopes guardian teacher and student operations", async () => {
  const service = await read("lib/learning-loop-service.ts");
  assert.match(service, /assertGuardianStudentAccess/);
  assert.match(service, /guardian_student_links/);
  assert.match(service, /guardian_user_id=\?/);
  assert.match(service, /assertTeacherStudentAccess/);
  assert.match(service, /teacher_user_id=\?/);
  assert.match(service, /student_user_id=\?/);
  assert.match(service, /tenant_id=\?/);
  assert.match(service, /updateMasteryEvidence/);
  assert.match(service, /blendMastery/);
  assert.match(service, /learning_recommendations/);
  assert.match(service, /isRecommendationDue/);
  assert.match(service, /row\.sourceType !== "diagnostic"/);
});

test("teacher-confirmed review reuses cumulative mastery update service", async () => {
  const assessment = await read("lib/assessment-service.ts");
  assert.match(assessment, /prepareMasteryEvidenceInsert/);
  assert.match(assessment, /review_status!='reviewed'/);
  assert.match(assessment, /submission_already_reviewed/);
  assert.match(assessment, /submission_review_confirmations/);
  assert.match(assessment, /db\.batch/);
  assert.match(assessment, /submission\.reviewStatus === "reviewed"/);
  assert.doesNotMatch(assessment, /SELECT s\.tenant_id,s\.student_user_id,ao\.objective_id,\?,1/);
});
