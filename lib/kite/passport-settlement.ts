// SERVER-ONLY. Confirms a kpass session execute result actually settled before trusting Rail 1.

import { RailError } from "../payments/types";
import type { KpassRunner } from "../payments/kpass-rail";
import { explorerTxUrl, KITE_TESTNET } from "./config";

function dig(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Require HTTP 2xx from the seller via Passport and an explicit x402 success when present. */
export function assertPassportHttpSettlement(json: Record<string, unknown>): { txHash: string | null; chainId: number | null } {
  const status = Number(dig(json, "x402", "status_code") ?? dig(json, "payment", "status_code"));
  if (!(status >= 200 && status < 300)) {
    throw new RailError(`Seller returned HTTP ${Number.isFinite(status) ? status : "unknown"} through Passport`, false);
  }
  const success = dig(json, "x402", "payment_response", "success");
  if (success === false) {
    throw new RailError("Passport reported x402 payment_response.success=false", false);
  }
  const txHash =
    str(dig(json, "payment", "payment_response", "reference")) ??
    str(dig(json, "x402", "payment_response", "reference")) ??
    str(dig(json, "x402", "transaction_hash")) ??
    null;
  const chainId = Number(dig(json, "x402", "chain_id"));
  if (!txHash) {
    throw new RailError("Passport did not return a settlement reference or transaction hash", false);
  }
  return { txHash, chainId: Number.isFinite(chainId) ? chainId : null };
}

export function explorerForTx(txHash: string, chainId: number | null): string | null {
  if (chainId === KITE_TESTNET.chainId) return explorerTxUrl(txHash);
  return null;
}

/** Before falling back to another rail, check idempotency-key activity for a successful payment. */
export async function passportAlreadySettled(run: KpassRunner, orderId: string): Promise<string | null> {
  const res = await run(["activity", "list", "--limit", "40"]);
  if (res.exitCode !== 0 || !res.json) return null;
  const text = JSON.stringify(res.json);
  if (!text.includes(orderId)) return null;
  const tx =
    str(dig(res.json, "payment", "payment_response", "reference")) ??
    str(dig(res.json, "x402", "payment_response", "reference")) ??
    (text.match(/0x[a-fA-F0-9]{64}/)?.[0] ?? null);
  if (text.toLowerCase().includes('"success":true') || text.includes('"status":"success"')) return tx;
  return null;
}