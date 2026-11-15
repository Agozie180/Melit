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

/** Try known kpass subcommands that register a merchant host (varies by CLI version). */
export async function ensureSandboxMerchantAllowed(run: KpassRunner, sellerBaseUrl: string): Promise<boolean> {
  const host = hostFromBaseUrl(sellerBaseUrl);
  if (!host) return false;
  if (registered.has(host)) return true;
  const attempts: string[][] = [
    ["sandbox", "merchant", "register", "--host", host],
    ["sandbox", "merchant", "allowlist", "add", "--host", host],
    ["merchant", "register", "--url", sellerBaseUrl.replace(/\/+$/, "")],
  ];
  for (const args of attempts) {
    const res: KpassResult = await run(args);
    if (res.exitCode === 0) {
      registered.add(host);
      return true;
    }
  }
  return false;
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