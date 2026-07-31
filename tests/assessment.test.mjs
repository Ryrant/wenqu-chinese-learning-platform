import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("assessment service separates ai suggestion from final teacher confirmation", async () => {
  const [service, actions, staff, student] = await Promise.all([
    read("app/lib/assessment-service.ts"),
    read("app/api/v1/workspace/actions/route.ts"),
    read("app/staff-views.tsx"),
    read("app/student-view.tsx"),
  ]);
  assert.match(service, /export async function suggestTextReview/);
  assert.match(service, /export async function confirmSubmissionReview/);
  assert.match(service, /ai_suggested/);
  assert.match(service, /confirmed/);
  assert.match(service, /updateMasteryEvidence/);
  assert.match(actions, /suggest_text_review/);
  assert.match(actions, /no_reviewed_sources/);
  assert.match(actions, /status: 422/);
  assert.match(actions, /confirm_submission_review/);
  assert.match(staff, /AI 建议/);
  assert.doesNotMatch(student, /ai_comment|aiSuggestedScore/);
});
