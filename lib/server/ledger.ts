// SERVER-ONLY. Verifies the client-held ledger before the Spend Guard sees it.
//
// There is no database: the ledger lives in the browser and is sent with every request.
// Every entry is HMAC-signed by the server when a purchase is approved, so a client cannot
// lower an amount, back-date a purchase, or invent a refund without breaking a signature.
// Any extra fields the client adds (e.g. `weeklySpentCents: 0`) are stripped by zod and
// ignored; the server always recomputes the window total from the entries themselves.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { GuardResult, LedgerEntry } from "../types";
import { checkSpend } from "../guard/spend-guard";
import { WEEKLY_CAP_CENTS } from "../money";

const LedgerEntrySchema = z.object({
  id: z.string().min(1).max(100),
  itemId: z.string().min(1).max(100),
  itemName: z.string().max(200),
  sellerName: z.string().max(200),
  listPriceCents: z.number().int().nonnegative(),
  paidCents: z.number().int().nonnegative(),
  savedCents: z.number().int(),
  timestamp: z.number().int().nonnegative(),
  receiptId: z.string().min(1).max(200),
  paymentMode: z.enum(["simulated", "kite-x402"]),
  sig: z.string().min(1).max(200),
});

export const LedgerSchema = z.array(LedgerEntrySchema).max(500);

function ledgerSecret(): string {
  if (process.env.MELIT_LEDGER_SECRET) return process.env.MELIT_LEDGER_SECRET;
  const apiKey = process.env.OPENSERV_API_KEY || process.env.SERV_API_KEY;
  if (apiKey) {
    // Derived so deployments only need OPENSERV_API_KEY; the key itself never leaves the server.
    return createHash("sha256").update(`melit-ledger-v1:${apiKey}`).digest("hex");
  }
  return "melit-dev-insecure-ledger-secret";
}

function canonical(e: Omit<LedgerEntry, "sig">): string {
  return [e.id, e.itemId, e.listPriceCents, e.paidCents, e.savedCents, e.timestamp, e.receiptId, e.paymentMode].join("|");
}

export function signEntry(entry: Omit<LedgerEntry, "sig">, secret = ledgerSecret()): LedgerEntry {
  const sig = createHmac("sha256", secret).update(canonical(entry)).digest("hex");
  return { ...entry, sig };
}

export function verifyEntry(entry: LedgerEntry, secret = ledgerSecret()): boolean {
  const expected = createHmac("sha256", secret).update(canonical(entry)).digest();
  let given: Buffer;
  try {
    given = Buffer.from(entry.sig, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type LedgerCheck =
  | { ok: true; entries: LedgerEntry[] }
  | { ok: false; reason: string };

export function verifyLedger(raw: unknown, secret = ledgerSecret()): LedgerCheck {
  const parsed = LedgerSchema.safeParse(raw ?? []);
  if (!parsed.success) {
    return { ok: false, reason: "Ledger is malformed, so spending is frozen until you reset the demo." };
  }
  const bad = parsed.data.find((e) => !verifyEntry(e, secret));
  if (bad) {
    return {
      ok: false,
      reason: `Ledger entry "${bad.itemName}" was modified outside Melit (signature mismatch). Spending is frozen until you reset the demo.`,
    };
  }
  return { ok: true, entries: parsed.data };
}

/** Full server-side authorization: ledger integrity, then the pure Spend Guard. */
export function authorizeSpend(rawLedger: unknown, attemptedCents: number, now: number, secret = ledgerSecret()): GuardResult {
  const check = verifyLedger(rawLedger, secret);
  if (!check.ok) {
    return {
      allowed: false,
      reason: `Blocked: ${check.reason}`,
      spentInWindowCents: 0,
      remainingCents: 0,
      attemptedCents,
      capCents: WEEKLY_CAP_CENTS,
    };
  }
  return checkSpend({ ledger: check.entries, attemptedCents, now });
}
