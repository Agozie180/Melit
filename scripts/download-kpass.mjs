#!/usr/bin/env node
// Downloads the linux-amd64 kpass binary for Vercel/serverless (Rail 1).
// Idempotent: skips when vendor/kpass-linux-amd64 already exists and is executable.

import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outPath = join(root, "vendor", "kpass-linux-amd64");
const BUNDLE_VERSION = process.env.KPASS_BUNDLE_VERSION ?? "114";
const BASE_URL = process.env.KPASS_CLI_BASE_URL ?? "https://cli.gokite.ai";

function localCopy() {
  const candidates = [
    process.env.KPASS_BIN,
    join(homedir(), ".kpass", "bin", "kpass"),
    join(homedir(), ".local", "bin", "kpass"),
  ].filter(Boolean);
  for (const src of candidates) {
    if (existsSync(src)) {
      mkdirSync(dirname(outPath), { recursive: true });
      copyFileSync(src, outPath);
      chmodSync(outPath, 0o755);
      console.log(`[download-kpass] copied ${src} -> ${outPath}`);
      return true;
    }
  }
  return false;
}

async function downloadSimple() {
  const manifestUrl = `${BASE_URL}/bundle/${BUNDLE_VERSION}/manifest.json`;
  const manifest = JSON.parse(await (await fetch(manifestUrl)).text());
  const archiveName = `kpass_${manifest.cli_version ?? "6.13.5"}_linux_amd64.tar.gz`;
  const archiveUrl = `${BASE_URL}/bundle/${BUNDLE_VERSION}/${archiveName}`;
  console.log(`[download-kpass] fetching ${archiveUrl}`);
  const tmp = join(root, "vendor", ".kpass-dl.tar.gz");
  mkdirSync(dirname(tmp), { recursive: true });
  execFileSync("curl", ["-fsSL", "-o", tmp, archiveUrl], { stdio: "inherit" });
  mkdirSync(join(root, "vendor", ".extract"), { recursive: true });
  execFileSync("tar", ["-xzf", tmp, "-C", join(root, "vendor", ".extract")], { stdio: "inherit" });
  const found = execFileSync("find", [join(root, "vendor", ".extract"), "-name", "kpass", "-type", "f"], { encoding: "utf8" })
    .trim()
    .split("\n")[0];
  if (!found) throw new Error("kpass binary not found in archive");
  copyFileSync(found, outPath);
  chmodSync(outPath, 0o755);
}

async function main() {
  if (existsSync(outPath)) {
    try {
      execFileSync(outPath, ["--version"], { stdio: "pipe" });
      console.log(`[download-kpass] reuse ${outPath}`);
      return;
    } catch {
      /* re-download */
    }
  }
  if (localCopy()) return;
  try {
    await downloadSimple();
    console.log(`[download-kpass] installed ${outPath}`);
  } catch (err) {
    console.warn(`[download-kpass] download failed: ${err.message}`);
    if (process.env.VERCEL) {
      console.warn("[download-kpass] Rail 1 needs vendor/kpass-linux-amd64 or KPASS_BIN");
    }
  }
}

main();