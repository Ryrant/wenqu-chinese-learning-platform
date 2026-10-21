import { upsertDiagnosticItem, upsertLearningObjective } from "../learning-loop-service";
import { text, requireText, number, type WorkspaceActionHandler } from "./shared";
import type { WorkspaceActionName } from "../workspace-actions";

export const curriculumCommands = {
  upsert_learning_objective: async (body, context) => {
    const { db } = context;
    const result = await upsertLearningObjective(db, context, {
      id: text(body.id, 120) || undefined,
      code: requireText(body.code, "objective_code", 40),
      title: requireText(body.title, "objective_title", 120),
      skill: requireText(body.skill, "objective_skill", 80),
      level: requireText(body.level, "objective_level", 20),
      status: body.status === "inactive" ? "inactive" : "active",
    });
    return Response.json(result, { status: body.id ? 200 : 201 });
  },

  upsert_diagnostic_item: async (body, context) => {
    const { db } = context;
    const options = Array.isArray(body.options) ? body.options.map((value) => text(value, 200)) : [];
    const result = await upsertDiagnosticItem(db, context, {
      id: text(body.id, 120) || undefined,
      objectiveId: requireText(body.objectiveId, "objective_id", 120),
      level: requireText(body.level, "diagnostic_level", 20),
      prompt: requireText(body.prompt, "diagnostic_prompt", 500),
      options,
      correctOption: number(body.correctOption, -1),
      explanation: text(body.explanation, 1000),
      ability: body.ability === undefined ? "reading" : requireText(body.ability, "diagnostic_ability", 20),
      mediaId: text(body.mediaId, 120) || null,
      status: body.status === "inactive" ? "inactive" : "active",
    });
    return Response.json(result, { status: body.id ? 200 : 201 });
  },
} satisfies Partial<Record<WorkspaceActionName, WorkspaceActionHandler>>;
