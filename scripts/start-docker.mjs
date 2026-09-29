import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const databaseUrl = process.env.DATABASE_URL ?? "file:/data/huawen-zhixing.db";
const uploadDir = process.env.UPLOAD_DIR ?? "/data/uploads";

if (!databaseUrl.startsWith("file:")) {
  console.error("invalid_database_url");
  process.exit(1);
}

const databasePath = databaseUrl.slice("file:".length);
if (!databasePath) {
  console.error("invalid_database_url");
  process.exit(1);
}

const databaseDir = dirname(resolve(databasePath));
await mkdir(databaseDir, { recursive: true });
await mkdir(uploadDir, { recursive: true });
await access(databaseDir, constants.W_OK);
await access(uploadDir, constants.W_OK);

const child = spawn(process.execPath, ["./node_modules/vinext/dist/cli.js", "start"], {
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    UPLOAD_DIR: uploadDir,
    HUAWEN_ZHIXING_RUNTIME: "node",
    NODE_ENV: process.env.NODE_ENV ?? "production",
  },
  stdio: "inherit",
});

child.once("exit", (code, signal) => {
  if (signal) {
    console.error("vinext_start_signal", { signal });
    process.exit(1);
  }
  process.exit(code ?? 1);
});
