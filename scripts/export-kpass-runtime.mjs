#!/usr/bin/env node
// Pack ~/.kite-passport for Vercel: base64 tarball -> KPASS_RUNTIME_BUNDLE_B64 secret.
// Run locally after `npm run kite:setup` and `kpass login` on staging.

import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const workdir = process.env.KPASS_EXPORT_DIR ?? join(homedir(), ".kite-passport");
if (!existsSync(workdir)) {
  console.error(`No ${workdir}. Run npm run kite:setup first.`);
  process.exit(1);
}

const tmp = join("/tmp", `melit-kpass-${Date.now()}.tar.gz`);
execFileSync("tar", ["-czf", tmp, "-C", workdir, "."], { stdio: "inherit" });
const b64 = execFileSync("base64", ["-w0", tmp], { encoding: "utf8" });
writeFileSync("/tmp/melit-kpass-export.b64", b64);
console.log("\nAdd these Vercel environment variables (Sensitive):\n");
console.log("MELIT_KPASS=1");
console.log(`KPASS_BASE_URL=${process.env.KPASS_BASE_URL ?? "https://passport.staging.gokite.ai"}`);
console.log("SELLER_BASE_URL=https://melit.vercel.app");
console.log(`KPASS_SESSION_ID=${process.env.KPASS_SESSION_ID ?? "<from kite:setup output>"}`);
console.log("KPASS_RUNTIME_BUNDLE_B64=<contents of /tmp/melit-kpass-export.b64>");
console.log(`\nBundle size: ${b64.length} base64 chars. Full file: /tmp/melit-kpass-export.b64`);
console.log("Also set MELIT_ORDER_SECRET and OPENSERV_API_KEY to match production.");