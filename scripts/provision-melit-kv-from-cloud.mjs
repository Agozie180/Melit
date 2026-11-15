#!/usr/bin/env node
/**
 * Provision Upstash Redis for melit from a Cursor Cloud Agent (no local laptop).
 * Requires MELIT_VERCEL_CLI_TOKEN (Vercel personal token with team access).
 *
 *   node scripts/provision-melit-kv-from-cloud.mjs
 *   node scripts/provision-melit-kv-from-cloud.mjs --dry-run
 */
import process from "node:process";

const TEAM_ID = process.env.MELIT_VERCEL_TEAM_ID ?? "team_gL6KJhLMNRgrqmUkCGgLbBSS";
const PROJECT_ID = process.env.MELIT_VERCEL_PROJECT_ID ?? "prj_0hmGltULIH91T3WbPdGpkR2ujyu5";
const ICFG = process.env.MELIT_UPSTASH_INSTALLATION_ID ?? "icfg_yB98reqy9QEUYel27ixJAU8B";
const PRODUCT = "upstash-kv";
const STORE_NAME = process.env.MELIT_KV_NAME ?? "melit-kv";
const REGION = process.env.MELIT_KV_REGION ?? "iad1";
/** Upstash via Vercel: pay-as-you-go (first DBs free tier on vendor side). */
const BILLING_PLAN = process.env.MELIT_UPSTASH_BILLING_PLAN ?? "paid";

const dryRun = process.argv.includes("--dry-run");

function token() {
  const t = process.env.MELIT_VERCEL_CLI_TOKEN?.trim();
  if (!t) {
    console.error("Set MELIT_VERCEL_CLI_TOKEN (Vercel account token).");
    process.exit(1);
  }
  return t;
}

async function vercelFetch(path, { method = "GET", body } = {}) {
  const url = new URL(path, "https://api.vercel.com");
  url.searchParams.set("teamId", TEAM_ID);
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    console.error(`HTTP ${res.status} ${method} ${path}`);
    console.error(typeof data === "string" ? data : JSON.stringify(data, null, 2));
    process.exit(1);
  }
  return data;
}

function resourceIdFromStore(store) {
  return (
    store?.id ??
    store?.externalResourceId ??
    store?.product?.resourceId ??
    store?.product?.id
  );
}

async function main() {
  const createBody = {
    name: STORE_NAME,
    integrationConfigurationId: ICFG,
    integrationProductIdOrSlug: PRODUCT,
    metadata: { primaryRegion: REGION, eviction: true },
    source: "cli",
    billingPlanId: BILLING_PLAN,
  };

  console.log("Creating Upstash KV store on team", TEAM_ID, dryRun ? "(dry-run)" : "...");
  if (dryRun) {
    console.log(JSON.stringify(createBody, null, 2));
    return;
  }

  const created = await vercelFetch("/v1/storage/stores/integration/direct", {
    method: "POST",
    body: createBody,
  });
  const store = created?.store ?? created;
  const resourceId = resourceIdFromStore(store);
  if (!resourceId) {
    console.error("Created store but could not find resource id:", JSON.stringify(created, null, 2));
    process.exit(1);
  }
  console.log("Store created; resource id:", resourceId, "status:", store?.status);

  const connectBody = {
    projectId: PROJECT_ID,
    envVarEnvironments: ["production", "preview", "development"],
    makeEnvVarsSensitive: true,
  };
  console.log("Connecting to project", PROJECT_ID, "...");
  const connected = await vercelFetch(
    `/v1/integrations/installations/${ICFG}/resources/${resourceId}/connections`,
    { method: "POST", body: connectBody },
  );
  console.log("Connected:", JSON.stringify(connected, null, 2));
  console.log("Done. Redeploy melit production so Functions pick up KV_REST_* / UPSTASH_REDIS_*.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});