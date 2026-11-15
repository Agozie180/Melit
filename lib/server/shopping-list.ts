// SERVER-ONLY. The signed shopping list is stored per session (demo-state) after POST /api/shopping-list.
// The owner saves it through POST /api/shopping-list, which HMAC-signs the
// rows. A client that edits a max price, a quantity, or the set of names breaks the
// signature. Extra fields (`remaining`, `allowed`, `onList`) are stripped and ignored.
// Quantity left is counted from the verified ledger, never from a number the client sends.

import { z } from "zod";
import type { GuardResult } from "../types";
import { WEEKLY_CAP_CENTS } from "../money";
import { checkPurchase } from "../guard/spend-guard";
import { canonicalItems, duplicateItemMessage, type ShoppingListItem, type SignedShoppingList } from "../shopping/list";
import { ledgerSecret, verifyLedger } from "./ledger";
import { signObject, verifyObject } from "./signing";

export const LIST_DOMAIN = "shopping-list";

export const NO_LIST_REASON = "There is no approved shopping list yet, so Melit can't buy anything. Add items and save the list first.";
const MALFORMED_REASON = "The shopping list is malformed, so spending is frozen until you save it again.";
const TAMPER_REASON = "The shopping list was modified outside Melit (signature mismatch). Spending is frozen until you save it again.";

export const ShoppingListItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  maxPrice: z.number().int().positive().max(100_000_00),
  quantity: z.number().int().positive().max(99),
});

const SignedShoppingListSchema = z.object({
  items: z.array(ShoppingListItemSchema).max(30),
  sig: z.string().min(1).max(300),
});

export type ListCheck = { ok: true; items: ShoppingListItem[] } | { ok: false; reason: string };

export function signShoppingList(items: readonly ShoppingListItem[], secret = ledgerSecret()): SignedShoppingList {
  const dup = duplicateItemMessage(items);
  if (dup) throw new Error(dup);
  const signed = { items: canonicalItems(items) };
  return { items: signed.items, sig: signObject(LIST_DOMAIN, signed, secret) };
}

export function verifyShoppingList(raw: unknown, secret = ledgerSecret()): ListCheck {
  if (raw == null) return { ok: false, reason: NO_LIST_REASON };
  const parsed = SignedShoppingListSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: MALFORMED_REASON };
  const items = canonicalItems(parsed.data.items);
  if (duplicateItemMessage(items)) {
    return { ok: false, reason: "The shopping list has two rows for the same item, so spending is frozen until you save it again." };
  }
  const payload = { items, sig: parsed.data.sig };
  if (!verifyObject(LIST_DOMAIN, payload, secret)) return { ok: false, reason: TAMPER_REASON };
  return { ok: true, items };
}

function blocked(reason: string, attemptedCents: number, spent = 0, remaining = 0): GuardResult {
  return {
    allowed: false,
    reason: reason.startsWith("Blocked:") ? reason : `Blocked: ${reason}`,
    spentInWindowCents: spent,
    remainingCents: remaining,
    attemptedCents,
    capCents: WEEKLY_CAP_CENTS,
  };
}

/**
 * The payment gate. Ledger integrity, then the signed shopping list, then the weekly cap.
 * Callers must not pay unless `allowed` is true.
 */
export function authorizePurchase(
  rawLedger: unknown,
  rawList: unknown,
  itemName: string,
  attemptedCents: number,
  now: number,
  secret = ledgerSecret(),
): GuardResult {
  const ledger = verifyLedger(rawLedger, secret);
  if (!ledger.ok) return blocked(ledger.reason, attemptedCents);

  const list = verifyShoppingList(rawList, secret);
  if (!list.ok) return blocked(list.reason, attemptedCents);

  return checkPurchase({
    ledger: ledger.entries,
    list: list.items,
    itemName,
    attemptedCents,
    now,
  });
}
