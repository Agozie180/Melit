// SERVER-ONLY. HMAC signatures for objects the client stores and sends back (deal summaries,
// seller reviews), so feedback, reputation and Reppo submissions only accept real runs.

import { createHmac, timingSafeEqual } from "node:crypto";
import { ledgerSecret } from "./ledger";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => k !== "sig" && v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function signObject(domain: string, value: object, secret = ledgerSecret()): string {
  return createHmac("sha256", `${secret}:${domain}`).update(stableStringify(value)).digest("base64url");
}

export function verifyObject(domain: string, value: { sig?: unknown }, secret = ledgerSecret()): boolean {
  if (typeof value?.sig !== "string") return false;
  const expected = Buffer.from(signObject(domain, value, secret));
  const actual = Buffer.from(value.sig);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
