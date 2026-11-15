#!/usr/bin/env node
/**
 * Copy Upstash/KV credentials from the environment or .env.local into the melit Vercel project.
 * Does not provision storage — only syncs vars Melit already understands (see lib/server/kv.ts).
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEAM_ID = process.env.MELIT_VERCEL_TEAM_ID ?? "team_gL6KJhLMNRgrqmUkCGgLbBSS";
const PROJECT_ID = process.env.MELIT_VERCEL_PROJECT_ID ?? "prj_0hmGltULIH91T3WbPdGpkR2ujyu5";
const KEYS = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];
const dryRun = process.argv.includes("--dry-run");

function loadDotenv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env) || process.env[k] === "") process.env[k] = v;
  }
}

loadDotenv(join(process.cwd(), ".env.local"));
loadDotenv(join(process.cwd(), ".env"));

function token() {
  const t = process.env.MELIT_VERCEL_CLI_TOKEN?.trim();
  if (!t) {
    console.error("Missing MELIT_VERCEL_CLI_TOKEN.");
    process.exit(1);
  }
  return t;
}

function pairToSync() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return [
      { key: "KV_REST_API_URL", value: process.env.KV_REST_API_URL },
      { key: "KV_REST_API_TOKEN", value: process.env.KV_REST_API_TOKEN },
    ];
  }
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return [
      { key: "UPSTASH_REDIS_REST_URL", value: process.env.UPSTASH_REDIS_REST_URL },
      { key: "UPSTASH_REDIS_REST_TOKEN", value: process.env.UPSTASH_REDIS_REST_TOKEN },
    ];
  }
  return null;
}

async function upsertEnv(key, value) {
  const url = new URL(`https://api.vercel.com/v10/projects/${PROJECT_ID}/env`);
  url.searchParams.set("teamId", TEAM_ID);
  url.searchParams.set("upsert", "true");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      value,
      type: "sensitive",
      target: ["production", "preview"],
      comment: "Upstash Redis for Melit ledger + rate limits (synced from agent)",
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`Failed ${key}:`, JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(`OK ${key}`);
}

async function main() {
  const pair = pairToSync();
  if (!pair) {
    console.error(
      "Need KV_REST_API_URL + KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in env or .env.local",
    );
    process.exit(1);
  }
  if (dryRun) {
    console.log("Would upsert:", pair.map((p) => p.key).join(", "));
    return;
  }
  for (const { key, value } of pair) await upsertEnv(key, value);
  console.log("Done. Redeploy melit production so functions load the new vars.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});