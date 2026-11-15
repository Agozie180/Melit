// SERVER-ONLY. Materialize kpass auth state on serverless (Vercel) from secrets.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as tar from "tar";

let prepared = false;

export function bundledKpassPath(): string | null {
  const vendor = join(process.cwd(), "vendor", "kpass-linux-amd64");
  return existsSync(vendor) ? vendor : null;
}

function pathBinary(): string {
  const local = join(homedir(), ".local", "bin", "kpass");
  return existsSync(local) ? local : "kpass";
}

export function resolveKpassBinary(): string {
  if (process.env.KPASS_BIN) return process.env.KPASS_BIN;
  const bundled = bundledKpassPath();
  if (bundled) return bundled;
  return pathBinary();
}

function workdirRoot(): string {
  if (process.env.KPASS_WORKDIR) return process.env.KPASS_WORKDIR;
  const seed = process.env.KPASS_RUNTIME_BUNDLE_B64?.slice(0, 24) ?? process.env.VERCEL_DEPLOYMENT_ID ?? "local";
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  return join("/tmp", `melit-kpass-${hash}`);
}

/** Extract KPASS_RUNTIME_BUNDLE_B64 (tar.gz of .kite-passport) once per cold start. */
export function prepareKpassRuntime(): string | null {
  const workdir = workdirRoot();
  if (prepared && existsSync(join(workdir, "config.json"))) return workdir;

  const b64 = process.env.KPASS_RUNTIME_BUNDLE_B64;
  if (!b64) {
    if (existsSync(join(workdir, "config.json"))) {
      prepared = true;
      return workdir;
    }
    return null;
  }

  if (!existsSync(join(workdir, "config.json"))) {
    mkdirSync(workdir, { recursive: true });
    const tmp = join("/tmp", `kpass-bundle-${Date.now()}.tar.gz`);
    writeFileSync(tmp, Buffer.from(b64, "base64"));
    try {
      tar.x({ cwd: workdir, file: tmp, sync: true });
    } finally {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
    chmodSync(workdir, 0o700);
  }
  prepared = true;
  process.env.KPASS_WORKDIR = workdir;
  return workdir;
}

export function kpassReady(): boolean {
  const preparedDir = prepareKpassRuntime();
  if (preparedDir && existsSync(join(preparedDir, "config.json"))) return true;
  const workdir = process.env.KPASS_WORKDIR;
  return Boolean(workdir && existsSync(join(workdir, "config.json")));
}