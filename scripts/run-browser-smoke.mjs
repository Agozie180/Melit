#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const base = process.env.SMOKE_URL ?? "http://127.0.0.1:3001";

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

let child = null;
if (!(await reachable(base))) {
  console.log(`Starting production server at ${base}…`);
  const port = new URL(base).port || "3001";
  child = spawn("npm", ["run", "start"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: "ignore",
  });
  for (let i = 0; i < 40; i++) {
    if (await reachable(base)) break;
    await sleep(500);
  }
  if (!(await reachable(base))) {
    child.kill();
    console.error(`Server did not become ready at ${base}`);
    process.exit(1);
  }
}

const smoke = spawn("node", ["scripts/browser-smoke.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, SMOKE_URL: base },
  stdio: "inherit",
});

const code = await new Promise((resolve) => smoke.on("exit", resolve));
if (child) child.kill();
process.exit(code ?? 1);