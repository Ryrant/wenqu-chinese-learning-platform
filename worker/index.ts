import api from "../server/app";
import { createCloudflareRuntime, type CloudflareRuntimeEnv } from "../lib/platform-runtime-cloudflare";
import { setPlatformRuntime } from "../lib/platform-runtime";

export default {
  fetch(request: Request, env: CloudflareRuntimeEnv) {
    setPlatformRuntime(createCloudflareRuntime(env));
    return api.fetch(request);
  },
};
