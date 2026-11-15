#!/usr/bin/env node
// Provision Upstash for Redis for the Melit Vercel project (creates KV_REST_* or UPSTASH_* env vars).
// Run locally after `vercel login` and `vercel link --project melit`.
//
//   node scripts/provision-melit-upstash.mjs
//   node scripts/provision-melit-upstash.mjs --dry-run

import { execFileSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const region = process.env.MELIT_KV_REGION ?? "iad1";

const steps = [
  ["vercel", ["link", "--project", "melit", "--yes"]],
  [
    "vercel",
    [
      "integration",
      "add",
      "upstash-kv",
      "--yes",
      `--metadata`,
      JSON.stringify({ primaryRegion: region }),
    ],
  ],
  ["vercel", ["integration", "resource", "connect", "melit-kv", "melit"]],
];

for (const [bin, args] of steps) {
  console.log(`$ ${bin} ${args.join(" ")}`);
  if (!dryRun) {
    try {
      execFileSync(bin, args, { stdio: "inherit", shell: false });
    } catch (err) {
      console.error(String(err));
      process.exit(1);
    }
  }
}
console.log(dryRun ? "Dry run only." : "Done. Redeploy production so Functions pick up KV_REST_* / UPSTASH_REDIS_*.");