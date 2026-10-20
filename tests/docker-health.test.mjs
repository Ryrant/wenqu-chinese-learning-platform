import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const checkScript = fileURLToPath(new URL("../scripts/check-docker-health.mjs", import.meta.url));

test("Docker health check rejects degraded HTTP 200 and failed responses", async (t) => {
  let statusCode = 200;
  let body = JSON.stringify({ status: "ok" });
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/v1/health");
    response.writeHead(statusCode, { "content-type": "application/json", connection: "close" });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const check = () => execFileAsync(process.execPath, [checkScript], {
    env: { ...process.env, PORT: String(server.address().port) },
    timeout: 10000,
  });

  await check();
  body = JSON.stringify({ status: "degraded" });
  await assert.rejects(check(), (error) => error.code === 1 && /status_degraded/.test(error.stderr));
  statusCode = 503;
  body = JSON.stringify({ status: "ok" });
  await assert.rejects(check(), (error) => error.code === 1 && /http_503/.test(error.stderr));
  statusCode = 200;
  body = "invalid json";
  await assert.rejects(check(), (error) => error.code === 1 && /docker_health_check_failed/.test(error.stderr));
});
