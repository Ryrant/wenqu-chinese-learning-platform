import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const requiredVariables = ["D1_DATABASE_ID", "R2_BUCKET_NAME", "ADMIN_EMAIL"];
const values = Object.fromEntries(requiredVariables.map((name) => [name, process.env[name]?.trim() ?? ""]));

function isPlaceholder(name, value) {
  if (!value || /placeholder|replace[-_ ]?with|your[-_ ]/i.test(value)) return true;
  if (name === "D1_DATABASE_ID") return value === "00000000-0000-4000-8000-000000000000";
  return /@example\.(com|org|net|invalid)$/i.test(value);
}

const invalid = requiredVariables.filter((name) => isPlaceholder(name, values[name]));
if (invalid.length) {
  console.error(`Missing or placeholder deployment variables: ${invalid.join(", ")}`);
  process.exit(1);
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(values.D1_DATABASE_ID)) {
  console.error("D1_DATABASE_ID must be a valid D1 UUID.");
  process.exit(1);
}
if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(values.R2_BUCKET_NAME)) {
  console.error("R2_BUCKET_NAME must be a valid lowercase R2 bucket name.");
  process.exit(1);
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ADMIN_EMAIL)) {
  console.error("ADMIN_EMAIL must be a valid email address.");
  process.exit(1);
}

const configPath = resolve(process.cwd(), "wrangler.toml");
let config = await readFile(configPath, "utf8");

function replaceConfigValue(pattern, value, name) {
  if (!pattern.test(config)) {
    console.error(`Unable to locate ${name} in wrangler.toml.`);
    process.exit(1);
  }
  config = config.replace(pattern, `$1${JSON.stringify(value)}`);
}

replaceConfigValue(/^(\s*ADMIN_EMAIL\s*=\s*).*$/m, values.ADMIN_EMAIL, "ADMIN_EMAIL");
replaceConfigValue(/^(\s*database_id\s*=\s*).*$/m, values.D1_DATABASE_ID, "database_id");
replaceConfigValue(/^(\s*bucket_name\s*=\s*).*$/m, values.R2_BUCKET_NAME, "bucket_name");

await writeFile(configPath, config, "utf8");
console.log("Rendered wrangler.toml from validated deployment variables.");
