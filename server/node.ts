import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { serveStatic } from "@hono/node-server/serve-static";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./app";
import { installNodeRuntime } from "../lib/platform-runtime-node";

process.env.NODE_ENV ??= "production";
await installNodeRuntime();
const app = createApiApp({ remoteAddress: (context) => getConnInfo(context).remote.address });
const publicRoot = fileURLToPath(new URL("../client/", import.meta.url));
app.use("/*", serveStatic({ root: publicRoot }));
app.get("*", serveStatic({ root: publicRoot, path: "index.html" }));
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";
serve({ fetch: app.fetch, port, hostname }, ({ port }) => {
  console.log(`华文知行已启动：http://${hostname}:${port}`);
});
