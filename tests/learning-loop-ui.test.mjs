import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("student workspace exposes diagnostic plan and review actions", async () => {
  const [student, views] = await Promise.all([
    read("app/student-view.tsx"),
    read("app/learning-loop-views.tsx").catch(() => ""),
  ]);
  const source = `${student}\n${views}`;
  for (const label of ["客观题入学诊断", "今日学习计划", "错题复习中心"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /submit_diagnostic/);
  assert.match(source, /answer_review_item/);
  assert.match(source, /最多显示 3 项/);
});

test("teacher workspace exposes rubric heatmap and intervention actions", async () => {
  const [staff, views] = await Promise.all([
    read("app/staff-views.tsx"),
    read("app/learning-loop-views.tsx").catch(() => ""),
  ]);
  const source = `${staff}\n${views}`;
  for (const label of ["目标与评分量规任务", "班级学情热力图", "学生分层干预"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /objectiveIds/);
  assert.match(source, /rubric/);
  assert.match(source, /create_intervention/);
});

test("guardian workspace exposes child switching weekly report and family tasks", async () => {
  const [dashboard, staff, views] = await Promise.all([
    read("app/dashboard.tsx"),
    read("app/staff-views.tsx"),
    read("app/learning-loop-views.tsx").catch(() => ""),
  ]);
  const source = `${dashboard}\n${staff}\n${views}`;
  for (const label of ["多孩子切换", "本周成长报告", "亲子家庭任务"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /studentId=/);
  assert.match(source, /create_family_task/);
  assert.match(source, /selectedStudent/);
});

test("admin workspace exposes objectives enrollment and real quality metrics", async () => {
  const [staff, views] = await Promise.all([
    read("app/staff-views.tsx"),
    read("app/learning-loop-views.tsx").catch(() => ""),
  ]);
  const source = `${staff}\n${views}`;
  for (const label of ["课程目标与诊断题库", "班级编班", "教学质量看板"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /upsert_learning_objective/);
  assert.match(source, /upsert_diagnostic_item/);
  assert.match(source, /set_class_enrollments/);
  assert.match(source, /qualityMetrics/);
});

test("learning-loop cards expose empty states and mobile layout", async () => {
  const [views, css] = await Promise.all([
    read("app/learning-loop-views.tsx").catch(() => ""),
    read("app/globals.css"),
  ]);
  assert.match(views, /empty-state/);
  assert.match(views, /loop-grid/);
  assert.match(css, /@media\(max-width:600px\)/);
  assert.match(css, /\.loop-grid/);
  assert.match(css, /\.heatmap/);
});
