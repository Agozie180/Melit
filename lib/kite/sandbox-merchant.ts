// SERVER-ONLY. Best-effort sandbox merchant registration before Passport session execute.

import type { KpassResult, KpassRunner } from "../payments/kpass-rail";

const registered = new Set<string>();

function hostFromBaseUrl(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

function normalizeSellerUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

/** Try known kpass subcommands that register or allowlist a merchant host (varies by CLI version). */
export async function ensureSandboxMerchantAllowed(run: KpassRunner, sellerBaseUrl: string): Promise<boolean> {
  const host = hostFromBaseUrl(sellerBaseUrl);
  if (!host) return false;
  if (registered.has(host)) return true;

  const origin = normalizeSellerUrl(sellerBaseUrl);
  const attempts: string[][] = [
    ["sandbox", "merchant", "register", "--host", host],
    ["sandbox", "merchant", "allowlist", "add", "--host", host],
    ["sandbox", "merchant", "allowlist", "add", "--url", origin],
    ["merchant", "register", "--url", origin],
    ["merchant", "allowlist", "add", "--host", host],
  ];
  for (const args of attempts) {
    const res: KpassResult = await run(args);
    if (res.exitCode === 0) {
      registered.add(host);
      return true;
    }
  }
  const statusArgs = [
    ["sandbox", "merchant", "status", "--host", host],
    ["sandbox", "merchant", "allowlist", "status", "--host", host],
  ];
  for (const args of statusArgs) {
    const res: KpassResult = await run(args);
    const allowed =
      res.exitCode === 0 &&
      (res.json?.allowed === true ||
        res.json?.is_allowlisted === true ||
        String(dig(res.json, "data", "status")).toLowerCase() === "allowlisted");
    if (allowed) {
      registered.add(host);
      return true;
    }
  }
  return false;
}

function dig(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function merchantAllowlistErrorCode(code: string | undefined): boolean {
  if (!code) return false;
  return (
    code === "sandbox_merchant_not_allowlisted" ||
    code === "merchant_not_allowed" ||
    code === "payment_target_forbidden" ||
    code.includes("merchant_not")
  );
}

/** Clears in-memory registration cache (tests only). */
export function resetSandboxMerchantCache() {
  registered.clear();
}