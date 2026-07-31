import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("workspace actions expose every learning-loop write with explicit roles", async () => {
  const actions = await read("app/api/v1/workspace/actions/route.ts");
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
    assert.match(actions, new RegExp(`${action}: "${role}"`));
    assert.match(actions, new RegExp(`action === "${action}"`));
  }
  assert.match(actions, /action === "update_recommendation_status"/);
  assert.match(actions, /validateRubric/);
  assert.match(actions, /assignment_objectives/);
  assert.match(actions, /objectiveCount/);
  assert.match(actions, /JSON\.parse\(existing\.rubricJson\)/);
});

test("learning-loop service scopes guardian teacher and student operations", async () => {
  const service = await read("app/lib/learning-loop-service.ts");
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
  const assessment = await read("app/lib/assessment-service.ts");
  assert.match(assessment, /updateMasteryEvidence/);
  assert.match(assessment, /review_status!='reviewed'/);
  assert.match(assessment, /submission_already_reviewed/);
  assert.doesNotMatch(assessment, /SELECT s\.tenant_id,s\.student_user_id,ao\.objective_id,\?,1/);
});

test("workspace read model selects a bound child and returns latest mastery only", async () => {
  const workspace = await read("app/api/v1/workspace/route.ts");
  for (const field of [
    "learningObjectives", "diagnosticItems", "diagnosticSummary", "recommendations",
    "availableStudents", "weeklyReport", "masteryMatrix",
    "qualityMetrics", "enrollments",
  ]) assert.match(workspace, new RegExp(`${field}[:,]`));
  assert.match(workspace, /selectedStudent[:,]/);
  assert.match(workspace, /searchParams\.get\("studentId"\)/);
  assert.match(workspace, /assertGuardianStudentAccess/);
  assert.match(workspace, /ROW_NUMBER\(\) OVER/);
  assert.match(workspace, /rn=1/);
  assert.match(workspace, /isRecommendationDue/);
  assert.match(workspace, /weeklyStatsQuery/);
  assert.match(workspace, /PARTITION BY cr\.student_user_id,cr\.scope/);
  assert.match(workspace, /submittedByFocus/);
});
