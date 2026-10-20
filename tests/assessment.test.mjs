import { readCommandSources, readRoleSources } from "./helpers/source-files.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("assessment service separates ai suggestion from final teacher confirmation", async () => {
  const [service, actions, staff, review, student] = await Promise.all([
    read("lib/assessment-service.ts"),
    readCommandSources(),
    readRoleSources("teacher", "guardian", "admin"),
    read("components/teacher/submission-review.tsx"),
    readRoleSources("student"),
  ]);
  assert.match(service, /export async function suggestTextReview/);
  assert.match(service, /export async function confirmSubmissionReview/);
  assert.match(service, /ai_suggested/);
  assert.match(service, /confirmed/);
  assert.match(service, /prepareMasteryEvidenceInsert/);
  assert.match(service, /submission_review_confirmations/);
  assert.match(actions, /suggest_text_review/);
  assert.match(actions, /no_reviewed_sources/);
  assert.match(actions, /status: 422/);
  assert.match(actions, /confirm_submission_review/);
  assert.match(staff, /<SubmissionReview\b/);
  assert.match(review, /act\("suggest_text_review"/);
  assert.match(review, /act\("confirm_submission_review"/);
  assert.match(review, /onSubmit=\{confirm\}/);
  assert.doesNotMatch(student, /ai_comment|aiSuggestedScore/);
});
