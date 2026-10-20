import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default defineConfig([
  // 原地升级可能保留旧构建产物，不能把它们当作当前应用源码检查。
  globalIgnores(["dist/**", ".next/**", ".vinext/**", ".wrangler/**", ".wrangler-dry-run/**", "work/**", "data/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ["**/*.{ts,tsx}"], plugins: { "react-hooks": reactHooks }, rules: {
    "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn",
  } },
]);
