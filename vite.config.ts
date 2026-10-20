import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(async ({ command }) => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  return {
    resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
    define: { "process.env.NODE_ENV": JSON.stringify(command === "serve" ? "development" : "production") },
    server: { host: "127.0.0.1", port: 3000 },
    plugins: [react(), cloudflare({ viteEnvironment: { name: "server" }, configPath: "./wrangler.toml" })],
  };
});
