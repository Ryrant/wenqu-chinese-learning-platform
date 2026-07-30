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
