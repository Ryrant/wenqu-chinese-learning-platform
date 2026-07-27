# Cloudflare Standard Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add standard Cloudflare Workers deployment support with password login while preserving existing ChatGPT Platform Sites behavior.

**Architecture:** Keep the existing business API surface stable by extending the shared `platformContext()` identity layer. Add a small JWT helper module and auth API routes, then let the React dashboard show a login panel only when the runtime reports standard auth mode. Use separate default/Sites and standard Wrangler configurations selected by the build target, and keep `.openai/hosting.json` for Sites packaging.

**Tech Stack:** TypeScript, React 19, Vinext, Vite, Cloudflare Workers, D1, R2, Wrangler 4.92.0, Node.js Test Runner.

## Global Constraints

- Development happens on branch `work-agents-md`; final integration must go through PR before merging into main.
- Preserve ChatGPT Sites compatibility and do not delete `.openai/hosting.json`.
- Do not add runtime dependencies for JWT; use Workers Web Crypto HMAC-SHA-256.
- Do not commit real API keys, passwords, JWT secrets, Cloudflare API tokens, D1 database IDs, R2 bucket names, or production data.
- Standard Cloudflare deployment uses `AUTH_MODE=standard`.
- Local development can use `AUTH_MODE=local` with `DEV_USER_EMAIL`.
- Every code-changing task must keep changes scoped to the listed files.
- Final verification must run `npm run lint` and `npm test`; if either cannot run, capture the exact reason.

---

## File Structure

- `app/lib/auth-token.ts`: Pure Web Crypto helpers for signing and verifying standard auth JWTs.
- `app/lib/platform-store.ts`: Runtime identity mode selection and API authorization source of truth.
- `app/api/v1/auth/login/route.ts`: Standard mode password login endpoint.
- `app/api/v1/auth/logout/route.ts`: Session cookie clearing endpoint.
- `app/api/v1/auth/session/route.ts`: Runtime auth mode and current session endpoint.
- `app/dashboard.tsx`: Minimal login and logout UI for standard mode only.
- `cloudflare-env.d.ts`: Worker binding and environment variable typing.
- `vite.config.ts`: Select `wrangler.chatgpt.toml` by default and `wrangler.toml` for the standard deploy target.
- `wrangler.chatgpt.toml`: Default/Sites-compatible bindings without `AUTH_MODE=standard`.
- `wrangler.toml`: Standard Cloudflare Workers configuration.
- `scripts/build-standard.mjs`: Cross-platform standard-target build launcher.
- `scripts/render-wrangler-config.mjs`: CI validation and standard config renderer.
- `.env.example`: Safe local environment template.
- `.github/workflows/deploy.yml`: GitHub Actions deployment workflow.
- `AGENTS.md`: Project-local collaboration, branch, PR, verification, and secret handling rules.
- `tests/rendered-html.test.mjs`: Static regression tests for deployment/auth configuration.
- `docs/superpowers/plans/2026-07-27-cloudflare-standard-deploy.md`: This implementation plan.

## Final Review Amendments

The final whole-branch review adds these requirements to the original task sequence:

- Default builds must preserve ChatGPT/Sites auth semantics; only `build:standard` selects `AUTH_MODE=standard`.
- CI must render D1, R2, and administrator values before verification, fail on missing/placeholders, and upload `ADMIN_PASSWORD` plus `JWT_SECRET` as Worker Secrets.
- JWT helpers require Node behavior tests for valid, expired, malformed, and invalid-signature tokens.
- Standard login requires isolate-local best-effort throttling, while production documentation requires Cloudflare WAF Rate Limiting or Cloudflare Access.
- Malformed percent-encoded session cookies must fail closed as unauthenticated.

---

### Task 1: Add standard JWT helper module

**Files:**
- Create: `app/lib/auth-token.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Produces: `type StandardSession = { email: string; displayName: string; iat: number; exp: number }`
- Produces: `createSessionToken(session: StandardSession, secret: string): Promise<string>`
- Produces: `verifySessionToken(token: string, secret: string, nowSeconds?: number): Promise<StandardSession | null>`
- Produces: `sessionCookieName = "wenqu_session"`

- [ ] **Step 1: Write the failing static regression test**

Append this test to `tests/rendered-html.test.mjs`:

```javascript
test("standard auth token helpers use Web Crypto without new dependencies", async () => {
  const token = await read("app/lib/auth-token.ts");
  const pkg = JSON.parse(await read("package.json"));
  assert.match(token, /export type StandardSession/);
  assert.match(token, /export const sessionCookieName = "wenqu_session"/);
  assert.match(token, /export async function createSessionToken/);
  assert.match(token, /export async function verifySessionToken/);
  assert.match(token, /crypto\.subtle\.sign/);
  assert.match(token, /crypto\.subtle\.verify/);
  assert.doesNotMatch(JSON.stringify(pkg.dependencies), /jose|jsonwebtoken/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
rtk proxy npm test
```

Expected: FAIL because `app/lib/auth-token.ts` does not exist.

- [ ] **Step 3: Create the minimal JWT helper implementation**

Create `app/lib/auth-token.ts`:

```typescript
export type StandardSession = {
  email: string;
  displayName: string;
  iat: number;
  exp: number;
};

export const sessionCookieName = "wenqu_session";

const encoder = new TextEncoder();

function base64UrlEncode(input: Uint8Array | string) {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
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

async function importSigningKey(secret: string) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function decodeJson<T>(value: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlDecode(value))) as T;
  } catch {
    return null;
  }
}

export async function createSessionToken(session: StandardSession, secret: string) {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(JSON.stringify(session));
  const key = await importSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra) return null;
  const decodedHeader = decodeJson<{ alg?: string; typ?: string }>(header);
  if (decodedHeader?.alg !== "HS256" || decodedHeader.typ !== "JWT") return null;
  const session = decodeJson<StandardSession>(payload);
  if (!session || !session.email || !session.displayName || !Number.isFinite(session.iat) || !Number.isFinite(session.exp)) return null;
  if (session.exp <= nowSeconds) return null;
  const key = await importSigningKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, base64UrlDecode(signature), encoder.encode(`${header}.${payload}`));
  return valid ? session : null;
}
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
rtk proxy npm test
```

Expected: PASS for the new static token helper assertions and existing tests.

- [ ] **Step 5: Commit**

Run:

```powershell
rtk git add app/lib/auth-token.ts tests/rendered-html.test.mjs
rtk git commit -m "feat: 添加标准登录令牌工具"
```

---

### Task 2: Extend platform identity resolution

**Files:**
- Modify: `app/lib/platform-store.ts`
- Modify: `cloudflare-env.d.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `verifySessionToken(token, secret, nowSeconds?)`
- Consumes: `sessionCookieName`
- Produces: `type AuthMode = "chatgpt" | "standard" | "local"`
- Produces: `getAuthMode(): AuthMode`
- Produces: `identity(request: Request): Promise<{ email: string; displayName: string }>`

- [ ] **Step 1: Write the failing static regression test**

Append this test to `tests/rendered-html.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
rtk proxy npm test
```

Expected: FAIL because `AuthMode`, `getAuthMode`, and standard token verification are not wired.

- [ ] **Step 3: Update Worker environment typing**

Modify `cloudflare-env.d.ts` module declaration to include optional vars:

```typescript
declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    CONTENT: R2Bucket;
    AUTH_MODE?: "chatgpt" | "standard" | "local";
    ADMIN_EMAIL?: string;
    ADMIN_DISPLAY_NAME?: string;
    ADMIN_PASSWORD?: string;
    JWT_SECRET?: string;
    JWT_TTL_SECONDS?: string;
    DEV_USER_EMAIL?: string;
    AI_API_KEY?: string;
    SPEECH_API_KEY?: string;
    MODERATION_API_KEY?: string;
    [key: string]: unknown;
  };
}
```

- [ ] **Step 4: Update `platform-store.ts` imports and auth mode helpers**

Add imports:

```typescript
import { sessionCookieName, verifySessionToken } from "./auth-token";
```

Add this exported type and helper near the top of `platform-store.ts`:

```typescript
export type AuthMode = "chatgpt" | "standard" | "local";

export function getAuthMode(): AuthMode {
  const configured = (env as unknown as { AUTH_MODE?: string }).AUTH_MODE?.trim().toLowerCase();
  if (configured === "chatgpt" || configured === "standard" || configured === "local") return configured;
  return process.env.NODE_ENV === "development" ? "local" : "chatgpt";
}
```

- [ ] **Step 5: Replace `identity(request)` with async multi-mode logic**

Replace the existing `identity(request: Request)` with:

```typescript
function chatGptIdentity(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!email) throw new Error("authentication_required");
  let displayName = email.split("@")[0];
  const encoded = request.headers.get("oai-authenticated-user-full-name");
  if (encoded && request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { displayName = decodeURIComponent(encoded); } catch { /* fall back to email prefix */ }
  }
  return { email, displayName };
}

function localIdentity(request: Request) {
  const bindings = env as unknown as { DEV_USER_EMAIL?: string };
  const email = request.headers.get("x-wenqu-dev-user")?.trim().toLowerCase()
    ?? bindings.DEV_USER_EMAIL?.trim().toLowerCase()
    ?? process.env.DEV_USER_EMAIL?.trim().toLowerCase()
    ?? "dev@wenqu.local";
  return { email, displayName: email.split("@")[0] };
}

function tokenFromRequest(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  const cookie = request.headers.get("Cookie") ?? "";
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName}=`));
  return match ? decodeURIComponent(match.slice(sessionCookieName.length + 1)) : "";
}

async function standardIdentity(request: Request) {
  const bindings = env as unknown as { JWT_SECRET?: string };
  if (!bindings.JWT_SECRET) throw new Error("authentication_config_missing");
  const token = tokenFromRequest(request);
  if (!token) throw new Error("authentication_required");
  const session = await verifySessionToken(token, bindings.JWT_SECRET);
  if (!session) throw new Error("authentication_required");
  return { email: session.email.trim().toLowerCase(), displayName: session.displayName };
}

async function identity(request: Request) {
  const mode = getAuthMode();
  if (mode === "standard") return standardIdentity(request);
  if (mode === "local") return localIdentity(request);
  return chatGptIdentity(request);
}
```

- [ ] **Step 6: Await identity inside `platformContext()`**

Change:

```typescript
const { email, displayName } = identity(request);
```

to:

```typescript
const { email, displayName } = await identity(request);
```

- [ ] **Step 7: Extend API error status mapping**

Change `platformApiError()` status mapping to:

```typescript
const status = message === "authentication_required"
  ? 401
  : message === "forbidden"
    ? 403
    : message === "authentication_config_missing"
      ? 500
      : 500;
```

Keep the existing server-side `console.error` behavior for status `>= 500`.

- [ ] **Step 8: Run tests**

Run:

```powershell
rtk proxy npm test
```

Expected: PASS.

- [ ] **Step 9: Commit**

Run:

```powershell
rtk git add app/lib/platform-store.ts cloudflare-env.d.ts tests/rendered-html.test.mjs
rtk git commit -m "feat: 支持多认证模式身份解析"
```

---

### Task 3: Add standard auth API routes

**Files:**
- Create: `app/api/v1/auth/login/route.ts`
- Create: `app/api/v1/auth/logout/route.ts`
- Create: `app/api/v1/auth/session/route.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `createSessionToken(session, secret)`
- Consumes: `sessionCookieName`
- Consumes: `getAuthMode()`
- Consumes: `platformContext(request)`
- Produces: `POST /api/v1/auth/login`
- Produces: `POST /api/v1/auth/logout`
- Produces: `GET /api/v1/auth/session`

- [ ] **Step 1: Write the failing static regression test**

Append this test to `tests/rendered-html.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
rtk proxy npm test
```

Expected: FAIL because auth route files do not exist.

- [ ] **Step 3: Create login route**

Create `app/api/v1/auth/login/route.ts`:

```typescript
import { env } from "cloudflare:workers";
import { createSessionToken, sessionCookieName } from "../../../../lib/auth-token";
import { getAuthMode } from "../../../../lib/platform-store";

function json(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function cookieValue(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

export async function POST(request: Request) {
  if (getAuthMode() !== "standard") return json("auth_mode_not_standard", 404);
  const bindings = env as unknown as { ADMIN_EMAIL?: string; ADMIN_DISPLAY_NAME?: string; ADMIN_PASSWORD?: string; JWT_SECRET?: string; JWT_TTL_SECONDS?: string };
  if (!bindings.ADMIN_EMAIL || !bindings.ADMIN_PASSWORD || !bindings.JWT_SECRET) return json("authentication_config_missing", 500);
  const payload = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  const email = typeof payload?.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (email !== bindings.ADMIN_EMAIL.trim().toLowerCase() || password !== bindings.ADMIN_PASSWORD) return json("invalid_credentials", 401);
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number.parseInt(bindings.JWT_TTL_SECONDS ?? "604800", 10);
  const maxAge = Number.isFinite(ttl) && ttl > 0 ? ttl : 604800;
  const displayName = bindings.ADMIN_DISPLAY_NAME?.trim() || email.split("@")[0];
  const token = await createSessionToken({ email, displayName, iat: now, exp: now + maxAge }, bindings.JWT_SECRET);
  return Response.json({ user: { email, displayName } }, {
    status: 200,
    headers: { "cache-control": "no-store", "set-cookie": cookieValue(token, maxAge) },
  });
}
```

- [ ] **Step 4: Create logout route**

Create `app/api/v1/auth/logout/route.ts`:

```typescript
import { sessionCookieName } from "../../../../lib/auth-token";

export async function POST() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json({ ok: true }, {
    headers: {
      "cache-control": "no-store",
      "set-cookie": `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    },
  });
}
```

- [ ] **Step 5: Create session route**

Create `app/api/v1/auth/session/route.ts`:

```typescript
import { getAuthMode, platformContext } from "../../../../lib/platform-store";

export async function GET(request: Request) {
  const authMode = getAuthMode();
  try {
    const context = await platformContext(request);
    return Response.json({
      authenticated: true,
      authMode,
      user: { email: context.userEmail, displayName: context.displayName, roles: context.roles },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unexpected_error";
    const status = message === "authentication_required" ? 200 : 500;
    return Response.json({ authenticated: false, authMode, error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```powershell
rtk proxy npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
rtk git add app/api/v1/auth/login/route.ts app/api/v1/auth/logout/route.ts app/api/v1/auth/session/route.ts tests/rendered-html.test.mjs
rtk git commit -m "feat: 添加标准登录接口"
```

---

### Task 4: Add standard login/logout UI

**Files:**
- Modify: `app/dashboard.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `POST /api/v1/auth/login`
- Consumes: `POST /api/v1/auth/logout`
- Consumes: `GET /api/v1/auth/session`
- Produces: dashboard standard login form state.

- [ ] **Step 1: Write the failing static regression test**

Append this test to `tests/rendered-html.test.mjs`:

```javascript
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
rtk proxy npm test
```

Expected: FAIL because dashboard has no standard login flow.

- [ ] **Step 3: Add dashboard auth state**

Inside `Dashboard()` add state:

```typescript
const [authMode, setAuthMode] = useState<"chatgpt" | "standard" | "local" | null>(null);
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
const [loginBusy, setLoginBusy] = useState(false);
```

- [ ] **Step 4: Add session mode detection helper**

Add inside `Dashboard()`:

```typescript
async function loadAuthMode() {
  const response = await fetch("/api/v1/auth/session", { cache: "no-store" });
  const payload = await response.json() as { authMode?: "chatgpt" | "standard" | "local" };
  setAuthMode(payload.authMode ?? null);
  return payload.authMode ?? null;
}
```

- [ ] **Step 5: Update existing initial fetch catch block**

Replace the current `.catch((reason: Error) => { if (active) setError(reason.message); })` branch with:

```typescript
.catch(async (reason: Error) => {
  if (!active) return;
  const mode = await loadAuthMode().catch(() => null);
  setError(mode === "standard" ? "请使用管理员账号登录" : reason.message);
})
```

- [ ] **Step 6: Add login and logout handlers**

Add inside `Dashboard()`:

```typescript
async function login(event: React.FormEvent) {
  event.preventDefault();
  setLoginBusy(true);
  setError("");
  try {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error ?? "登录失败");
    setPassword("");
    setLoading(true);
    await refresh();
  } catch (reason) {
    setError(reason instanceof Error ? reason.message : "登录失败");
  } finally {
    setLoading(false);
    setLoginBusy(false);
  }
}

async function logout() {
  await fetch("/api/v1/auth/logout", { method: "POST" });
  setData(null);
  setAuthMode("standard");
  setError("已退出登录");
}
```

- [ ] **Step 7: Render standard login panel**

Before the existing generic error return, add:

```tsx
if ((error || !data) && authMode === "standard") return <main className="center-state"><form className="login-card" onSubmit={login}><span className="eyebrow">标准 Cloudflare 登录</span><h1>进入文趣工作区</h1><p>使用部署时配置的管理员邮箱和密码登录。</p><label>邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" required /></label><label>密码<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={loginBusy}>{loginBusy ? "登录中…" : "登录"}</button></form></main>;
```

- [ ] **Step 8: Add logout button in top actions**

Inside `.top-actions`, after the profile block, add:

```tsx
{authMode === "standard" && <button type="button" className="logout-button" onClick={logout}>退出</button>}
```

- [ ] **Step 9: Add minimal CSS**

Append to `app/globals.css`:

```css
.login-card{width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:22px;padding:28px;box-shadow:var(--shadow);display:grid;gap:14px;text-align:left}.login-card h1{font-family:serif;margin:4px 0;font-size:28px}.login-card p{margin:0;color:#728079;font-size:12px;line-height:1.7}.login-card label{display:grid;gap:6px;font-size:11px;color:#65756f;font-weight:700}.login-card input{border:1px solid var(--line);background:#faf8f3;border-radius:10px;padding:11px;color:var(--ink)}.form-error{color:#b84632!important;background:#fff0ea;border:1px solid #f1c6b8;border-radius:10px;padding:10px}.logout-button{border:0;background:#f3eee5;color:#576b63;border-radius:10px;padding:8px 10px;font-size:10px}
```

- [ ] **Step 10: Run tests**

Run:

```powershell
rtk proxy npm test
```

Expected: PASS.

- [ ] **Step 11: Commit**

Run:

```powershell
rtk git add app/dashboard.tsx app/globals.css tests/rendered-html.test.mjs
rtk git commit -m "feat: 添加标准部署登录界面"
```

---

### Task 5: Add Cloudflare deployment config, CI, env docs, and project AGENTS

**Files:**
- Create: `wrangler.toml`
- Create: `.github/workflows/deploy.yml`
- Create: `AGENTS.md`
- Modify: `vite.config.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: Cloudflare Vite plugin `cloudflare({ configPath: "./wrangler.toml" })`
- Produces: `npm run cf:preview`
- Produces: `npm run cf:deploy`
- Produces: standard Worker binding names `DB` and `CONTENT`

- [ ] **Step 1: Write the failing static regression test**

Append this test to `tests/rendered-html.test.mjs`:

```javascript
test("standard cloudflare deployment configuration is present and secret-safe", async () => {
  const [wrangler, workflow, envExample, pkgRaw, vite, agents] = await Promise.all([
    read("wrangler.toml"),
    read(".github/workflows/deploy.yml"),
    read(".env.example"),
    read("package.json"),
    read("vite.config.ts"),
    read("AGENTS.md"),
  ]);
  const pkg = JSON.parse(pkgRaw);
  assert.equal(pkg.scripts["cf:preview"], "npm run build && npx wrangler dev");
  assert.equal(pkg.scripts["cf:deploy"], "npm run build && npx wrangler deploy");
  assert.match(wrangler, /main = "worker\/index\.ts"/);
  assert.match(wrangler, /binding = "DB"/);
  assert.match(wrangler, /binding = "CONTENT"/);
  assert.match(wrangler, /AUTH_MODE = "standard"/);
  assert.match(wrangler, /required = \["ADMIN_PASSWORD", "JWT_SECRET"\]/);
  assert.doesNotMatch(wrangler, /ADMIN_PASSWORD =|JWT_SECRET =|CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /cloudflare\/wrangler-action@v3/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(envExample, /AUTH_MODE=standard/);
  assert.match(envExample, /JWT_SECRET=/);
  assert.doesNotMatch(envExample, /sk-|eyJ|-----BEGIN|password123/);
  assert.match(vite, /configPath: "\.\/wrangler\.toml"/);
  assert.match(agents, /feature 分支/);
  assert.match(agents, /PR/);
  assert.match(agents, /AUTH_MODE=standard/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
rtk proxy npm test
```

Expected: FAIL because deployment config files and scripts are not present.

- [ ] **Step 3: Create `wrangler.toml`**

Create `wrangler.toml`:

```toml
name = "wenqu-chinese-learning-platform"
main = "worker/index.ts"
compatibility_date = "2026-05-15"
compatibility_flags = ["nodejs_compat"]

[vars]
AUTH_MODE = "standard"
ADMIN_EMAIL = "admin@example.com"
JWT_TTL_SECONDS = "604800"

[[d1_databases]]
binding = "DB"
database_name = "wenqu-platform-db"
database_id = "00000000-0000-4000-8000-000000000000"

[[r2_buckets]]
binding = "CONTENT"
bucket_name = "wenqu-platform-content"

[secrets]
required = ["ADMIN_PASSWORD", "JWT_SECRET"]
```

- [ ] **Step 4: Update `vite.config.ts` to read `wrangler.toml`**

Remove the `hostingConfig` import, `SITE_CREATOR_PLACEHOLDER_DATABASE_ID`, `d1`, `r2`, and `localBindingConfig`. Keep `sites()` packaging. Change the Cloudflare plugin call to:

```typescript
cloudflare({
  viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
  configPath: "./wrangler.toml",
}),
```

- [ ] **Step 5: Add package scripts**

Modify `package.json` scripts:

```json
"cf:preview": "npm run build && npx wrangler dev",
"cf:deploy": "npm run build && npx wrangler deploy"
```

- [ ] **Step 6: Expand `.env.example`**

Replace `.env.example` content with:

```dotenv
# Auth mode:
# - local: local development identity fallback
# - chatgpt: ChatGPT Platform Sites authenticated headers
# - standard: standard Cloudflare Workers password login
AUTH_MODE=standard

# Standard Cloudflare login identity. Use a real administrator email in deployed environments.
ADMIN_EMAIL=admin@example.com
ADMIN_DISPLAY_NAME=文趣管理员

# Store real values as Cloudflare Secrets or local ignored files.
ADMIN_PASSWORD=
JWT_SECRET=
JWT_TTL_SECONDS=604800

# Optional local-only identity for AUTH_MODE=local.
DEV_USER_EMAIL=developer@wenqu.local

# Cloudflare resource identifiers for operators. Do not commit real account-specific values.
CF_ACCOUNT_ID=
D1_DATABASE_ID=
R2_BUCKET_NAME=wenqu-platform-content

# Optional provider configuration. The platform works without these keys and
# clearly falls back to sourced templates / manual speech review.
AI_API_KEY=
SPEECH_API_KEY=
MODERATION_API_KEY=
```

- [ ] **Step 7: Create GitHub Actions workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Verify
        run: npm test

      - name: Deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

- [ ] **Step 8: Create project `AGENTS.md`**

Create `AGENTS.md`:

```markdown
# AGENTS.md

## 项目协作规则

- 默认在 feature 分支开发，通过 PR 合并到 `main`。
- 不在 `main` 上直接做较大实现；紧急小修也要保持提交范围清晰。
- Commit message 使用中文。
- 修改认证、部署、D1/R2、API 权限或数据持久化逻辑后，至少运行 `npm test`；可行时同时运行 `npm run lint`。

## 部署规则

- ChatGPT Platform Sites 继续使用 `.openai/hosting.json`，不要删除该文件。
- 标准 Cloudflare Workers 部署使用 `AUTH_MODE=standard`。
- `DB` 是 D1 binding，`CONTENT` 是 R2 binding。
- `ADMIN_PASSWORD`、`JWT_SECRET`、`CLOUDFLARE_API_TOKEN`、真实 D1 database id 和真实 R2 bucket 名称不得提交。
- GitHub Actions 部署前必须先执行 `npm test`。

## 本地开发

- Node.js 版本要求为 `>=22.13.0`。
- 本地开发可使用 `AUTH_MODE=local` 和 `DEV_USER_EMAIL`。
- 标准登录本地预览可复制 `.env.example` 到 `.env.local` 或使用 Wrangler 本地变量文件，并填入本机专用测试密码和 JWT secret。
- `.wrangler/`、`.env*`、`node_modules/` 和构建产物不得提交。
```

- [ ] **Step 9: Run tests**

Run:

```powershell
rtk proxy npm test
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```powershell
rtk git add wrangler.toml .github/workflows/deploy.yml AGENTS.md vite.config.ts package.json .env.example tests/rendered-html.test.mjs
rtk git commit -m "chore: 添加标准 Cloudflare 部署配置"
```

---

### Task 6: Final verification and PR handoff

**Files:**
- Modify only files required by verification findings from Tasks 1-5.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: clean feature branch ready for PR.

- [ ] **Step 1: Inspect branch and changed files**

Run:

```powershell
rtk git status --short
rtk git log --oneline -8
rtk git diff --stat main...HEAD
```

Expected: working tree clean; commits include design, auth, UI, deployment config, and project AGENTS update.

- [ ] **Step 2: Run lint**

Run:

```powershell
rtk proxy npm run lint
```

Expected: PASS.

- [ ] **Step 3: Run full test**

Run:

```powershell
rtk proxy npm test
```

Expected: PASS with build success and Node test success.

- [ ] **Step 4: Inspect build output config**

Run:

```powershell
Get-Content -LiteralPath 'dist/server/wrangler.json'
```

Expected:

- JSON contains D1 binding `DB`.
- JSON contains R2 binding `CONTENT`.
- JSON contains `AUTH_MODE` var.
- JSON contains `assets.directory` pointing to client build output.

- [ ] **Step 5: Prepare PR summary**

Use this PR summary:

```markdown
## Summary
- Added standard Cloudflare Workers auth mode with password login and HttpOnly JWT session cookie / 新增标准 Cloudflare Workers 认证模式，支持密码登录和 HttpOnly JWT 会话 Cookie
- Added Wrangler config, deployment scripts, GitHub Actions workflow, and safe environment template / 新增 Wrangler 配置、部署脚本、GitHub Actions 工作流和安全环境示例
- Added project AGENTS.md with branch, PR, verification, and secret handling rules / 新增项目 AGENTS.md，记录分支、PR、验证和密钥处理规则

## Verification
- `npm run lint`
- `npm test`
```

- [ ] **Step 6: Stop before external writes**

Do not push the branch or open the PR unless the user explicitly confirms remote operations. Report the branch name, latest commit, verification output, and PR summary.
