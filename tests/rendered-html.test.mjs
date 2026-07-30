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
  assert.match(schema, /appSettings/);
  assert.match(schema, /processingError: text\("processing_error"\)/);
  assert.match(migration, /ALTER TABLE `users` ADD `password_hash` text/);
  assert.match(migration, /CREATE TABLE `submission_reviews`/);
  assert.match(await read("drizzle/0003_initial_setup_settings.sql"), /CREATE TABLE `app_settings`/);
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
  const [schema, firstMigration, secondMigration, wrangler, store] = await Promise.all([
    read("db/schema.ts"), read("drizzle/0000_dusty_mesmero.sql"), read("drizzle/0001_condemned_lester.sql"), read("wrangler.toml"), read("app/lib/platform-store.ts"),
  ]);
  assert.match(schema, /tenantId: text\("tenant_id"\)/);
  assert.match(schema, /lessonPlans/);
  assert.match(schema, /notifications/);
  assert.match(schema, /invitations/);
  assert.equal((`${firstMigration}\n${secondMigration}`.match(/CREATE TABLE/g) ?? []).length, 21);
  assert.match(wrangler, /binding = "DB"/);
  assert.match(wrangler, /binding = "CONTENT"/);
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

test("platform identity supports standard and local auth modes only", async () => {
  const store = await read("app/lib/platform-store.ts");
  const envTypes = await read("cloudflare-env.d.ts");
  assert.match(store, /export type AuthMode = "standard" \| "local"/);
  assert.match(store, /export function getAuthMode\(\): AuthMode/);
  assert.doesNotMatch(store, /AUTH_MODE/);
  assert.doesNotMatch(store, /chatGptIdentity|oai-authenticated-user-email|signin-with-chatgpt|signout-with-chatgpt/i);
  assert.match(store, /verifySessionToken/);
  assert.match(store, /Authorization/);
  assert.match(store, /wenqu_session/);
  assert.doesNotMatch(envTypes, /AUTH_MODE\?:|JWT_SECRET\?:|AI_API_KEY|OPENAI_API_KEY|AI_MODEL|SPEECH_API_KEY|MODERATION_API_KEY|JWT_TTL_SECONDS/);
  assert.match(store, /ensureSiteJwtSecret/);
  assert.match(store, /app_settings/);
});

test("standard auth API exposes login logout and session endpoints", async () => {
  const [login, logout, session, setup] = await Promise.all([
    read("app/api/v1/auth/login/route.ts"),
    read("app/api/v1/auth/logout/route.ts"),
    read("app/api/v1/auth/session/route.ts"),
    read("app/api/v1/auth/setup/route.ts"),
  ]);
  assert.match(login, /ensureSiteJwtSecret/);
  assert.match(login, /createSessionToken/);
  assert.match(login, /HttpOnly/);
  assert.match(login, /SameSite=Lax/);
  assert.match(setup, /createInitialAdminAccount/);
  assert.match(setup, /setup_closed/);
  assert.match(session, /setupRequired/);
  assert.doesNotMatch(login, /console\.log\([^)]*password|console\.error\([^)]*password/);
  assert.match(logout, /Max-Age=0/);
  assert.match(session, /getAuthMode/);
  assert.match(session, /platformContext/);
});

test("settings API is admin-only and never echoes full secrets", async () => {
  const route = await read("app/api/v1/settings/route.ts");
  assert.match(route, /platformContext\(request, "admin"\)/);
  assert.match(route, /loadPlatformSettings/);
  assert.match(route, /savePlatformSettings/);
  assert.match(route, /publicPlatformSettings/);
  assert.doesNotMatch(route, /OPENAI_API_KEY|AI_API_KEY|SPEECH_API_KEY|MODERATION_API_KEY/);
  assert.doesNotMatch(route, /console\.log|console\.error/);
});

test("dashboard exposes standard mode login and logout flow", async () => {
  const [dashboard, css] = await Promise.all([read("app/dashboard.tsx"), read("app/globals.css")]);
  assert.match(dashboard, /authMode/);
  assert.match(dashboard, /\/api\/v1\/auth\/session/);
  assert.match(dashboard, /\/api\/v1\/auth\/login/);
  assert.match(dashboard, /\/api\/v1\/auth\/setup/);
  assert.match(dashboard, /\/api\/v1\/auth\/logout/);
  assert.match(dashboard, /type="password"/);
  assert.match(dashboard, /初始化文趣工作区/);
  assert.match(dashboard, /创建管理员并进入工作区/);
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

test("build uses the standard Wrangler configuration without Sites packaging", async () => {
  const [standardWrangler, pkgRaw, vite] = await Promise.all([
    read("wrangler.toml"),
    read("package.json"),
    read("vite.config.ts"),
  ]);
  const pkg = JSON.parse(pkgRaw);
  assert.equal(pkg.scripts["build:standard"], "node scripts/build-standard.mjs");
  assert.equal(pkg.scripts.deploy, "wrangler deploy");
  assert.match(pkg.scripts.lint, /\.wrangler-dry-run/);
  assert.equal(pkg.scripts["cf:preview"], "npm run build && npx wrangler dev");
  assert.equal(pkg.scripts["cf:deploy"], "npm run build && npm run deploy");
  assert.match(vite, /\.\/wrangler\.toml/);
  assert.doesNotMatch(vite, /sites\(|sites-vite-plugin|wrangler\.chatgpt|WENQU_DEPLOY_TARGET/);
  assert.match(standardWrangler, /binding = "DB"/);
  assert.match(standardWrangler, /binding = "CONTENT"/);
  assert.match(standardWrangler, /database_name = "wenqu-platform-db"/);
  assert.doesNotMatch(standardWrangler, /\[vars\]|AUTH_MODE|JWT_TTL_SECONDS|database_id|bucket_name|00000000-0000-4000-8000-000000000000|replace-with-r2-bucket-name|required = \["ADMIN_PASSWORD", "JWT_SECRET"\]/);
  await assert.rejects(read(".openai/hosting.json"));
  await assert.rejects(read("wrangler.chatgpt.toml"));
  await assert.rejects(read("build/sites-vite-plugin.ts"));
  await assert.rejects(read("app/chatgpt-auth.ts"));
});

test("CI is lightweight and default deployment workflow is not committed", async () => {
  const ciWorkflow = await read(".github/workflows/ci.yml");
  await assert.rejects(read(".github/workflows/deploy.yml"));
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

test("deployment relies on Cloudflare automatic D1 and R2 provisioning", async () => {
  const [standardWrangler, pkgRaw, envExample, readme] = await Promise.all([
    read("wrangler.toml"),
    read("package.json"),
    read(".env.example"),
    read("README.md"),
  ]);
  const pkg = JSON.parse(pkgRaw);
  assert.equal(pkg.scripts.deploy, "wrangler deploy");
  assert.doesNotMatch(JSON.stringify(pkg.scripts), /render-wrangler-config|D1_DATABASE_ID|R2_BUCKET_NAME/);
  assert.doesNotMatch(standardWrangler, /database_id|bucket_name|replace-with|00000000/);
  assert.doesNotMatch(envExample, /D1_DATABASE_ID|R2_BUCKET_NAME/);
  assert.match(readme, /D1\/R2.*自动创建/s);
  assert.doesNotMatch(readme, /把 `wrangler\.toml` 中的占位值替换|D1_DATABASE_ID|R2_BUCKET_NAME|replace-with-r2-bucket-name/);
  await assert.rejects(read("scripts/render-wrangler-config.mjs"));
});

test("standard build launcher delegates through the active npm CLI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wenqu-build-standard-"));
  try {
    const outputPath = join(directory, "invocation.json");
    const npmCliPath = join(directory, "fake-npm.mjs");
    await writeFile(npmCliPath, `
      import { writeFile } from "node:fs/promises";
      await writeFile(process.env.WENQU_TEST_OUTPUT, JSON.stringify({
        args: process.argv.slice(2),
        target: process.env.WENQU_DEPLOY_TARGET ?? null,
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
    assert.deepEqual(invocation, { args: ["run", "build"], target: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("standard cloudflare deployment configuration has no variable prerequisites and remains secret-safe", async () => {
  const [standardWrangler, envExample, agents] = await Promise.all([
    read("wrangler.toml"),
    read(".env.example"),
    read("AGENTS.md"),
  ]);
  assert.match(standardWrangler, /main = "worker\/index\.ts"/);
  assert.match(standardWrangler, /binding = "DB"/);
  assert.match(standardWrangler, /binding = "CONTENT"/);
  assert.doesNotMatch(standardWrangler, /database_id|bucket_name|replace-with|00000000/);
  assert.doesNotMatch(standardWrangler, /\[vars\]|AUTH_MODE|JWT_TTL_SECONDS|ADMIN_PASSWORD|JWT_SECRET|required =|CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(envExample, /AUTH_MODE=|JWT_TTL_SECONDS=|ADMIN_PASSWORD=|JWT_SECRET=|OPENAI_API_KEY=|AI_API_KEY=|AI_MODEL=|SPEECH_API_KEY=|MODERATION_API_KEY=/);
  assert.doesNotMatch(envExample, /D1_DATABASE_ID|R2_BUCKET_NAME/);
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
  assert.match(agents, /部署前.*零变量/s);
  assert.match(agents, /首次初始化/);
  assert.match(agents, /WAF Rate Limiting|Cloudflare Access/);
  assert.match(agents, /\.github\/workflows\/ci\.yml.*必要校验/s);
  assert.match(agents, /不维护默认 GitHub Actions 自动部署 workflow/);
  assert.match(agents, /\/api\/v1\/auth\/login/);
  assert.match(agents, /docs\/superpowers\/.*本地/);
  assert.doesNotMatch(`${envExample}\n${agents}`, /ChatGPT|Platform Sites|\.openai|wrangler\.chatgpt|oai-authenticated-user-email/i);
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
  assert.match(login, /loadPlatformSettings/);
  assert.match(standardLogin, /verifyPassword/);
  assert.match(standardLogin, /must_change_password AS mustChangePassword/);
  assert.match(standardLogin, /u\.status AS status/);
  assert.match(standardLogin, /createInitialAdminAccount/);
  assert.doesNotMatch(login, /password !== bindings\.ADMIN_PASSWORD/);
  assert.match(session, /sessionPasswordChangeState/);
  assert.match(passwordChangeState, /mustChangePassword/);
  assert.match(changePassword, /changeAccountPassword/);
  assert.match(passwordChange, /hashPassword/);
  assert.match(passwordChange, /must_change_password=0/);
  assert.match(workspace, /workspacePasswordChangeGate/);
  assert.match(store, /mustChangePassword/);
  assert.doesNotMatch(envTypes, /ADMIN_PASSWORD\?: string/);
});

test("initial setup and startup requests never expose empty JSON responses", async () => {
  const [dashboard, setupRoute] = await Promise.all([
    read("app/dashboard.tsx"),
    read("app/api/v1/auth/setup/route.ts"),
  ]);
  assert.match(setupRoute, /try \{/);
  assert.match(setupRoute, /catch \(error\)/);
  assert.match(setupRoute, /platformApiError\(error\)/);
  assert.match(dashboard, /async function readJson/);
  assert.match(dashboard, /response\.text\(\)/);
  assert.doesNotMatch(dashboard, /await response\.json\(\)/);
});

test("runtime service status reads platform settings from D1", async () => {
  const [workspace, health] = await Promise.all([
    read("app/api/v1/workspace/route.ts"),
    read("app/api/v1/health/route.ts"),
  ]);
  assert.match(workspace, /loadPlatformSettings/);
  assert.match(health, /loadPlatformSettings/);
  assert.doesNotMatch(workspace, /AI_API_KEY|OPENAI_API_KEY|SPEECH_API_KEY|MODERATION_API_KEY/);
  assert.doesNotMatch(health, /AI_API_KEY|OPENAI_API_KEY|AI_MODEL|SPEECH_API_KEY|MODERATION_API_KEY/);
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

test("admin UI exposes post-deploy platform settings stored in D1", async () => {
  const [dashboard, staff, types, readme] = await Promise.all([
    read("app/dashboard.tsx"),
    read("app/staff-views.tsx"),
    read("app/lib/platform-types.ts"),
    read("README.md"),
  ]);
  assert.match(dashboard, /平台设置/);
  assert.match(staff, /\/api\/v1\/settings/);
  assert.match(staff, /保存平台设置/);
  assert.match(staff, /OpenAI/);
  assert.match(staff, /内容审核/);
  assert.match(types, /platformSettings/);
  assert.match(readme, /部署前.*零变量/s);
  assert.match(readme, /平台设置.*OpenAI.*语音评测.*内容审核/s);
  assert.doesNotMatch(readme, /Variables and Secrets|ADMIN_PASSWORD|JWT_SECRET|OPENAI_API_KEY|AI_API_KEY|SPEECH_API_KEY|MODERATION_API_KEY/);
});

test("README documents pilot workflow without exposing secrets", async () => {
  const [readme, envExample, openaiProvider] = await Promise.all([
    read("README.md"),
    read(".env.example"),
    read("app/lib/ai/openai-provider.ts"),
  ]);
  assert.match(readme, /成员账号/);
  assert.match(readme, /首次登录修改临时密码/);
  assert.match(readme, /PDF\/DOCX\/TXT/);
  assert.match(readme, /AI 辅助批阅/);
  assert.match(readme, /教师确认/);
  assert.doesNotMatch(envExample, /OPENAI_API_KEY=|AI_MODEL=/);
  assert.match(openaiProvider, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.doesNotMatch(`${readme}\n${envExample}`, /sk-|password123|JWT_SECRET=.{12,}/);
  assert.doesNotMatch(`${readme}\n${envExample}`, /ChatGPT|Platform Sites|\.openai|wrangler\.chatgpt|oai-authenticated-user-email/i);
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
  assert.match(readme, /npm run build/);
  assert.match(readme, /npx wrangler deploy/);
  assert.doesNotMatch(readme, /--keep-vars/);
  assert.doesNotMatch(readme, /GitHub Actions 自动部署/);
  assert.doesNotMatch(bug, /ChatGPT Sites|Platform Sites/i);
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
  assert.match(readme.slice(localDevIndex), /x-wenqu-dev-user/);
  assert.doesNotMatch(readme.slice(localDevIndex), /AUTH_MODE|DEV_USER_EMAIL/);
});

test("local planning docs are ignored and ChatGPT Sites artifacts are untracked", async () => {
  const gitignore = await read(".gitignore");
  assert.match(gitignore, /docs\/superpowers\//);
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: fileURLToPath(root) });
  assert.doesNotMatch(stdout, /^docs\/superpowers\//m);
  assert.doesNotMatch(stdout, /^\.openai\/hosting\.json$/m);
  assert.doesNotMatch(stdout, /^wrangler\.chatgpt\.toml$/m);
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
