import { membershipCommands } from "./membership";
import { curriculumCommands } from "./curriculum";
import { teachingCommands } from "./teaching";
import { lessonsCommands } from "./lessons";
import { learningCommands } from "./learning";
import { assessmentCommands } from "./assessment";
import { sequencesCommands } from "./sequences";
import { familyCommands } from "./family";
import { contentCommands } from "./content";
import { notificationsCommands } from "./notifications";
import type { WorkspaceActionName } from "../workspace-actions";
import type { WorkspaceActionHandler } from "./shared";

// 完整类型约束让新增命令必须同时声明角色并注册处理器。
const commands = {
  ...membershipCommands,
  ...curriculumCommands,
  ...teachingCommands,
  ...lessonsCommands,
  ...learningCommands,
  ...assessmentCommands,
  ...sequencesCommands,
  ...familyCommands,
  ...contentCommands,
  ...notificationsCommands,
} satisfies Record<WorkspaceActionName, WorkspaceActionHandler>;

export function resolveWorkspaceAction(action: string): WorkspaceActionHandler | undefined {
  return Object.hasOwn(commands, action) ? commands[action as WorkspaceActionName] : undefined;
}
