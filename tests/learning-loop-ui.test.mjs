import { readRoleSources, readSourceDirectory, readWorkspaceClientSources } from "./helpers/source-files.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("student workspace exposes diagnostic plan and review actions", async () => {
  const [student, views] = await Promise.all([
    readRoleSources("student"),
    readSourceDirectory("components"),
  ]);
  const source = `${student}\n${views}`;
  assert.match(source, /submit_diagnostic/);
  assert.match(source, /answer_review_item/);
  assert.match(source, /selectedLevel/);
  assert.match(source, /isRecommendationDue/);
  assert.match(source, /update_recommendation_status/);
});

test("teacher workspace exposes rubric heatmap and intervention actions", async () => {
  const [staff, views] = await Promise.all([
    readRoleSources("teacher", "guardian", "admin"),
    readSourceDirectory("components"),
  ]);
  const source = `${staff}\n${views}`;
  assert.match(source, /objectiveIds/);
  assert.match(source, /rubric/);
  assert.match(source, /create_intervention/);
  assert.match(staff, /data\.masteryMatrix\.reduce/);
});

test("guardian workspace exposes child switching weekly report and family tasks", async () => {
  const [dashboard, staff, views] = await Promise.all([
    readWorkspaceClientSources(),
    readRoleSources("teacher", "guardian", "admin"),
    readSourceDirectory("components"),
  ]);
  const source = `${dashboard}\n${staff}\n${views}`;
  assert.match(source, /studentId/);
  assert.match(source, /create_family_task/);
  assert.match(source, /selectedStudent/);
});

test("admin workspace exposes objectives enrollment and real quality metrics", async () => {
  const [staff, views] = await Promise.all([
    readRoleSources("teacher", "guardian", "admin"),
    readSourceDirectory("components"),
  ]);
  const source = `${staff}\n${views}`;
  assert.match(source, /upsert_learning_objective/);
  assert.match(source, /upsert_diagnostic_item/);
  assert.match(source, /set_class_enrollments/);
  assert.match(source, /qualityMetrics/);
});

test("documentation explains the four-end learning workflow and safeguards", async () => {
  const readme = await read("README.md");
  for (const phrase of [
    "机构配置 → 教师发布 → 学生学习 → 家长查看",
    "自适应学习闭环",
    "诊断数据",
    "监护绑定",
    "内容权属",
  ]) assert.match(readme, new RegExp(phrase));
});
