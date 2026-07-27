import { spawn } from "node:child_process";

const npmExecPath = process.env.npm_execpath;
const command = npmExecPath ? process.execPath : "npm";
const args = npmExecPath ? [npmExecPath, "run", "build"] : ["run", "build"];

try {
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, WENQU_DEPLOY_TARGET: "standard" },
      shell: !npmExecPath && process.platform === "win32",
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Standard build terminated by signal ${signal}.`));
      else resolve(code ?? 1);
    });
  });
} catch (error) {
  console.error("Unable to run the standard build.", error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
