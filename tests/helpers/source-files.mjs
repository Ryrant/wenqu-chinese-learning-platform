import { readFile, readdir } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
export const readSource = (path) => readFile(new URL(path, root), "utf8");
export const readSources = async (paths) => (await Promise.all(paths.map(readSource))).join("\n");

/** 合同检查按模块集合读取，避免把业务约束绑在某个聚合文件的位置上。 */
export async function readSourceDirectory(path) {
  const entries = await readdir(new URL(`${path}/`, root), { withFileTypes: true });
  return (await Promise.all(entries.toSorted((a, b) => a.name.localeCompare(b.name)).map((entry) => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? readSourceDirectory(child) : /\.tsx?$/.test(entry.name) ? readSource(child) : "";
  }))).join("\n");
}

export const readWorkspaceSources = () => readSources(["app/api/v1/workspace/route.ts", "lib/workspace-service.ts"]);
export const readCommandSources = async () => [await readSource("app/api/v1/workspace/actions/route.ts"), await readSource("lib/workspace-actions.ts"), await readSourceDirectory("lib/commands")].join("\n");
export const readRoleSources = (...roles) => Promise.all(roles.map((role) => readSourceDirectory(`components/${role}`))).then((parts) => parts.join("\n"));
export const readWorkspaceClientSources = async () => [await readSource("components/workspace/dashboard.tsx"), await readSourceDirectory("hooks"), await readSourceDirectory("lib/workspace")].join("\n");
