# Pilot School Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pilot-ready school workflow where admins create real member accounts, upload and publish teaching materials, teachers assign and review work, students submit work, guardians view confirmed reports, and AI assists only when grounded in published sources.

**Architecture:** Keep the existing Next/Vinext + Cloudflare Workers + D1/R2 single application. Split new behavior into focused modules under `app/lib/` while preserving `/api/v1/workspace` as the read aggregation endpoint and `/api/v1/workspace/actions` as a compatibility command endpoint during the first pilot phase.

**Tech Stack:** TypeScript, React 19, Next.js 16, Vinext, Vite, Cloudflare Workers, D1, R2, Drizzle ORM, Node.js Test Runner, ESLint. OpenAI integration uses the official Responses API over `fetch`, with no OpenAI SDK dependency in the first implementation.

## Global Constraints

- Node.js version requirement remains `>=22.13.0`.
- Keep ChatGPT Platform Sites, local development, and standard Cloudflare Workers auth modes compatible.
- Do not add Cloudflare Vectorize.
- Do not implement OCR.
- Do not implement audio/video transcription.
- Do not implement automatic speech scoring.
- Do not implement third-party SSO.
- Do not let AI review results directly become final grades.
- Do not perform a large visual redesign.
- Store AI keys only in server-side environment variables or Cloudflare Secrets.
- Store passwords only as hashes; never log or persist temporary passwords in plain text.
- Run at least `npm test` after changes touching authentication, deployment, D1/R2, API permissions, or persistent data; run `npm run lint` when practical.

---

## File Structure

### Existing files to modify

- `db/schema.ts` — Add Drizzle definitions for member account fields, review tables, assignment objectives, and content processing fields.
- `app/lib/platform-store.ts` — Keep auth mode selection and schema bootstrap, but delegate account lookup and schema additions to focused modules.
- `app/lib/auth-token.ts` — Reuse current JWT helpers; no change unless session payload needs `mustChangePassword`.
- `app/api/v1/auth/login/route.ts` — Replace single `ADMIN_PASSWORD` credential check with account-backed standard login while preserving bootstrap admin fallback.
- `app/api/v1/auth/session/route.ts` — Return `mustChangePassword`, user id, display name, email, and roles for standard sessions.
- `app/api/v1/auth/logout/route.ts` — Keep current cookie clearing behavior.
- `app/api/v1/workspace/route.ts` — Add members, guardian links, learning objectives, content processing fields, and filtered report data.
- `app/api/v1/workspace/actions/route.ts` — Route existing and new commands through focused service functions.
- `app/api/v1/content/upload/route.ts` — Upload file, extract text, chunk text, store chunks, and set processing status.
- `app/api/v1/knowledge/search/route.ts` — Delegate to retrieval service and return match reasons.
- `app/api/v1/ai/generate/route.ts` — Use retrieval + AI provider chain for student Q&A.
- `app/dashboard.tsx` — Add first-login password change gate and pass new workspace data to role views.
- `app/staff-views.tsx` — Add admin member management, guardian binding, content preview, teacher AI review, and updated class/task flows.
- `app/student-view.tsx` — Keep task submission and AI classroom; update messages for grounded generation and confirmed growth records.
- `app/lib/platform-types.ts` — Replace broad `Row` usage with pilot-ready record shapes where needed.
- `app/globals.css` — Add minimal styles for member tables, change-password form, content preview, and AI review blocks.
- `.env.example` — Add `OPENAI_API_KEY`, `AI_MODEL`, and account-backed auth notes without real secrets.
- `cloudflare-env.d.ts` — Add `OPENAI_API_KEY?: string` and `AI_MODEL?: string`.
- `tests/rendered-html.test.mjs` — Extend static regression coverage for pilot workflow.
- `tests/auth-token.test.mjs` — Keep token behavior coverage; extend only if session payload changes.

### New files to create

- `app/lib/auth-password.ts` — Password hashing and verification using Web Crypto PBKDF2.
- `app/lib/membership-service.ts` — Member CRUD, role assignment, account status, guardian-student links.
- `app/lib/access-control.ts` — Reusable class, submission, student, and guardian access predicates.
- `app/lib/content-processing.ts` — TXT/DOCX/PDF text extraction, chunking, and content status helpers.
- `app/lib/retrieval.ts` — Query normalization, keyword matching, published-source retrieval.
- `app/lib/ai/provider.ts` — Provider types and shared response contracts.
- `app/lib/ai/template-provider.ts` — Current source-grounded deterministic fallback moved into a reusable provider.
- `app/lib/ai/openai-provider.ts` — Responses API provider implemented with `fetch`.
- `app/lib/ai/grounding.ts` — Source requirements, prompt construction, citation validation.
- `app/lib/assessment-service.ts` — AI suggestion persistence, final review confirmation, mastery updates.
- `app/api/v1/auth/change-password/route.ts` — First-login and normal password change endpoint.
- `tests/auth-password.test.mjs` — Password hashing tests.
- `tests/membership-access.test.mjs` — Static and helper-level access coverage.
- `tests/content-processing.test.mjs` — Chunking and TXT extraction tests, with PDF/DOCX static coverage.
- `tests/ai-provider.test.mjs` — Provider fallback and OpenAI request-shape tests with mocked `fetch`.
- `tests/assessment.test.mjs` — Review state and mastery update logic tests.

### Dependency decision

The content task needs file parsing beyond standard Web APIs. Implementers must request confirmation before installing dependencies. The recommended first choice is:

- `fflate` for DOCX ZIP/XML extraction.
- `pdfjs-dist` for extracting selectable text from PDFs.

After installing, run `npm run build` before committing the content task. If either dependency fails the Workers/Vinext build, stop and report the incompatibility instead of replacing it ad hoc.

---

### Task 1: Schema and Runtime Table Bootstrap

**Files:**
- Modify: `db/schema.ts`
- Modify: `app/lib/platform-store.ts`
- Create: `drizzle/0002_pilot_school_readiness.sql`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: D1 columns `users.password_hash`, `users.must_change_password`, `users.status`, `users.last_login_at`, `role_memberships.status`, `guardian_student_links.status`, `source_documents.processing_error`, `submissions.feedback`, `submissions.reviewed_at`.
- Produces: Tables `submission_reviews` and `assignment_objectives`.
- Consumes: Existing table names and `ensureCoreSchema(db)` / `ensureExtendedSchema(db)` bootstrap flow in `app/lib/platform-store.ts`.

- [ ] **Step 1: Add failing schema regression assertions**

Add to `tests/rendered-html.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/rendered-html.test.mjs
```

Expected: FAIL because `drizzle/0002_pilot_school_readiness.sql` and the new schema symbols do not exist.

- [ ] **Step 3: Update Drizzle schema**

Add these fields to `users`:

```ts
passwordHash: text("password_hash"),
mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(false),
status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
lastLoginAt: text("last_login_at"),
```

Add this field to `roleMemberships`:

```ts
status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
```

Add this field to `guardianStudentLinks`:

```ts
status: text("status", { enum: ["active", "disabled"] }).notNull().default("active"),
```

Add this field to `sourceDocuments`:

```ts
processingError: text("processing_error"),
```

Add these fields to `submissions`:

```ts
feedback: text("feedback"),
reviewedAt: text("reviewed_at"),
```

Add new tables:

```ts
export const submissionReviews = sqliteTable("submission_reviews", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  submissionId: text("submission_id").notNull(),
  reviewerUserId: text("reviewer_user_id").notNull(),
  finalScore: real("final_score"),
  finalComment: text("final_comment"),
  aiSuggestedScore: real("ai_suggested_score"),
  aiComment: text("ai_comment"),
  weaknessTagsJson: text("weakness_tags_json").notNull().default("[]"),
  status: text("status", { enum: ["ai_suggested", "confirmed"] }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  index("submission_reviews_tenant_idx").on(table.tenantId),
  index("submission_reviews_submission_idx").on(table.tenantId, table.submissionId),
]);

export const assignmentObjectives = sqliteTable("assignment_objectives", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: text("tenant_id").notNull(),
  assignmentId: text("assignment_id").notNull(),
  objectiveId: text("objective_id").notNull(),
  weight: real("weight").notNull().default(1),
  createdAt: createdAt(),
}, (table) => [
  index("assignment_objectives_assignment_idx").on(table.tenantId, table.assignmentId),
  uniqueIndex("assignment_objective_unique_idx").on(table.tenantId, table.assignmentId, table.objectiveId),
]);
```

- [ ] **Step 4: Add migration SQL**

Create `drizzle/0002_pilot_school_readiness.sql` with:

```sql
ALTER TABLE `users` ADD `password_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `must_change_password` integer NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE `users` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` text;--> statement-breakpoint
ALTER TABLE `role_memberships` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `guardian_student_links` ADD `status` text NOT NULL DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `source_documents` ADD `processing_error` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `feedback` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `reviewed_at` text;--> statement-breakpoint
CREATE TABLE `submission_reviews` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL,
  `submission_id` text NOT NULL,
  `reviewer_user_id` text NOT NULL,
  `final_score` real,
  `final_comment` text,
  `ai_suggested_score` real,
  `ai_comment` text,
  `weakness_tags_json` text DEFAULT '[]' NOT NULL,
  `status` text NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `submission_reviews_tenant_idx` ON `submission_reviews` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `submission_reviews_submission_idx` ON `submission_reviews` (`tenant_id`,`submission_id`);--> statement-breakpoint
CREATE TABLE `assignment_objectives` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `tenant_id` text NOT NULL,
  `assignment_id` text NOT NULL,
  `objective_id` text NOT NULL,
  `weight` real DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assignment_objectives_assignment_idx` ON `assignment_objectives` (`tenant_id`,`assignment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `assignment_objective_unique_idx` ON `assignment_objectives` (`tenant_id`,`assignment_id`,`objective_id`);
```

Update `drizzle/meta/_journal.json` by appending an entry for index `2`, tag `0002_pilot_school_readiness`, and the next timestamp in milliseconds.

- [ ] **Step 5: Update runtime schema bootstrap**

In `ensureCoreSchema(db)` and `ensureExtendedSchema(db)`, add idempotent `ALTER TABLE` handling via helper:

```ts
async function trySchema(db: D1Database, sql: string) {
  try {
    await db.prepare(sql).run();
  } catch (error) {
    if (error instanceof Error && /duplicate column name|already exists/i.test(error.message)) return;
    throw error;
  }
}
```

After existing `CREATE TABLE IF NOT EXISTS` batch completes, run `trySchema` for each new column and run `CREATE TABLE IF NOT EXISTS submission_reviews` and `assignment_objectives`.

- [ ] **Step 6: Run targeted tests**

Run:

```bash
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add db/schema.ts drizzle/0002_pilot_school_readiness.sql drizzle/meta/_journal.json app/lib/platform-store.ts tests/rendered-html.test.mjs
git commit -m "feat: 增加试点账号内容与批阅数据结构"
```

---

### Task 2: Password Hashing and Account-Backed Standard Login

**Files:**
- Create: `app/lib/auth-password.ts`
- Create: `app/api/v1/auth/change-password/route.ts`
- Modify: `app/api/v1/auth/login/route.ts`
- Modify: `app/api/v1/auth/session/route.ts`
- Modify: `app/lib/platform-store.ts`
- Modify: `cloudflare-env.d.ts`
- Test: `tests/auth-password.test.mjs`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `hashPassword(password: string, saltBytes?: Uint8Array): Promise<string>`.
- Produces: `verifyPassword(password: string, encodedHash: string): Promise<boolean>`.
- Produces: `needsPasswordChange(session): boolean` exposed through `/api/v1/auth/session`.
- Consumes: D1 `users.password_hash`, `users.must_change_password`, `users.status`, `users.last_login_at`.

- [ ] **Step 1: Write password hashing tests**

Create `tests/auth-password.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const sourceUrl = new URL("../app/lib/auth-password.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourceUrl.pathname,
  reportDiagnostics: true,
});
const errors = (transpiled.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
assert.deepEqual(errors, []);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { hashPassword, verifyPassword } = await import(moduleUrl);

test("password hashes verify the original password and reject another password", async () => {
  const hash = await hashPassword("TempPass-1234", new Uint8Array(16).fill(7));
  assert.match(hash, /^pbkdf2-sha256\$150000\$/);
  assert.equal(await verifyPassword("TempPass-1234", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("malformed password hashes fail closed", async () => {
  assert.equal(await verifyPassword("TempPass-1234", "not-a-valid-hash"), false);
  assert.equal(await verifyPassword("TempPass-1234", "pbkdf2-sha256$150000$bad$bad"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/auth-password.test.mjs
```

Expected: FAIL because `app/lib/auth-password.ts` does not exist.

- [ ] **Step 3: Implement password helper**

Create `app/lib/auth-password.ts`:

```ts
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const iterations = 150_000;
const keyLengthBits = 256;

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, keyLengthBits);
  return new Uint8Array(bits);
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

export async function hashPassword(password: string, saltBytes?: Uint8Array) {
  const salt = saltBytes ?? crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(password, salt);
  return `pbkdf2-sha256$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(digest)}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  try {
    const [algorithm, iterationText, saltText, digestText, extra] = encodedHash.split("$");
    if (algorithm !== "pbkdf2-sha256" || iterationText !== String(iterations) || !saltText || !digestText || extra) return false;
    const expected = base64UrlDecode(digestText);
    const actual = await derive(password, base64UrlDecode(saltText));
    return timingSafeEqual(actual, expected);
  } catch {
    decoder.decode(new Uint8Array());
    return false;
  }
}
```

- [ ] **Step 4: Extend auth route regression assertions**

In `tests/rendered-html.test.mjs`, add:

```js
test("standard login uses account password hashes and change-password gate", async () => {
  const [login, session, changePassword, store, envTypes] = await Promise.all([
    read("app/api/v1/auth/login/route.ts"),
    read("app/api/v1/auth/session/route.ts"),
    read("app/api/v1/auth/change-password/route.ts"),
    read("app/lib/platform-store.ts"),
    read("cloudflare-env.d.ts"),
  ]);
  assert.match(login, /verifyPassword/);
  assert.match(login, /must_change_password AS mustChangePassword/);
  assert.match(login, /status='active'/);
  assert.doesNotMatch(login, /password !== bindings\.ADMIN_PASSWORD/);
  assert.match(session, /mustChangePassword/);
  assert.match(changePassword, /hashPassword/);
  assert.match(changePassword, /must_change_password=0/);
  assert.match(store, /mustChangePassword/);
  assert.match(envTypes, /ADMIN_PASSWORD\?: string/);
});
```

- [ ] **Step 5: Implement account-backed standard login**

Modify `app/api/v1/auth/login/route.ts`:

- Keep `getAuthMode() !== "standard"` behavior.
- Keep isolate-local rate limiting.
- Use D1 to find an active account:

```ts
const account = await bindings.DB.prepare(`
  SELECT u.id,u.email,u.display_name AS displayName,u.password_hash AS passwordHash,
         u.must_change_password AS mustChangePassword
  FROM users u
  WHERE lower(u.email)=? AND u.status='active'
  LIMIT 1
`).bind(email).first<{ id: string; email: string; displayName: string; passwordHash: string | null; mustChangePassword: number }>();
```

- If no account exists and email equals `ADMIN_EMAIL`, allow bootstrap login with `ADMIN_PASSWORD`, create the admin user with `hashPassword(password)`, insert admin role membership, and set `must_change_password=0`.
- For normal account login, call `verifyPassword(password, account.passwordHash ?? "")`.
- On success, update `last_login_at=CURRENT_TIMESTAMP`.
- Include `mustChangePassword` in the session JSON response and JWT payload if `StandardSession` is extended.

- [ ] **Step 6: Implement change-password endpoint**

Create `app/api/v1/auth/change-password/route.ts`:

```ts
import { platformApiError, platformContext } from "../../../../lib/platform-store";
import { hashPassword, verifyPassword } from "../../../../lib/auth-password";

export async function POST(request: Request) {
  try {
    const context = await platformContext(request);
    const body = await request.json() as { currentPassword?: unknown; newPassword?: unknown };
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      return Response.json({ error: "weak_password" }, { status: 400 });
    }
    const account = await context.db.prepare("SELECT password_hash AS passwordHash FROM users WHERE id=? AND status='active'")
      .bind(context.userId)
      .first<{ passwordHash: string | null }>();
    if (!account?.passwordHash || !(await verifyPassword(currentPassword, account.passwordHash))) {
      return Response.json({ error: "invalid_credentials" }, { status: 401 });
    }
    const passwordHash = await hashPassword(newPassword);
    await context.db.prepare("UPDATE users SET password_hash=?,must_change_password=0 WHERE id=?")
      .bind(passwordHash, context.userId)
      .run();
    await context.db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), context.tenantId, context.userId, "password.changed", "user", context.userId, "{}")
      .run();
    return Response.json({ changed: true });
  } catch (error) {
    return platformApiError(error);
  }
}
```

- [ ] **Step 7: Update platform context for account status**

In `platformContext()`, adjust membership query:

```sql
SELECT rm.tenant_id AS tenantId, rm.role AS role
FROM role_memberships rm
JOIN users u ON u.id=rm.user_id
WHERE lower(u.email)=? AND u.status='active' AND rm.status='active'
ORDER BY rm.created_at ASC
```

Return `mustChangePassword` as an optional context field if the front end needs it. Do not block `/api/v1/auth/change-password`; block workspace data for standard users with `must_change_password=1` by returning `password_change_required` from `/api/v1/workspace`.

- [ ] **Step 8: Run tests**

Run:

```bash
node --test tests/auth-password.test.mjs
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```bash
git add app/lib/auth-password.ts app/api/v1/auth/login/route.ts app/api/v1/auth/session/route.ts app/api/v1/auth/change-password/route.ts app/lib/platform-store.ts cloudflare-env.d.ts tests/auth-password.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: 支持成员密码登录与首次改密"
```

---

### Task 3: Membership Management and Guardian Links

**Files:**
- Create: `app/lib/membership-service.ts`
- Modify: `app/api/v1/workspace/actions/route.ts`
- Modify: `app/api/v1/workspace/route.ts`
- Modify: `app/lib/platform-types.ts`
- Test: `tests/membership-access.test.mjs`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `createMember(db, input): Promise<{ id: string; email: string; role: PlatformRole; mustChangePassword: true }>`.
- Produces: `resetMemberPassword(db, input): Promise<void>`.
- Produces: `setMemberStatus(db, input): Promise<void>`.
- Produces: `setGuardianLinks(db, input): Promise<void>`.
- Consumes: `hashPassword()` from Task 2 and D1 account fields from Task 1.

- [ ] **Step 1: Write service surface regression test**

Create `tests/membership-access.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("membership service exposes pilot member and guardian operations", async () => {
  const service = await read("app/lib/membership-service.ts");
  const actions = await read("app/api/v1/workspace/actions/route.ts");
  const workspace = await read("app/api/v1/workspace/route.ts");
  assert.match(service, /export async function createMember/);
  assert.match(service, /export async function resetMemberPassword/);
  assert.match(service, /export async function setMemberStatus/);
  assert.match(service, /export async function setGuardianLinks/);
  assert.match(service, /hashPassword/);
  assert.match(service, /guardian_student_links/);
  assert.match(actions, /create_member/);
  assert.match(actions, /reset_member_password/);
  assert.match(actions, /set_guardian_links/);
  assert.match(workspace, /members:/);
  assert.match(workspace, /guardianLinks:/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/membership-access.test.mjs
```

Expected: FAIL because `membership-service.ts` does not exist.

- [ ] **Step 3: Implement membership service**

Create `app/lib/membership-service.ts`:

```ts
import { hashPassword } from "./auth-password";
import type { PlatformRole } from "./platform-store";

export type MemberInput = {
  tenantId: string;
  actorUserId: string;
  email: string;
  displayName: string;
  role: PlatformRole;
  temporaryPassword: string;
};

export async function createMember(db: D1Database, input: MemberInput) {
  const email = input.email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("invalid_member_email");
  if (input.temporaryPassword.length < 10) throw new Error("weak_password");
  let hash = 2166136261;
  for (let index = 0; index < email.length; index += 1) hash = Math.imul(hash ^ email.charCodeAt(index), 16777619);
  const userId = `usr_${(hash >>> 0).toString(36)}`;
  const passwordHash = await hashPassword(input.temporaryPassword);
  await db.batch([
    db.prepare("INSERT INTO users (id,email,display_name,locale,password_hash,must_change_password,status) VALUES (?,?,?,?,?,1,'active') ON CONFLICT(id) DO UPDATE SET email=excluded.email,display_name=excluded.display_name,password_hash=excluded.password_hash,must_change_password=1,status='active'")
      .bind(userId, email, input.displayName.trim().slice(0, 120) || email.split("@")[0], "zh-CN", passwordHash),
    db.prepare("INSERT OR IGNORE INTO role_memberships (tenant_id,user_id,role,status) VALUES (?,?,?,'active')")
      .bind(input.tenantId, userId, input.role),
    db.prepare("UPDATE role_memberships SET status='active' WHERE tenant_id=? AND user_id=? AND role=?")
      .bind(input.tenantId, userId, input.role),
    db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.created", "user", userId, JSON.stringify({ email, role: input.role })),
  ]);
  return { id: userId, email, role: input.role, mustChangePassword: true };
}

export async function resetMemberPassword(db: D1Database, input: { tenantId: string; actorUserId: string; userId: string; temporaryPassword: string }) {
  if (input.temporaryPassword.length < 10) throw new Error("weak_password");
  const passwordHash = await hashPassword(input.temporaryPassword);
  const result = await db.prepare("UPDATE users SET password_hash=?,must_change_password=1,status='active' WHERE id=? AND EXISTS (SELECT 1 FROM role_memberships rm WHERE rm.tenant_id=? AND rm.user_id=users.id)")
    .bind(passwordHash, input.userId, input.tenantId)
    .run();
  if (!result.meta.changes) throw new Error("member_not_found");
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.password_reset", "user", input.userId, "{}")
    .run();
}

export async function setMemberStatus(db: D1Database, input: { tenantId: string; actorUserId: string; userId: string; status: "active" | "disabled" }) {
  const result = await db.prepare("UPDATE users SET status=? WHERE id=? AND EXISTS (SELECT 1 FROM role_memberships rm WHERE rm.tenant_id=? AND rm.user_id=users.id)")
    .bind(input.status, input.userId, input.tenantId)
    .run();
  if (!result.meta.changes) throw new Error("member_not_found");
  await db.prepare("UPDATE role_memberships SET status=? WHERE tenant_id=? AND user_id=?")
    .bind(input.status, input.tenantId, input.userId)
    .run();
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "member.status_changed", "user", input.userId, JSON.stringify({ status: input.status }))
    .run();
}

export async function setGuardianLinks(db: D1Database, input: { tenantId: string; actorUserId: string; guardianUserId: string; studentUserIds: string[] }) {
  await db.prepare("UPDATE guardian_student_links SET status='disabled' WHERE tenant_id=? AND guardian_user_id=?")
    .bind(input.tenantId, input.guardianUserId)
    .run();
  const uniqueStudents = [...new Set(input.studentUserIds)].filter(Boolean);
  if (uniqueStudents.length) {
    await db.batch(uniqueStudents.map((studentUserId) => db.prepare("INSERT INTO guardian_student_links (tenant_id,guardian_user_id,student_user_id,verified_at,status) VALUES (?,?,?,CURRENT_TIMESTAMP,'active')")
      .bind(input.tenantId, input.guardianUserId, studentUserId)));
  }
  await db.prepare("INSERT INTO audit_logs (id,tenant_id,actor_user_id,action,target_type,target_id,detail_json) VALUES (?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), input.tenantId, input.actorUserId, "guardian_links.updated", "user", input.guardianUserId, JSON.stringify({ studentUserIds: uniqueStudents }))
    .run();
}
```

- [ ] **Step 4: Wire admin actions**

In `workspace/actions/route.ts`, import the service and extend `roleByAction`:

```ts
create_member: "admin",
reset_member_password: "admin",
set_member_status: "admin",
set_guardian_links: "admin",
```

Add handlers that call the four service functions. For passwords, return only `{ id, email, role, mustChangePassword }`; never return the temporary password.

- [ ] **Step 5: Add workspace member data**

In `workspace/route.ts`, add admin-only queries:

```sql
SELECT u.id,u.email,u.display_name AS displayName,u.status,u.must_change_password AS mustChangePassword,
       group_concat(rm.role) AS roles
FROM users u
JOIN role_memberships rm ON rm.user_id=u.id
WHERE rm.tenant_id=?
GROUP BY u.id
ORDER BY u.created_at DESC
```

and:

```sql
SELECT guardian_user_id AS guardianUserId, student_user_id AS studentUserId, status, verified_at AS verifiedAt
FROM guardian_student_links
WHERE tenant_id=? AND status='active'
ORDER BY created_at DESC
```

Return `members` and `guardianLinks` arrays.

- [ ] **Step 6: Update types**

In `app/lib/platform-types.ts`, add:

```ts
export type MemberRow = Row & { id: string; email: string; displayName: string; status: string; roles: string };
export type GuardianLinkRow = Row & { guardianUserId: string; studentUserId: string; status: string };
```

Add `members: Row[]; guardianLinks: Row[];` to `WorkspaceData`.

- [ ] **Step 7: Run targeted tests**

Run:

```bash
node --test tests/membership-access.test.mjs
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/lib/membership-service.ts app/api/v1/workspace/actions/route.ts app/api/v1/workspace/route.ts app/lib/platform-types.ts tests/membership-access.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: 增加成员管理与监护人绑定"
```

---

### Task 4: Access-Control Helpers and Workspace Filtering

**Files:**
- Create: `app/lib/access-control.ts`
- Modify: `app/api/v1/workspace/route.ts`
- Modify: `app/api/v1/workspace/actions/route.ts`
- Modify: `app/api/v1/submissions/route.ts`
- Modify: `app/api/v1/speech/submissions/route.ts`
- Test: `tests/membership-access.test.mjs`

**Interfaces:**
- Produces: `canAccessClassWhere(alias: string): AccessClause`.
- Produces: `canAccessSubmissionWhere(submissionAlias: string, assignmentAlias: string, classAlias: string): AccessClause`.
- Produces: `AccessClause = { sql: string; args: unknown[] }`.
- Consumes: `PlatformContext` with `roles`, `tenantId`, and `userId`.

- [ ] **Step 1: Add access helper assertions**

Extend `tests/membership-access.test.mjs`:

```js
test("access control helpers centralize teacher student and guardian filters", async () => {
  const access = await read("app/lib/access-control.ts");
  const workspace = await read("app/api/v1/workspace/route.ts");
  const actions = await read("app/api/v1/workspace/actions/route.ts");
  assert.match(access, /export type AccessClause/);
  assert.match(access, /export function classAccessClause/);
  assert.match(access, /export function submissionAccessClause/);
  assert.match(access, /guardian_student_links gl/);
  assert.match(access, /gl.status='active'/);
  assert.match(workspace, /classAccessClause/);
  assert.match(workspace, /submissionAccessClause/);
  assert.match(actions, /assertSubmissionReviewAccess/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/membership-access.test.mjs
```

Expected: FAIL because `access-control.ts` does not exist.

- [ ] **Step 3: Implement access-control helpers**

Create `app/lib/access-control.ts`:

```ts
import type { PlatformContext } from "./platform-store";

export type AccessClause = { sql: string; args: unknown[] };

export function classAccessClause(context: PlatformContext, classAlias = "c"): AccessClause {
  if (context.roles.includes("admin")) return { sql: "1=1", args: [] };
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (context.roles.includes("teacher")) {
    clauses.push(`${classAlias}.teacher_user_id=?`);
    args.push(context.userId);
  }
  if (context.roles.includes("student")) {
    clauses.push(`EXISTS (SELECT 1 FROM enrollments ea WHERE ea.tenant_id=${classAlias}.tenant_id AND ea.class_id=${classAlias}.id AND ea.student_user_id=? AND ea.status='active')`);
    args.push(context.userId);
  }
  if (context.roles.includes("guardian")) {
    clauses.push(`EXISTS (SELECT 1 FROM enrollments eg JOIN guardian_student_links gl ON gl.tenant_id=eg.tenant_id AND gl.student_user_id=eg.student_user_id AND gl.status='active' WHERE eg.tenant_id=${classAlias}.tenant_id AND eg.class_id=${classAlias}.id AND gl.guardian_user_id=?)`);
    args.push(context.userId);
  }
  return clauses.length ? { sql: `(${clauses.join(" OR ")})`, args } : { sql: "1=0", args: [] };
}

export function submissionAccessClause(context: PlatformContext, submissionAlias = "s", classAlias = "c"): AccessClause {
  if (context.roles.includes("admin")) return { sql: "1=1", args: [] };
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (context.roles.includes("teacher")) {
    clauses.push(`${classAlias}.teacher_user_id=?`);
    args.push(context.userId);
  }
  if (context.roles.includes("student")) {
    clauses.push(`${submissionAlias}.student_user_id=?`);
    args.push(context.userId);
  }
  if (context.roles.includes("guardian")) {
    clauses.push(`EXISTS (SELECT 1 FROM guardian_student_links gl WHERE gl.tenant_id=${submissionAlias}.tenant_id AND gl.student_user_id=${submissionAlias}.student_user_id AND gl.guardian_user_id=? AND gl.status='active')`);
    args.push(context.userId);
  }
  return clauses.length ? { sql: `(${clauses.join(" OR ")})`, args } : { sql: "1=0", args: [] };
}

export async function assertSubmissionReviewAccess(db: D1Database, context: PlatformContext, submissionId: string) {
  if (context.roles.includes("admin")) return;
  const row = await db.prepare(`
    SELECT s.id
    FROM submissions s
    JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
    WHERE s.id=? AND s.tenant_id=? AND c.teacher_user_id=?
  `).bind(submissionId, context.tenantId, context.userId).first();
  if (!row) throw new Error("forbidden");
}
```

- [ ] **Step 4: Replace duplicated workspace filters**

In `workspace/route.ts`, replace local `classClauses` / `submissionClauses` construction with `classAccessClause(context, "c")` and `submissionAccessClause(context, "s", "c")`. Bind tenant id first, followed by clause args.

- [ ] **Step 5: Reuse review access in actions**

In `review_submission`, call `assertSubmissionReviewAccess(db, context, id)` before updating the submission. Keep admin access through the helper.

- [ ] **Step 6: Check student submission routes**

In `app/api/v1/submissions/route.ts` and `app/api/v1/speech/submissions/route.ts`, ensure assignment lookup keeps:

```sql
EXISTS (
  SELECT 1 FROM enrollments e
  WHERE e.tenant_id=a.tenant_id
    AND e.class_id=a.class_id
    AND e.student_user_id=?
    AND e.status='active'
)
```

Do not allow guardian or teacher submission through these student endpoints.

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/membership-access.test.mjs
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/lib/access-control.ts app/api/v1/workspace/route.ts app/api/v1/workspace/actions/route.ts app/api/v1/submissions/route.ts app/api/v1/speech/submissions/route.ts tests/membership-access.test.mjs
git commit -m "refactor: 集中租户角色与绑定访问控制"
```

---

### Task 5: Content Extraction, Chunking, and Reviewable Publishing

**Files:**
- Create: `app/lib/content-processing.ts`
- Modify: `app/api/v1/content/upload/route.ts`
- Modify: `app/api/v1/workspace/actions/route.ts`
- Modify: `app/api/v1/workspace/route.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/content-processing.test.mjs`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `extractText(file: File): Promise<ExtractedText>`.
- Produces: `chunkText(input: { sourceDocumentId: string; tenantId: string; text: string }): KnowledgeChunkInput[]`.
- Produces: `publishContent(db, input): Promise<void>`.
- Consumes: R2 upload path and D1 `source_documents` / `knowledge_chunks`.

- [ ] **Step 1: Confirm parser dependencies before installing**

Ask the user to approve adding:

```bash
npm install fflate pdfjs-dist
```

Reason: PDF and DOCX selectable-text extraction cannot be implemented reliably with only current project dependencies. `fflate` handles DOCX ZIP/XML extraction; `pdfjs-dist` handles selectable PDF text. Do not install until the user confirms.

- [ ] **Step 2: Write content-processing tests**

Create `tests/content-processing.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("content processing module supports txt docx and pdf without OCR", async () => {
  const moduleText = await read("app/lib/content-processing.ts");
  assert.match(moduleText, /extractTxtText/);
  assert.match(moduleText, /extractDocxText/);
  assert.match(moduleText, /extractPdfText/);
  assert.match(moduleText, /export function chunkText/);
  assert.match(moduleText, /content.length <= 1000/);
  assert.match(moduleText, /chunkIndex/);
  assert.match(moduleText, /unsupported_scanned_pdf/);
  assert.doesNotMatch(moduleText, /OCR|Vectorize|transcription/);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
node --test tests/content-processing.test.mjs
```

Expected: FAIL because `content-processing.ts` does not exist.

- [ ] **Step 4: Install approved dependencies**

After user approval, run:

```bash
npm install fflate pdfjs-dist
```

Expected: `package.json` and `package-lock.json` change. If install fails, stop and report the package-manager error.

- [ ] **Step 5: Implement content-processing module**

Create `app/lib/content-processing.ts`:

```ts
import { unzipSync, strFromU8 } from "fflate";
import * as pdfjs from "pdfjs-dist";

export type ExtractedText = { text: string; kind: "txt" | "docx" | "pdf" };
export type KnowledgeChunkInput = {
  id: string;
  tenantId: string;
  sourceDocumentId: string;
  content: string;
  metadataJson: string;
};

export async function extractText(file: File): Promise<ExtractedText> {
  if (file.type === "text/plain" || file.name.toLowerCase().endsWith(".txt")) return extractTxtText(file);
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.toLowerCase().endsWith(".docx")) return extractDocxText(file);
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return extractPdfText(file);
  throw new Error("unsupported_file_type");
}

export async function extractTxtText(file: File): Promise<ExtractedText> {
  const text = (await file.text()).replace(/\u0000/g, "").trim();
  if (!text) throw new Error("empty_text");
  return { text, kind: "txt" };
}

export async function extractDocxText(file: File): Promise<ExtractedText> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const documentXml = zip["word/document.xml"];
  if (!documentXml) throw new Error("docx_document_missing");
  const xml = strFromU8(documentXml);
  const text = xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) throw new Error("empty_text");
  return { text, kind: "docx" };
}

export async function extractPdfText(file: File): Promise<ExtractedText> {
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" ").trim());
  }
  const text = pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text || text.length < 20) throw new Error("unsupported_scanned_pdf");
  return { text, kind: "pdf" };
}

export function chunkText(input: { tenantId: string; sourceDocumentId: string; text: string }): KnowledgeChunkInput[] {
  const paragraphs = input.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= 1000) {
      current = next;
    } else {
      if (current) chunks.push(current);
      if (paragraph.length <= 1000) {
        current = paragraph;
      } else {
        for (let index = 0; index < paragraph.length; index += 1000) chunks.push(paragraph.slice(index, index + 1000));
        current = "";
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.map((content, chunkIndex) => ({
    id: crypto.randomUUID(),
    tenantId: input.tenantId,
    sourceDocumentId: input.sourceDocumentId,
    content,
    metadataJson: JSON.stringify({ chunkIndex, length: content.length }),
  }));
}
```

- [ ] **Step 6: Integrate upload processing**

In `content/upload/route.ts`, after `bucket.put`, call `extractText(file)` and `chunkText(...)`.

On success:

- Insert `source_documents` with `processing_status='processed'`.
- Insert all `knowledge_chunks` with `published=0`.
- Audit `source.processed` with chunk count and extraction kind.

On extraction failure:

- Insert `source_documents` with `processing_status='failed'`.
- Set `processing_error` to one of `empty_text`, `unsupported_scanned_pdf`, `docx_document_missing`, or `unsupported_file_type`.
- Return `201` with `{ id, status: "failed", error }` because the file was saved but not usable for retrieval.

- [ ] **Step 7: Update content review action**

In `review_content`, when publishing:

```sql
UPDATE source_documents SET processing_status='published',rights_status='approved' WHERE id=? AND tenant_id=? AND processing_status='processed'
```

Then:

```sql
UPDATE knowledge_chunks SET published=1 WHERE tenant_id=? AND source_document_id=?
```

When rejecting:

```sql
UPDATE source_documents SET processing_status='rejected',rights_status='pending' WHERE id=? AND tenant_id=?
UPDATE knowledge_chunks SET published=0 WHERE tenant_id=? AND source_document_id=?
```

- [ ] **Step 8: Update workspace document query**

Return `processing_error AS processingError` and published chunk count:

```sql
SUM(CASE WHEN k.published=1 THEN 1 ELSE 0 END) AS publishedChunkCount
```

- [ ] **Step 9: Run targeted tests and build**

Run:

```bash
node --test tests/content-processing.test.mjs
node --test tests/rendered-html.test.mjs
npm run build
```

Expected: all PASS. If `npm run build` fails because `pdfjs-dist` is incompatible with Workers/Vinext, stop and report the exact error.

- [ ] **Step 10: Commit**

Run:

```bash
git add package.json package-lock.json app/lib/content-processing.ts app/api/v1/content/upload/route.ts app/api/v1/workspace/actions/route.ts app/api/v1/workspace/route.ts tests/content-processing.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: 增加教材文本抽取切片与审核发布"
```

---

### Task 6: Retrieval Service and Grounded AI Provider Chain

**Files:**
- Create: `app/lib/retrieval.ts`
- Create: `app/lib/ai/provider.ts`
- Create: `app/lib/ai/template-provider.ts`
- Create: `app/lib/ai/openai-provider.ts`
- Create: `app/lib/ai/grounding.ts`
- Modify: `app/api/v1/knowledge/search/route.ts`
- Modify: `app/api/v1/health/route.ts`
- Modify: `.env.example`
- Modify: `cloudflare-env.d.ts`
- Test: `tests/ai-provider.test.mjs`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `searchPublishedKnowledge(db, input): Promise<RetrievedChunk[]>`.
- Produces: `generateGroundedText(input): Promise<AiGenerationResult>`.
- Produces: `createAiProvider(env): AiProvider`.
- Consumes: OpenAI Responses API over `fetch`.

- [ ] **Step 1: Write AI provider and retrieval tests**

Create `tests/ai-provider.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("ai provider modules use Responses API and keep template fallback", async () => {
  const [provider, openai, template, grounding, envExample] = await Promise.all([
    read("app/lib/ai/provider.ts"),
    read("app/lib/ai/openai-provider.ts"),
    read("app/lib/ai/template-provider.ts"),
    read("app/lib/ai/grounding.ts"),
    read(".env.example"),
  ]);
  assert.match(provider, /export type AiProvider/);
  assert.match(openai, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(openai, /gpt-5\.6-luna/);
  assert.match(openai, /OPENAI_API_KEY/);
  assert.match(template, /source-grounded-template/);
  assert.match(grounding, /no_reviewed_sources/);
  assert.match(envExample, /OPENAI_API_KEY=/);
  assert.match(envExample, /AI_MODEL=gpt-5\.6-luna/);
});

test("knowledge search route delegates to retrieval service", async () => {
  const [retrieval, route] = await Promise.all([
    read("app/lib/retrieval.ts"),
    read("app/api/v1/knowledge/search/route.ts"),
  ]);
  assert.match(retrieval, /export async function searchPublishedKnowledge/);
  assert.match(retrieval, /processing_status='published'/);
  assert.match(retrieval, /matchReason/);
  assert.match(route, /searchPublishedKnowledge/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/ai-provider.test.mjs
```

Expected: FAIL because AI provider modules do not exist.

- [ ] **Step 3: Implement retrieval service**

Create `app/lib/retrieval.ts`:

```ts
export type RetrievedChunk = {
  id: string;
  title: string;
  content: string;
  excerpt: string;
  score: number;
  matchReason: string;
};

export function normalizeQuery(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

export function queryTerms(query: string) {
  return [...new Set(normalizeQuery(query).split(/[\s,，。！？、]+/).filter((term) => term.length >= 2))].slice(0, 8);
}

export async function searchPublishedKnowledge(db: D1Database, input: { tenantId: string; query: string; limit?: number }) {
  const terms = queryTerms(input.query);
  if (!terms.length) return [];
  const like = `%${terms[0]}%`;
  const rows = await db.prepare(`
    SELECT k.id,k.content,d.title
    FROM knowledge_chunks k
    JOIN source_documents d ON d.id=k.source_document_id AND d.tenant_id=k.tenant_id
    WHERE k.tenant_id=? AND k.published=1 AND d.processing_status='published'
      AND (${terms.map(() => "k.content LIKE ?").join(" OR ")})
    ORDER BY k.created_at DESC
    LIMIT ?
  `).bind(input.tenantId, ...terms.map((term) => `%${term}%`), Math.max(1, Math.min(input.limit ?? 5, 10))).all<{ id: string; content: string; title: string }>();
  return rows.results.map((row) => {
    const matched = terms.filter((term) => row.content.toLowerCase().includes(term));
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      excerpt: row.content.slice(0, 500),
      score: matched.length,
      matchReason: matched.length ? `matched:${matched.join(",")}` : `fallback:${like}`,
    };
  });
}
```

- [ ] **Step 4: Implement provider types**

Create `app/lib/ai/provider.ts`:

```ts
import type { RetrievedChunk } from "../retrieval";

export type AiPurpose = "tutor" | "lesson" | "review";
export type AiGenerationInput = {
  purpose: AiPurpose;
  prompt: string;
  level?: string;
  role: "student" | "teacher" | "guardian" | "admin";
  contextChunks: RetrievedChunk[];
};
export type AiGenerationResult = {
  text: string;
  provider: string;
  model: string;
  status: "completed" | "template" | "review_required";
  inputTokens: number;
  outputTokens: number;
  citations: Array<{ id: string; title: string; excerpt: string }>;
};
export type AiProvider = {
  name: string;
  model: string;
  generateText(input: AiGenerationInput): Promise<AiGenerationResult>;
};
```

- [ ] **Step 5: Implement template provider**

Create `app/lib/ai/template-provider.ts` with deterministic text generation based on `contextChunks`, using provider `local` and model `source-grounded-template`. Include citations mapped directly from chunks.

- [ ] **Step 6: Implement OpenAI provider**

Create `app/lib/ai/openai-provider.ts`:

```ts
import type { AiGenerationInput, AiGenerationResult, AiProvider } from "./provider";

export function createOpenAiProvider(config: { apiKey?: string; model?: string }): AiProvider | null {
  if (!config.apiKey) return null;
  const model = config.model?.trim() || "gpt-5.6-luna";
  return {
    name: "openai",
    model,
    async generateText(input: AiGenerationInput): Promise<AiGenerationResult> {
      const context = input.contextChunks.map((chunk, index) => `[${index + 1}] ${chunk.title}\n${chunk.content}`).join("\n\n");
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: "system",
              content: "你是华文教学助手。只能依据给定来源回答。输出必须包含可追溯引用编号。找不到依据时说明无法回答。",
            },
            {
              role: "user",
              content: `用途：${input.purpose}\n水平：${input.level ?? "A2"}\n问题：${input.prompt}\n\n来源：\n${context}`,
            },
          ],
        }),
      });
      if (!response.ok) throw new Error("openai_generation_failed");
      const data = await response.json() as { output_text?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      const text = data.output_text?.trim();
      if (!text) throw new Error("openai_empty_output");
      return {
        text,
        provider: "openai",
        model,
        status: "completed",
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        citations: input.contextChunks.map((chunk) => ({ id: chunk.id, title: chunk.title, excerpt: chunk.excerpt })),
      };
    },
  };
}
```

This plan uses the OpenAI Responses API and default model `gpt-5.6-luna`, based on the official model documentation showing GPT-5.6 Luna as the cost-sensitive frontier model and the docs stating latest models are available via the Responses API.

- [ ] **Step 7: Implement grounding**

Create `app/lib/ai/grounding.ts`:

```ts
import { createOpenAiProvider } from "./openai-provider";
import type { AiGenerationInput, AiGenerationResult } from "./provider";
import { createTemplateProvider } from "./template-provider";

export async function generateGroundedText(input: AiGenerationInput, config: { openAiKey?: string; model?: string }): Promise<AiGenerationResult> {
  if (!input.contextChunks.length) throw new Error("no_reviewed_sources");
  const provider = createOpenAiProvider({ apiKey: config.openAiKey, model: config.model });
  if (provider) {
    try {
      return await provider.generateText(input);
    } catch {
      return createTemplateProvider().generateText(input);
    }
  }
  return createTemplateProvider().generateText(input);
}
```

- [ ] **Step 8: Wire knowledge search and health**

In `knowledge/search/route.ts`, call `searchPublishedKnowledge`. In `health/route.ts`, add provider labels for `OPENAI_API_KEY` and `AI_MODEL`, while preserving existing fallback status.

In `.env.example`, add:

```dotenv
OPENAI_API_KEY=
AI_MODEL=gpt-5.6-luna
```

In `cloudflare-env.d.ts`, add:

```ts
OPENAI_API_KEY?: string;
AI_MODEL?: string;
```

- [ ] **Step 9: Run tests**

Run:

```bash
node --test tests/ai-provider.test.mjs
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add app/lib/retrieval.ts app/lib/ai/provider.ts app/lib/ai/template-provider.ts app/lib/ai/openai-provider.ts app/lib/ai/grounding.ts app/api/v1/knowledge/search/route.ts app/api/v1/health/route.ts .env.example cloudflare-env.d.ts tests/ai-provider.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: 增加来源化检索与 AI 提供方抽象"
```

---

### Task 7: Integrate Grounded Generation into Student Q&A and Teacher Lesson Drafts

**Files:**
- Modify: `app/api/v1/ai/generate/route.ts`
- Modify: `app/api/v1/workspace/actions/route.ts`
- Modify: `app/staff-views.tsx`
- Modify: `app/student-view.tsx`
- Test: `tests/ai-provider.test.mjs`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `searchPublishedKnowledge()` from Task 6.
- Consumes: `generateGroundedText()` from Task 6.
- Produces: persisted `ai_sessions` rows with provider, model, status, input token count, and output token count.
- Produces: persisted `citations` rows from provider result.

- [ ] **Step 1: Add integration assertions**

Extend `tests/ai-provider.test.mjs`:

```js
test("student and teacher generation use grounded provider chain", async () => {
  const [generate, actions, student, staff] = await Promise.all([
    read("app/api/v1/ai/generate/route.ts"),
    read("app/api/v1/workspace/actions/route.ts"),
    read("app/student-view.tsx"),
    read("app/staff-views.tsx"),
  ]);
  assert.match(generate, /searchPublishedKnowledge/);
  assert.match(generate, /generateGroundedText/);
  assert.match(generate, /OPENAI_API_KEY/);
  assert.match(actions, /generateGroundedText/);
  assert.match(actions, /input_tokens,output_tokens/);
  assert.match(student, /引用来源/);
  assert.match(staff, /provider|engine/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/ai-provider.test.mjs
```

Expected: FAIL because existing routes still use inline template logic.

- [ ] **Step 3: Refactor student AI route**

In `app/api/v1/ai/generate/route.ts`:

- Use `platformContext(request)`.
- Validate role is student, teacher, or admin.
- Parse prompt and purpose.
- Call `searchPublishedKnowledge(context.db, { tenantId: context.tenantId, query: prompt, limit: 5 })`.
- Call `generateGroundedText({ purpose, prompt, contextChunks, role, level }, { openAiKey: env.OPENAI_API_KEY ?? env.AI_API_KEY, model: env.AI_MODEL })`.
- Insert `ai_sessions`.
- Insert `citations`.
- Stream `meta`, `token`, `citations`, and `done` SSE events as before.

- [ ] **Step 4: Refactor teacher lesson action**

In `generate_lesson` action:

- Replace inline template construction with the same retrieval + `generateGroundedText` path.
- Persist `lesson_plans` using generated text in `activities_json` as one teacher-editable draft block:

```ts
const activities = [{ minutes: duration, title: "AI 来源化教学草稿", detail: result.text }];
```

- Store citations from result.
- Audit `lesson_plan.generated` with `{ sourceCount, provider: result.provider, model: result.model }`.

- [ ] **Step 5: Update UI status copy**

In `student-view.tsx`, keep existing citation rendering and update status chip to display provider/model when present in meta.

In `staff-views.tsx`, display `engine` or `provider` for generated lesson drafts and keep “教师审核中” copy.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test tests/ai-provider.test.mjs
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/api/v1/ai/generate/route.ts app/api/v1/workspace/actions/route.ts app/staff-views.tsx app/student-view.tsx tests/ai-provider.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: 接入来源化 AI 生成链路"
```

---

### Task 8: AI-Assisted Text Review and Mastery Updates

**Files:**
- Create: `app/lib/assessment-service.ts`
- Modify: `app/api/v1/workspace/actions/route.ts`
- Modify: `app/api/v1/workspace/route.ts`
- Modify: `app/staff-views.tsx`
- Modify: `app/student-view.tsx`
- Modify: `app/lib/platform-types.ts`
- Test: `tests/assessment.test.mjs`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `suggestTextReview(db, context, submissionId): Promise<ReviewSuggestion>`.
- Produces: `confirmSubmissionReview(db, context, input): Promise<ConfirmedReview>`.
- Consumes: `generateGroundedText()` and `searchPublishedKnowledge()` for suggestions.
- Consumes: `assertSubmissionReviewAccess()` from Task 4.

- [ ] **Step 1: Write assessment tests**

Create `tests/assessment.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("assessment service separates ai suggestion from final teacher confirmation", async () => {
  const [service, actions, staff, student] = await Promise.all([
    read("app/lib/assessment-service.ts"),
    read("app/api/v1/workspace/actions/route.ts"),
    read("app/staff-views.tsx"),
    read("app/student-view.tsx"),
  ]);
  assert.match(service, /export async function suggestTextReview/);
  assert.match(service, /export async function confirmSubmissionReview/);
  assert.match(service, /ai_suggested/);
  assert.match(service, /confirmed/);
  assert.match(service, /mastery_snapshots/);
  assert.match(actions, /suggest_text_review/);
  assert.match(actions, /confirm_submission_review/);
  assert.match(staff, /AI 建议/);
  assert.doesNotMatch(student, /ai_comment|aiSuggestedScore/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/assessment.test.mjs
```

Expected: FAIL because `assessment-service.ts` does not exist.

- [ ] **Step 3: Implement assessment service**

Create `app/lib/assessment-service.ts`:

```ts
import { assertSubmissionReviewAccess } from "./access-control";
import { generateGroundedText } from "./ai/grounding";
import { searchPublishedKnowledge } from "./retrieval";
import type { PlatformContext } from "./platform-store";

export type ReviewSuggestion = { submissionId: string; suggestedScore: number; comment: string; weaknessTags: string[] };
export type ConfirmedReview = { submissionId: string; score: number; comment: string };

export async function suggestTextReview(db: D1Database, context: PlatformContext, submissionId: string, config: { openAiKey?: string; model?: string }): Promise<ReviewSuggestion> {
  await assertSubmissionReviewAccess(db, context, submissionId);
  const submission = await db.prepare(`
    SELECT s.id,s.text_answer AS textAnswer,a.title AS assignmentTitle
    FROM submissions s
    JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
    WHERE s.id=? AND s.tenant_id=? AND s.text_answer IS NOT NULL
  `).bind(submissionId, context.tenantId).first<{ id: string; textAnswer: string; assignmentTitle: string }>();
  if (!submission) throw new Error("submission_not_found");
  const chunks = await searchPublishedKnowledge(db, { tenantId: context.tenantId, query: `${submission.assignmentTitle} ${submission.textAnswer}`, limit: 5 });
  const result = await generateGroundedText({
    purpose: "review",
    prompt: `请给出文字作业评分建议、评语和薄弱点标签。任务：${submission.assignmentTitle}\n学生答案：${submission.textAnswer}`,
    role: "teacher",
    contextChunks: chunks,
  }, config);
  const scoreMatch = result.text.match(/([0-9]{1,3})\s*分/);
  const suggestedScore = Math.max(0, Math.min(Number(scoreMatch?.[1] ?? 80), 100));
  const weaknessTags = [...new Set((result.text.match(/薄弱点[:：]\s*([^\n]+)/)?.[1] ?? "表达完整度").split(/[、,，]/).map((item) => item.trim()).filter(Boolean))].slice(0, 5);
  await db.prepare("INSERT INTO submission_reviews (id,tenant_id,submission_id,reviewer_user_id,ai_suggested_score,ai_comment,weakness_tags_json,status) VALUES (?,?,?,?,?,?,?,'ai_suggested')")
    .bind(crypto.randomUUID(), context.tenantId, submissionId, context.userId, suggestedScore, result.text, JSON.stringify(weaknessTags))
    .run();
  await db.prepare("UPDATE submissions SET review_status='ai_suggested_pending_review' WHERE id=? AND tenant_id=?")
    .bind(submissionId, context.tenantId)
    .run();
  return { submissionId, suggestedScore, comment: result.text, weaknessTags };
}

export async function confirmSubmissionReview(db: D1Database, context: PlatformContext, input: { submissionId: string; score: number; comment: string }): Promise<ConfirmedReview> {
  await assertSubmissionReviewAccess(db, context, input.submissionId);
  const score = Math.max(0, Math.min(input.score, 100));
  await db.batch([
    db.prepare("INSERT INTO submission_reviews (id,tenant_id,submission_id,reviewer_user_id,final_score,final_comment,weakness_tags_json,status) VALUES (?,?,?,?,?,?,?,'confirmed')")
      .bind(crypto.randomUUID(), context.tenantId, input.submissionId, context.userId, score, input.comment.slice(0, 2000), "[]"),
    db.prepare("UPDATE submissions SET score=?,confidence=1,feedback=?,review_status='reviewed',reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?")
      .bind(score, input.comment.slice(0, 2000), input.submissionId, context.tenantId),
    db.prepare(`INSERT INTO mastery_snapshots (tenant_id,student_user_id,objective_id,mastery,evidence_count)
      SELECT s.tenant_id,s.student_user_id,ao.objective_id,?,1
      FROM submissions s
      JOIN assignment_objectives ao ON ao.tenant_id=s.tenant_id AND ao.assignment_id=s.assignment_id
      WHERE s.id=? AND s.tenant_id=?`)
      .bind(score / 100, input.submissionId, context.tenantId),
  ]);
  return { submissionId: input.submissionId, score, comment: input.comment };
}
```

- [ ] **Step 4: Add workspace actions**

In `roleByAction`, add:

```ts
suggest_text_review: "teacher",
confirm_submission_review: "teacher",
```

Route `review_submission` through `confirmSubmissionReview` or keep it as compatibility wrapper that calls `confirmSubmissionReview` with an empty comment.

Add handler:

```ts
if (action === "suggest_text_review") {
  const id = requireText(body.id, "submission_id");
  const result = await suggestTextReview(db, context, id, {
    openAiKey: (env as unknown as { OPENAI_API_KEY?: string; AI_API_KEY?: string }).OPENAI_API_KEY ?? (env as unknown as { AI_API_KEY?: string }).AI_API_KEY,
    model: (env as unknown as { AI_MODEL?: string }).AI_MODEL,
  });
  await audit(db, tenantId, userId, "submission.ai_review_suggested", "submission", id);
  return Response.json(result);
}
```

- [ ] **Step 5: Include review data in workspace**

In `workspace/route.ts`, query latest reviews for visible submissions:

```sql
SELECT sr.*
FROM submission_reviews sr
JOIN submissions s ON s.id=sr.submission_id AND s.tenant_id=sr.tenant_id
JOIN assignments a ON a.id=s.assignment_id AND a.tenant_id=s.tenant_id
JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
WHERE sr.tenant_id=? AND <submissionAccess>
ORDER BY sr.created_at DESC
LIMIT 50
```

Return `submissionReviews`.

- [ ] **Step 6: Update teacher and student UI**

In `staff-views.tsx`, add buttons for:

- `suggest_text_review` on text submissions not yet reviewed.
- `confirm_submission_review` with editable score/comment.

In `student-view.tsx`, show final `feedback` only when `review_status === "reviewed"`. Do not render `ai_comment` or `aiSuggestedScore`.

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/assessment.test.mjs
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/lib/assessment-service.ts app/api/v1/workspace/actions/route.ts app/api/v1/workspace/route.ts app/staff-views.tsx app/student-view.tsx app/lib/platform-types.ts tests/assessment.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: 增加文字作业 AI 辅助批阅"
```

---

### Task 9: Pilot Workspace UI Completion

**Files:**
- Modify: `app/dashboard.tsx`
- Modify: `app/staff-views.tsx`
- Modify: `app/student-view.tsx`
- Modify: `app/lib/platform-types.ts`
- Modify: `app/globals.css`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `members`, `guardianLinks`, `submissionReviews`, `documents.processingError`, `documents.publishedChunkCount`, `user.mustChangePassword`.
- Produces: Admin member management forms, guardian link controls, content preview states, teacher AI review controls, first-login password change UI.

- [ ] **Step 1: Add UI regression assertions**

Extend `tests/rendered-html.test.mjs`:

```js
test("pilot workspace UI exposes member content ai review and password change flows", async () => {
  const [dashboard, staff, student, css, types] = await Promise.all([
    read("app/dashboard.tsx"),
    read("app/staff-views.tsx"),
    read("app/student-view.tsx"),
    read("app/globals.css"),
    read("app/lib/platform-types.ts"),
  ]);
  assert.match(dashboard, /change-password/);
  assert.match(dashboard, /mustChangePassword/);
  assert.match(staff, /成员管理/);
  assert.match(staff, /监护人绑定/);
  assert.match(staff, /预览片段/);
  assert.match(staff, /AI 建议/);
  assert.match(student, /教师确认/);
  assert.match(css, /\.member-table/);
  assert.match(css, /\.content-preview/);
  assert.match(types, /submissionReviews/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/rendered-html.test.mjs
```

Expected: FAIL because UI copy and CSS classes are missing.

- [ ] **Step 3: Add password change gate**

In `dashboard.tsx`:

- After `/api/v1/auth/session`, store `mustChangePassword`.
- If standard mode session has `mustChangePassword`, render a form with current password and new password.
- Submit to `/api/v1/auth/change-password`.
- On success, reload auth mode and workspace.
- Preserve user input on 5xx.

Use endpoint path string exactly:

```ts
await fetch("/api/v1/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
```

- [ ] **Step 4: Add admin member management UI**

In `AdminView`:

- Add nav section or reuse `权限审计` for `成员管理`.
- Render member table with email, display name, roles, status, must-change-password flag.
- Add create member form with email, displayName, role, temporaryPassword.
- Add reset password form per member.
- Add enable/disable button calling `set_member_status`.
- Add guardian binding area using student and guardian member filters.

- [ ] **Step 5: Add content preview UI**

In `内容中心`:

- Display `processing_status`, `processingError`, `chunkCount`, `publishedChunkCount`.
- Show failed extraction message for `unsupported_scanned_pdf`.
- Add “预览片段” section using existing document/chunk data if workspace returns previews. If previews are not returned, show first three chunk excerpts after Task 5 extends the query.

- [ ] **Step 6: Add teacher AI review UI**

In `作业批阅`:

- Add “生成 AI 建议” button only when `text_answer` exists and review status is not `reviewed`.
- Render latest AI suggestion from `submissionReviews`.
- Provide editable final score and comment fields.
- Submit `confirm_submission_review`.

- [ ] **Step 7: Update student confirmed-only copy**

In `成长档案`, add copy:

```tsx
<small>只显示教师确认后的评分与反馈</small>
```

Render `feedback` only for reviewed submissions.

- [ ] **Step 8: Add minimal CSS**

In `globals.css`, add compact styles:

```css
.member-table,.content-preview,.ai-review-box{margin-top:16px}
.member-table table{width:100%;border-collapse:collapse}
.member-table th,.member-table td{padding:10px;border-bottom:1px solid rgba(15,23,42,.08);text-align:left}
.content-preview{display:grid;gap:10px}
.ai-review-box{border:1px solid rgba(37,99,235,.18);background:#eff6ff;border-radius:18px;padding:16px}
.password-change-card{max-width:460px;margin:8vh auto;padding:28px}
```

- [ ] **Step 9: Run tests**

Run:

```bash
node --test tests/rendered-html.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add app/dashboard.tsx app/staff-views.tsx app/student-view.tsx app/lib/platform-types.ts app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: 补齐试点工作台交互"
```

---

### Task 10: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: User-facing pilot usage notes without AI collaboration notes or secret values.

- [ ] **Step 1: Add documentation regression assertions**

Extend `tests/rendered-html.test.mjs`:

```js
test("README documents pilot workflow without exposing secrets", async () => {
  const [readme, envExample] = await Promise.all([read("README.md"), read(".env.example")]);
  assert.match(readme, /成员账号/);
  assert.match(readme, /首次登录修改临时密码/);
  assert.match(readme, /PDF\\/DOCX\\/TXT/);
  assert.match(readme, /AI 辅助批阅/);
  assert.match(readme, /教师确认/);
  assert.match(envExample, /OPENAI_API_KEY=/);
  assert.match(envExample, /AI_MODEL=gpt-5\\.6-luna/);
  assert.doesNotMatch(`${readme}\n${envExample}`, /sk-|password123|JWT_SECRET=.{12,}/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/rendered-html.test.mjs
```

Expected: FAIL until README pilot usage notes are added.

- [ ] **Step 3: Update README user-facing sections**

In `README.md`, update `## 📖 使用说明` with concise pilot workflow:

```markdown
### 机构管理员

1. 使用管理员账号登录。
2. 在成员管理中创建教师、学生和家长账号，并设置临时密码。
3. 维护学生与监护人绑定关系。
4. 上传 PDF、DOCX 或 TXT 教材，确认文本抽取和切片结果后发布。

### 教师

1. 创建班级和任务。
2. 关联学习目标并发布任务。
3. 查看学生文字和语音提交。
4. 对文字作业生成 AI 建议，并在确认或修改后发布最终评分。

### 学生

1. 首次登录后修改临时密码。
2. 查看任务并提交文字或录音作业。
3. 在 AI 课堂中基于已发布资料提问。
4. 在成长档案查看教师确认后的反馈。

### 家长

1. 登录后查看已绑定学生。
2. 查看教师确认后的学习报告。
3. 维护家庭练习提醒和学习分析授权。
```

Do not add contributor instructions, AI collaboration notes, or marketing language.

- [ ] **Step 4: Ensure `.env.example` remains secret-safe**

Confirm `.env.example` includes:

```dotenv
OPENAI_API_KEY=
AI_MODEL=gpt-5.6-luna
```

and does not include real API keys, real passwords, real D1 IDs, or real R2 bucket names.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm run lint
npm test
npm run build
npm run build:standard
```

Expected: all commands exit `0`. If `npm run build:standard` fails because local Cloudflare bindings are not configured, capture the exact error and verify `npm run build` and `npm test` still pass before reporting.

- [ ] **Step 6: Commit**

Run:

```bash
git add README.md .env.example tests/rendered-html.test.mjs
git commit -m "docs: 补充试点版本使用说明"
```

- [ ] **Step 7: Prepare final handoff**

Run:

```bash
git status --short
git log --oneline origin/main..HEAD
```

Expected: worktree clean and task commits listed in order.

---

## Self-Review Notes

- Spec coverage:
  - Multi-user accounts: Tasks 1, 2, 3, 9.
  - First-login password change: Tasks 2 and 9.
  - Multi guardian/student links: Tasks 3, 4, 9.
  - PDF/DOCX/TXT extraction and chunking: Task 5.
  - Manual content review and keyword retrieval: Tasks 5 and 6.
  - OpenAI provider with template fallback: Tasks 6 and 7.
  - AI-assisted text review with teacher confirmation: Task 8.
  - Confirmed-only student and guardian reporting: Tasks 8 and 9.
  - Tests and docs: Task 10.
- Explicit exclusions preserved:
  - No Cloudflare Vectorize.
  - No OCR.
  - No audio/video transcription.
  - No automatic speech scoring.
  - No third-party SSO.
  - No direct AI-to-final-grade path.
- OpenAI source note:
  - Official OpenAI model docs list `gpt-5.6-luna` as the cost-sensitive frontier model and state latest models are available via the Responses API.
  - Implementation uses direct `fetch` to `https://api.openai.com/v1/responses`, keeping the dependency surface unchanged.
