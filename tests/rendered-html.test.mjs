import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const execFileAsync = promisify(execFile);

test("pilot readiness schema includes account content and assessment state", async () => {
  const [schema, migration, store] = await Promise.all([
    read("db/schema.ts"),
    read("drizzle/0002_pilot_school_readiness.sql"),
    read("app/lib/platform-store.ts"),
  ]);
  assert.match(schema, /passwordHash: text\("password_hash"\)/);
  assert.match(schema, /mustChangePassword: integer\("must_change_password"/);
  assert.match(schema, /submissionReviews/);
  assert.match(schema, /assignmentObjectives/);
  assert.match(schema, /processingError: text\("processing_error"\)/);
  assert.match(migration, /ALTER TABLE `users` ADD `password_hash` text/);
  assert.match(migration, /CREATE TABLE `submission_reviews`/);
  assert.match(store, /CREATE TABLE IF NOT EXISTS submission_reviews/);
});

test("all four role workspaces expose real operations instead of timer shells", async () => {
  const [dashboard, student, staff] = await Promise.all([read("app/dashboard.tsx"), read("app/student-view.tsx"), read("app/staff-views.tsx")]);
  assert.match(dashboard, /student.*teacher.*guardian.*admin/s);
  assert.match(dashboard, /\/api\/v1\/workspace/);
  assert.match(student, /MediaRecorder/);
  assert.match(student, /\/api\/v1\/speech\/submissions/);
  assert.match(student, /submit_text/);
  assert.match(staff, /generate_lesson/);
  assert.match(staff, /create_class/);
  assert.match(staff, /create_invitation/);
  assert.match(staff, /review_content/);
  assert.doesNotMatch(`${student}\n${staff}`, /setTimeout\([^)]*92|setScore\(92|主服务商 A|全部正常/);
});

test("defines tenant-scoped durable data, migrations and production bindings", async () => {
  const [schema, firstMigration, secondMigration, hosting, store] = await Promise.all([
    read("db/schema.ts"), read("drizzle/0000_dusty_mesmero.sql"), read("drizzle/0001_condemned_lester.sql"), read(".openai/hosting.json"), read("app/lib/platform-store.ts"),
  ]);
  assert.match(schema, /tenantId: text\("tenant_id"\)/);
  assert.match(schema, /lessonPlans/);
  assert.match(schema, /notifications/);
  assert.match(schema, /invitations/);
  assert.equal((`${firstMigration}\n${secondMigration}`.match(/CREATE TABLE/g) ?? []).length, 21);
  const bindings = JSON.parse(hosting);
  assert.equal(bindings.d1, "DB"); assert.equal(bindings.r2, "CONTENT"); assert.ok(bindings.project_id);
  assert.match(store, /oai-authenticated-user-email/);
  assert.match(store, /requiredRole/);
  assert.doesNotMatch(store, /demo-admin|tenantId = "demo/);
});

test("versioned APIs enforce tenant scope, honest provider state and review fallbacks", async () => {
  const [generate, search, upload, speech, actions, health, contentProcessing] = await Promise.all([
    read("app/api/v1/ai/generate/route.ts"), read("app/api/v1/knowledge/search/route.ts"), read("app/api/v1/content/upload/route.ts"), read("app/api/v1/speech/submissions/route.ts"), read("app/api/v1/workspace/actions/route.ts"), read("app/api/v1/health/route.ts"), read("app/lib/content-processing.ts"),
  ]);
  assert.match(generate, /text\/event-stream/); assert.match(generate, /generateGroundedText/); assert.match(generate, /citations/);
  assert.match(search, /tenant_id=\?/); assert.match(search, /processing_status='published'/);
  assert.match(upload, /bucket\.put/); assert.match(upload, /rightsStatus/);
  assert.match(upload, /source\.processed/); assert.match(upload, /processing_error/);
  assert.match(speech, /human_review/); assert.match(speech, /R2Bucket|CONTENT/);
  assert.match(actions, /WHERE id=\? AND tenant_id=\?/); assert.match(actions, /audit_logs/);
  assert.match(contentProcessing, /knowledge_chunks SET published=1/); assert.match(contentProcessing, /processing_status='processed'/);
  assert.match(actions, /invalid_content_review_status/);
  assert.match(actions, /body\.status !== "published" && body\.status !== "rejected"/);
  assert.match(actions, /await publishContent\(db, \{ tenantId, sourceDocumentId: id \}\)/);
  assert.match(actions, /await db\.batch\(\[/);
  assert.match(health, /not_configured_manual_review/); assert.doesNotMatch(health, /99\.9|healthy/);
  await access(new URL("dist/server/index.js", root));
});

test("standard auth token helpers use Web Crypto without new dependencies", async () => {
  const token = await read("app/lib/auth-token.ts");
  const pkg = JSON.parse(await read("package.json"));
  assert.match(token, /export type StandardSession/);
  assert.match(token, /export const sessionCookieName = "wenqu_session"/);
  assert.match(token, /export async function createSessionToken/);
  assert.match(token, /export async function verifySessionToken/);
  assert.match(token, /crypto\.subtle\.sign/);
  assert.match(token, /crypto\.subtle\.verify/);
  assert.match(token, /try \{[\s\S]*base64UrlDecode\(signature\)[\s\S]*crypto\.subtle\.verify[\s\S]*\} catch \{[\s\S]*return null;/);
  assert.doesNotMatch(JSON.stringify(pkg.dependencies), /jose|jsonwebtoken/);
});

test("platform identity supports chatgpt standard and local auth modes", async () => {
  const store = await read("app/lib/platform-store.ts");
  const envTypes = await read("cloudflare-env.d.ts");
  assert.match(store, /export type AuthMode = "chatgpt" \| "standard" \| "local"/);
  assert.match(store, /export function getAuthMode\(\): AuthMode/);
  assert.match(store, /AUTH_MODE/);
  assert.match(store, /oai-authenticated-user-email/);
  assert.match(store, /verifySessionToken/);
  assert.match(store, /Authorization/);
  assert.match(store, /wenqu_session/);
  assert.match(envTypes, /AUTH_MODE\?: "chatgpt" \| "standard" \| "local"/);
  assert.match(envTypes, /ADMIN_EMAIL\?: string/);
  assert.match(envTypes, /JWT_SECRET\?: string/);
});

test("standard auth API exposes login logout and session endpoints", async () => {
  const [login, logout, session] = await Promise.all([
    read("app/api/v1/auth/login/route.ts"),
    read("app/api/v1/auth/logout/route.ts"),
    read("app/api/v1/auth/session/route.ts"),
  ]);
  assert.match(login, /ADMIN_EMAIL/);
  assert.match(login, /ADMIN_PASSWORD/);
  assert.match(login, /JWT_SECRET/);
  assert.match(login, /createSessionToken/);
  assert.match(login, /HttpOnly/);
  assert.match(login, /SameSite=Lax/);
  assert.doesNotMatch(login, /console\.log\([^)]*password|console\.error\([^)]*password/);
  assert.match(logout, /Max-Age=0/);
  assert.match(session, /getAuthMode/);
  assert.match(session, /platformContext/);
});

test("dashboard exposes standard mode login and logout flow", async () => {
  const [dashboard, css] = await Promise.all([read("app/dashboard.tsx"), read("app/globals.css")]);
  assert.match(dashboard, /authMode/);
  assert.match(dashboard, /\/api\/v1\/auth\/session/);
  assert.match(dashboard, /\/api\/v1\/auth\/login/);
  assert.match(dashboard, /\/api\/v1\/auth\/logout/);
  assert.match(dashboard, /type="password"/);
  assert.match(dashboard, /标准 Cloudflare 登录/);
  assert.match(css, /\.login-card/);
  assert.match(css, /\.logout-button/);
});

test("dashboard detects authenticated standard sessions and preserves the workspace on logout failure", async () => {
  const dashboard = await read("app/dashboard.tsx");
  assert.match(dashboard, /setData\(next\);\s*void loadAuthMode\(\)\.catch\(\(\) => null\)/);
  assert.match(dashboard, /const response = await fetch\("\/api\/v1\/auth\/logout", \{ method: "POST" \}\);/);
  assert.match(dashboard, /if \(!response\.ok\) throw new Error\("退出登录失败"\);/);
  assert.match(dashboard, /notify\("退出失败", reason instanceof Error \? reason\.message : "退出登录失败", "error"\);/);
});

test("standard and ChatGPT builds select separate Wrangler configurations", async () => {
  const [standardWrangler, chatGptWrangler, pkgRaw, vite] = await Promise.all([
    read("wrangler.toml"),
    read("wrangler.chatgpt.toml"),
    read("package.json"),
    read("vite.config.ts"),
  ]);
  const pkg = JSON.parse(pkgRaw);
  assert.equal(pkg.scripts["build:standard"], "node scripts/build-standard.mjs");
  assert.equal(pkg.scripts["cf:preview"], "npm run build:standard && npx wrangler dev");
  assert.equal(pkg.scripts["cf:deploy"], "npm run build:standard && npx wrangler deploy");
  assert.match(vite, /WENQU_DEPLOY_TARGET/);
  assert.match(vite, /\.\/wrangler\.chatgpt\.toml/);
  assert.match(vite, /\.\/wrangler\.toml/);
  assert.match(standardWrangler, /AUTH_MODE = "standard"/);
  assert.match(chatGptWrangler, /binding = "DB"/);
  assert.match(chatGptWrangler, /binding = "CONTENT"/);
  assert.doesNotMatch(chatGptWrangler, /AUTH_MODE\s*=\s*"standard"/);
});

test("CI is lightweight and default deployment workflow is not committed", async () => {
  const [ciWorkflow, renderScript] = await Promise.all([
    read(".github/workflows/ci.yml"),
    read("scripts/render-wrangler-config.mjs"),
  ]);
  await assert.rejects(read(".github/workflows/deploy.yml"));
  assert.match(renderScript, /D1_DATABASE_ID/);
  assert.match(renderScript, /R2_BUCKET_NAME/);
  assert.match(renderScript, /ADMIN_EMAIL/);
  assert.match(ciWorkflow, /^name: CI/m);
  assert.match(ciWorkflow, /permissions:\s*\n\s*contents: read/);
  assert.match(ciWorkflow, /pull_request:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(ciWorkflow, /push:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(ciWorkflow, /workflow_dispatch:/);
  assert.match(ciWorkflow, /cancel-in-progress: true/);
  assert.match(ciWorkflow, /timeout-minutes: 10/);
  assert.match(ciWorkflow, /npm ci/);
  assert.match(ciWorkflow, /npm run lint/);
  assert.match(ciWorkflow, /npm test/);
  assert.doesNotMatch(ciWorkflow, /wrangler-action|CLOUDFLARE_API_TOKEN|ADMIN_PASSWORD|JWT_SECRET/);
});

test("Wrangler renderer rejects placeholders and writes controlled CI values without logging secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wenqu-wrangler-"));
  try {
    await writeFile(join(directory, "wrangler.toml"), await read("wrangler.toml"), "utf8");
    const script = fileURLToPath(new URL("../scripts/render-wrangler-config.mjs", import.meta.url));
    await assert.rejects(execFileAsync(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        D1_DATABASE_ID: "00000000-0000-4000-8000-000000000000",
        R2_BUCKET_NAME: "replace-with-r2-bucket-name",
        ADMIN_EMAIL: "admin@example.com",
      },
    }));

    const secretFixture = "must-not-appear-in-output";
    const { stdout, stderr } = await execFileAsync(process.execPath, [script], {
      cwd: directory,
      env: {
        ...process.env,
        D1_DATABASE_ID: "12345678-1234-4abc-8def-1234567890ab",
        R2_BUCKET_NAME: "wenqu-platform-content",
        ADMIN_EMAIL: "admin@wenqu.test",
        ADMIN_PASSWORD: secretFixture,
        JWT_SECRET: secretFixture,
      },
    });
    const rendered = await readFile(join(directory, "wrangler.toml"), "utf8");
    assert.match(rendered, /database_id = "12345678-1234-4abc-8def-1234567890ab"/);
    assert.match(rendered, /bucket_name = "wenqu-platform-content"/);
    assert.match(rendered, /ADMIN_EMAIL = "admin@wenqu.test"/);
    assert.doesNotMatch(`${stdout}\n${stderr}`, new RegExp(secretFixture));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("standard build launcher delegates through the active npm CLI with the standard target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wenqu-build-standard-"));
  try {
    const outputPath = join(directory, "invocation.json");
    const npmCliPath = join(directory, "fake-npm.mjs");
    await writeFile(npmCliPath, `
      import { writeFile } from "node:fs/promises";
      await writeFile(process.env.WENQU_TEST_OUTPUT, JSON.stringify({
        args: process.argv.slice(2),
        target: process.env.WENQU_DEPLOY_TARGET,
      }));
    `, "utf8");
    const script = fileURLToPath(new URL("../scripts/build-standard.mjs", import.meta.url));
    await execFileAsync(process.execPath, [script], {
      env: {
        ...process.env,
        npm_execpath: npmCliPath,
        WENQU_TEST_OUTPUT: outputPath,
      },
    });
    const invocation = JSON.parse(await readFile(outputPath, "utf8"));
    assert.deepEqual(invocation, { args: ["run", "build"], target: "standard" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("standard cloudflare deployment configuration is documented and secret-safe", async () => {
  const [standardWrangler, envExample, agents] = await Promise.all([
    read("wrangler.toml"),
    read(".env.example"),
    read("AGENTS.md"),
  ]);
  assert.match(standardWrangler, /main = "worker\/index\.ts"/);
  assert.match(standardWrangler, /binding = "DB"/);
  assert.match(standardWrangler, /binding = "CONTENT"/);
  assert.match(standardWrangler, /required = \["ADMIN_PASSWORD", "JWT_SECRET"\]/);
  assert.doesNotMatch(standardWrangler, /ADMIN_PASSWORD =|JWT_SECRET =|CLOUDFLARE_API_TOKEN/);
  assert.match(envExample, /AUTH_MODE=standard/);
  assert.match(envExample, /JWT_SECRET=/);
  assert.match(envExample, /D1_DATABASE_ID/);
  assert.match(envExample, /R2_BUCKET_NAME/);
  assert.doesNotMatch(envExample, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(envExample, /sk-|eyJ|-----BEGIN|password123/);
  assert.match(agents, /feature 分支/);
  assert.match(agents, /PR/);
  assert.match(agents, /README 维护规则/);
  assert.match(agents, /优先移动原文/);
  assert.match(agents, /快速开始.*Cloudflare 自托管.*一键部署/s);
  assert.match(agents, /使用说明.*平台内部功能使用说明/s);
  assert.match(agents, /本地开发.*clone.*依赖安装.*dev server/s);
  assert.match(agents, /demo 阶段/);
  assert.match(agents, /AUTH_MODE=standard/);
  assert.match(agents, /WAF Rate Limiting|Cloudflare Access/);
  assert.match(agents, /\.github\/workflows\/ci\.yml.*必要校验/s);
  assert.match(agents, /不维护默认 GitHub Actions 自动部署 workflow/);
  assert.match(agents, /\/api\/v1\/auth\/login/);
});

test("login has best-effort throttling and malformed cookies fail closed", async () => {
  const [login, store] = await Promise.all([
    read("app/api/v1/auth/login/route.ts"),
    read("app/lib/platform-store.ts"),
  ]);
  assert.match(login, /429/);
  assert.match(login, /Retry-After/i);
  assert.match(login, /CF-Connecting-IP/i);
  assert.match(login, /loginAttempts/);
  assert.match(store, /try \{[\s\S]*decodeURIComponent[\s\S]*\} catch \{[\s\S]*return "";/);
});

test("standard login uses account password hashes and change-password gate", async () => {
  const [login, session, changePassword, passwordChange, passwordChangeState, workspace, store, standardLogin, envTypes] = await Promise.all([
    read("app/api/v1/auth/login/route.ts"),
    read("app/api/v1/auth/session/route.ts"),
    read("app/api/v1/auth/change-password/route.ts"),
    read("app/lib/password-change.ts"),
    read("app/lib/password-change-state.ts"),
    read("app/api/v1/workspace/route.ts"),
    read("app/lib/platform-store.ts"),
    read("app/lib/standard-login.ts"),
    read("cloudflare-env.d.ts"),
  ]);
  assert.match(login, /authenticateStandardAccount/);
  assert.match(standardLogin, /verifyPassword/);
  assert.match(standardLogin, /must_change_password AS mustChangePassword/);
  assert.match(standardLogin, /u\.status AS status/);
  assert.doesNotMatch(login, /password !== bindings\.ADMIN_PASSWORD/);
  assert.match(session, /sessionPasswordChangeState/);
  assert.match(passwordChangeState, /mustChangePassword/);
  assert.match(changePassword, /changeAccountPassword/);
  assert.match(passwordChange, /hashPassword/);
  assert.match(passwordChange, /must_change_password=0/);
  assert.match(workspace, /workspacePasswordChangeGate/);
  assert.match(store, /mustChangePassword/);
  assert.match(envTypes, /ADMIN_PASSWORD\?: string/);
});

test("pilot workspace UI exposes member content ai review and password change flows", async () => {
  const [dashboard, staff, student, css, types, workspaceRoute] = await Promise.all([
    read("app/dashboard.tsx"),
    read("app/staff-views.tsx"),
    read("app/student-view.tsx"),
    read("app/globals.css"),
    read("app/lib/platform-types.ts"),
    read("app/api/v1/workspace/route.ts"),
  ]);
  assert.match(dashboard, /change-password/);
  assert.match(dashboard, /mustChangePassword/);
  assert.ok(dashboard.indexOf("password-change-card") < dashboard.indexOf("标准 Cloudflare 登录"));
  assert.match(staff, /成员管理/);
  assert.match(staff, /监护人绑定/);
  assert.match(staff, /预览片段/);
  assert.match(staff, /处理失败/);
  assert.match(staff, /processing_status==="processed"/);
  assert.match(staff, /AI 建议/);
  assert.match(student, /教师确认/);
  assert.match(css, /\.member-table/);
  assert.match(css, /\.content-preview/);
  assert.match(types, /submissionReviews/);
  assert.match(workspaceRoute, /admin \|\| roles\.includes\("teacher"\)/);
  assert.match(workspaceRoute, /submissionReviewsQuery = \(admin \|\| roles\.includes\("teacher"\)\)/);
});

test("README documents pilot workflow without exposing secrets", async () => {
  const [readme, envExample] = await Promise.all([read("README.md"), read(".env.example")]);
  assert.match(readme, /成员账号/);
  assert.match(readme, /首次登录修改临时密码/);
  assert.match(readme, /PDF\/DOCX\/TXT/);
  assert.match(readme, /AI 辅助批阅/);
  assert.match(readme, /教师确认/);
  assert.match(envExample, /OPENAI_API_KEY=/);
  assert.match(envExample, /AI_MODEL=gpt-5\.6-luna/);
  assert.doesNotMatch(`${readme}\n${envExample}`, /sk-|password123|JWT_SECRET=.{12,}/);
});

test("repository infrastructure includes issue forms and self-hosted Cloudflare deployment docs", async () => {
  const [config, bug, feature, readme] = await Promise.all([
    read(".github/ISSUE_TEMPLATE/config.yml"),
    read(".github/ISSUE_TEMPLATE/bug_report.yml"),
    read(".github/ISSUE_TEMPLATE/feature_request.yml"),
    read("README.md"),
  ]);
  assert.match(config, /blank_issues_enabled: false/);
  assert.match(bug, /Bug Report \/ 缺陷反馈/);
  assert.match(bug, /Cloudflare deployment \/ Cloudflare 部署/);
  assert.match(bug, /Node\.js/);
  assert.match(bug, /D1=DB, R2=CONTENT/);
  assert.match(bug, /I have removed sensitive information/);
  assert.match(feature, /Feature Request \/ 功能建议/);
  assert.match(feature, /Cloudflare self-hosting \/ Cloudflare 自托管/);
  assert.match(readme, /Deploy to Cloudflare Workers/);
  assert.match(readme, /Cloudflare Workers 连接 GitHub 仓库/);
  assert.match(readme, /一键部署/);
  assert.match(readme, /本地 Wrangler 部署/);
  assert.match(readme, /npm run build:standard/);
  assert.match(readme, /npx wrangler deploy --keep-vars/);
  assert.doesNotMatch(readme, /GitHub Actions 自动部署/);
  assert.match(readme, /tests\/auth-token\.test\.mjs/);
  const quickStartIndex = readme.indexOf("## ⚡ 快速开始");
  const deployIndex = readme.indexOf("### 方式一：Cloudflare Workers 连接 GitHub 仓库（推荐）");
  const usageIndex = readme.indexOf("## 📖 使用说明");
  const localDevIndex = readme.indexOf("## 👨‍💻 本地开发");
  assert.ok(quickStartIndex >= 0 && deployIndex > quickStartIndex && usageIndex > deployIndex);
  assert.match(readme.slice(usageIndex, localDevIndex), /机构管理员/);
  assert.match(readme.slice(usageIndex, localDevIndex), /教师确认/);
  assert.ok(localDevIndex > usageIndex);
  assert.match(readme.slice(localDevIndex), /git clone https:\/\/github\.com\/Ryrant\/wenqu-chinese-learning-platform\.git/);
  assert.match(readme.slice(localDevIndex), /npm ci/);
  assert.match(readme.slice(localDevIndex), /npm run dev/);
  assert.match(readme.slice(localDevIndex), /\.env\.local/);
  assert.match(readme.slice(localDevIndex), /DEV_USER_EMAIL/);
});

test("repository infrastructure includes standard README security and GPL license files", async () => {
  const [readme, security, license, pkgRaw] = await Promise.all([
    read("README.md"),
    read("SECURITY.md"),
    read("LICENSE"),
    read("package.json"),
  ]);
  const pkg = JSON.parse(pkgRaw);
  assert.match(readme, /^<div align="center">/);
  assert.match(readme, /<p align="center">/);
  assert.match(readme, /## ✨ 为什么做这个项目/);
  assert.match(readme, /## 🚀 核心能力/);
  assert.match(readme, /## ⚡ 快速开始/);
  assert.match(readme, /## 📖 使用说明/);
  assert.match(readme, /## 🧠 功能细节/);
  assert.match(readme, /## 🧱 技术栈/);
  assert.match(readme, /## 🗂️ 项目结构/);
  assert.match(readme, /## 👨‍💻 本地开发/);
  assert.match(readme, /## 🔐 安全报告/);
  assert.match(readme, /## 📄 许可证/);
  assert.match(security, /# Security Policy \/ 安全政策/);
  assert.match(security, /mail@sunnyhmz\.top/);
  assert.match(license, /GNU GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 29 June 2007/);
  assert.equal(pkg.license, "GPL-3.0-only");
});
