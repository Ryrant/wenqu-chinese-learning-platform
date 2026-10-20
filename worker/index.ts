import api from "../server/app";
import { createCloudflareRuntime, type CloudflareRuntimeEnv } from "../app/lib/platform-runtime-cloudflare";
import { setPlatformRuntime } from "../app/lib/platform-runtime";

export default {
  fetch(request: Request, env: CloudflareRuntimeEnv) {
    setPlatformRuntime(createCloudflareRuntime(env));
    return api.fetch(request);
  },
};
