#!/usr/bin/env node
// Guided Kite Passport SANDBOX setup for Melit (Rail 1). Run on your own machine:
//
//   node scripts/kite-setup.mjs            # run the steps
//   node scripts/kite-setup.mjs --dry-run  # only print the kpass commands
//
// Every kpass call uses an explicit argv array (no shell). Steps that need a human (browser
// login, passkey approval) are printed, never faked. Flags verified against kpass 6.13.5.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const argValue = (name) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const scale = Number(process.env.MELIT_TESTNET_SCALE ?? "0.01");
const weeklyCapUsd = 300;
const maxTotal = +(weeklyCapUsd * scale).toFixed(6);
const maxPerTx = maxTotal;
const agentType = argValue("--agent-type") ?? process.env.KPASS_AGENT_TYPE ?? "melit";
// Kite's production backend currently answers sandbox requests as "live"; the staging backend
// serves sandbox mode (faucet, agent registration, sessions). Pass --base-url or KPASS_BASE_URL.
const baseUrl = argValue("--base-url") ?? process.env.KPASS_BASE_URL;
const agentWallet = argValue("--agent-wallet");

const bin =
  process.env.KPASS_BIN ?? (existsSync(join(homedir(), ".local", "bin", "kpass")) ? join(homedir(), ".local", "bin", "kpass") : "kpass");

function kpass(args, { allowFail = false } = {}) {
  const full = [...args, ...(baseUrl ? ["--base-url", baseUrl] : []), "--output", "json"];
  console.log(`\n$ kpass ${full.join(" ")}`);
  if (dryRun) return null;
  try {
    const out = execFileSync(bin, full, { encoding: "utf8", shell: false, stdio: ["inherit", "pipe", "pipe"] });
    const json = JSON.parse(out);
    console.log(JSON.stringify(json, null, 2).slice(0, 1500));
    return json;
  } catch (err) {
    const out = String(err.stdout ?? "");
    let json = null;
    try {
      json = JSON.parse(out);
    } catch {}
    console.log(json ? JSON.stringify(json, null, 2).slice(0, 1500) : out || String(err.message));
    if (!allowFail) {
      console.error("\nStopped. Fix the step above and re-run this script.");
      process.exit(1);
    }
    return json;
  }
}

function findAll(obj, pred, acc = []) {
  if (obj && typeof obj === "object") {
    for (const v of Object.values(obj)) findAll(v, pred, acc);
  } else if (pred(obj)) acc.push(obj);
  return acc;
}

console.log(`Melit Kite Passport sandbox setup (weekly cap $${weeklyCapUsd} -> ${maxTotal} pieUSD at scale ${scale})`);

if (!dryRun) {
  const me = kpass(["me"], { allowFail: true });
  if (!me || me.status !== "success") {
    console.log("\nYou're not logged in. Run `kpass login` in this terminal (browser + passkey), then re-run this script.");
    process.exit(1);
  }
}

kpass(["sandbox", "on"]);
const status = kpass(["sandbox", "status"]);
if (!dryRun && !JSON.stringify(status).toLowerCase().includes("sandbox")) {
  console.error("kpass did not confirm sandbox mode. Not continuing.");
  process.exit(1);
}

const wallet = kpass(["wallet", "address"]);
const kiteWallet = Array.isArray(wallet?.wallets) ? wallet.wallets.find((w) => w.chain === "kite")?.address : undefined;
const recipient = argValue("--recipient") ?? kiteWallet;
if (recipient || dryRun) {
  kpass(["faucet", "drop", "--recipient", recipient ?? "<Passport kite wallet>", "--token", "pieUSD"], { allowFail: true });
} else {
  console.log("Couldn't find the Passport kite wallet above; re-run with --recipient <address>.");
}
if (agentWallet) {
  // Rail 2's AGENT_PRIVATE_KEY wallet: pieUSD here lets Melit settle gaslessly via x402.
  kpass(["faucet", "drop", "--recipient", agentWallet, "--token", "pieUSD"], { allowFail: true });
}

kpass(["agent", "register", "--type", agentType], { allowFail: true });

const sellerHost = argValue("--seller-host") ?? process.env.SELLER_BASE_URL;
if (sellerHost) {
  let host = sellerHost;
  try {
    host = new URL(sellerHost.startsWith("http") ? sellerHost : `https://${sellerHost}`).host;
  } catch {}
  kpass(["sandbox", "merchant", "register", "--host", host], { allowFail: true });
  kpass(["merchant", "register", "--url", sellerHost.replace(/\/+$/, "")], { allowFail: true });
}

const session = kpass(
  [
    "session",
    "create",
    "--separate",
    "--task-summary",
    "Melit hackathon judge window",
    "--max-amount-per-tx",
    String(maxPerTx),
    "--max-total-amount",
    String(maxTotal),
    "--assets",
    "pieUSD",
    "--ttl",
    "30d",
    "--no-browser",
    "--no-wait",
  ],
  { allowFail: true },
);

const urls = findAll(session, (v) => typeof v === "string" && /^https:\/\//.test(v));
const ids = findAll(session, (v) => typeof v === "string" && /^(session_|sess_|req_)/.test(v));
console.log("\nNext steps:");
if (urls.length) console.log(`  1. Approve the session with your passkey: ${urls[0]}`);
else console.log("  1. Approve the session with your passkey using the URL printed above.");
console.log("  2. Wait for approval: kpass session status --request-id <id> --wait --output json");
console.log(`  3. In .env.local set MELIT_KPASS=1 and KPASS_SESSION_ID=<session id>${ids.length ? ` (candidates: ${ids.join(", ")})` : ""}`);
console.log("  4. Set SELLER_BASE_URL to a PUBLIC URL serving this app (your Vercel deploy), since Passport's backend fetches the seller checkout itself,");
console.log("     and the same MELIT_ORDER_SECRET locally and on that deploy.");
if (baseUrl) console.log(`  5. Set KPASS_BASE_URL=${baseUrl} so Melit's kpass calls use the same backend.`);
console.log("  5. Set AGENT_PRIVATE_KEY (testnet only) and MOCK_SELLER_PAYTO for the Rail 2 fallback, then `npm run dev`.");
