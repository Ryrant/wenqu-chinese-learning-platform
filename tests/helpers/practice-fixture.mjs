import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({ stdin: { contents: `
  export { NodeSqliteDatabase } from './lib/platform-runtime-node';
  export { setPlatformRuntime } from './lib/platform-runtime';
  export { ensurePlatformSchema, ensureSiteJwtSecret } from './lib/platform-store';
  export { createSessionToken } from './lib/auth-token';
  export { createApiApp } from './server/app';
  export { dialogueTemplates } from './lib/dialogue-types';
  export { readingLessons, suggestedReadingTerms, missingReadingCharacters, createReadingQuiz } from './lib/reading-lessons';
`, resolveDir: fileURLToPath(new URL("../../", import.meta.url)) }, bundle: true, platform: "node", format: "esm", target: "node22", write: false });
export const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

export async function practiceFixture(t) {
  const db = new api.NodeSqliteDatabase("file::memory:");
  api.setPlatformRuntime({ kind: "node", database: db, storage: {} }); t.after(() => db.close());
  await api.ensurePlatformSchema(db);
  const people = { teacher: "teacher", colleague: "teacher", student: "student", peer: "student", foreign: "student", guardian: "guardian", temporary: "student", admin: "admin" };
  await db.batch([
    db.prepare("INSERT INTO tenants(id,name) VALUES ('school','练习学校'),('foreign-school','其他学校')"),
    ...Object.entries(people).flatMap(([id, role]) => [db.prepare("INSERT INTO users(id,email,display_name,must_change_password) VALUES (?,?,?,?)").bind(id, `${id}@practice.test`, id, id === "temporary" ? 1 : 0), db.prepare("INSERT INTO role_memberships(tenant_id,user_id,role) VALUES (?,?,?)").bind(id === "foreign" ? "foreign-school" : "school", id, role)]),
    db.prepare("INSERT INTO classes(id,tenant_id,name,level,teacher_user_id,academic_year) VALUES ('class','school','一班','A2','teacher','2026'),('other-class','school','二班','A2','colleague','2026')"),
    db.prepare("INSERT INTO enrollments(tenant_id,class_id,student_user_id) VALUES ('school','class','student'),('school','other-class','peer')"),
  ]);
  const secret = await api.ensureSiteJwtSecret(db);
  const tokens = Object.fromEntries(await Promise.all(Object.keys(people).map(async (id) => [id, await api.createSessionToken({ email: `${id}@practice.test`, displayName: id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, sessionVersion: 0 }, secret)])));
  const app = api.createApiApp();
  const request = async (person, path, body, expected = 200, method = body ? "POST" : "GET") => {
    const response = await app.fetch(new Request(`http://127.0.0.1/api/v1${path}`, { method, headers: { ...(person ? { authorization: `Bearer ${tokens[person]}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }));
    const data = await response.json(); assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`); return data;
  };
  const scenario = { action: "publish", id: crypto.randomUUID(), revision: 0, classId: "class", ...structuredClone(api.dialogueTemplates[0]), content: { ...structuredClone(api.dialogueTemplates[0].content), journey: { lessonId: api.readingLessons[0].id, characters: ["人", "天"] } } };
  const publish = (patch = {}, expected = 200) => request("teacher", "/dialogue", { ...scenario, ...patch }, expected);
  const start = async (id = crypto.randomUUID()) => (await request("student", "/journeys", { action: "start", id, scenarioId: scenario.id })).runs.find((item) => item.id === id);
  const reading = (run, id = crypto.randomUUID()) => ({ id, kind: "reading", referenceId: run?.lesson.id ?? api.readingLessons[0].id, ...(run ? { journeyRunId: run.id } : {}), answers: (run?.lesson ?? api.readingLessons[0]).terms.filter((item) => (run?.lesson ?? api.readingLessons[0]).focusWords.includes(item.word)).slice(0, 3).map((item) => ({ word: item.word, meaning: item.meaning })) });
  const writing = (run, character = "人", id = crypto.randomUUID()) => ({ id, kind: "writing", referenceId: character, ...(run ? { journeyRunId: run.id } : {}), mode: "trace", mistakes: 2, hints: 1, elapsedMs: 5200 });
  const count = async (table) => (await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count;
  return { db, request, scenario, publish, start, reading, writing, count };
}
