/**
 * SPEND GUARD
 * ===========
 * The single gate every payment must pass. It is a pure function: same inputs, same
 * answer, no I/O, no clock reads (the caller passes `now`). That makes it trivially
 * testable and impossible for a prompt, a model, or a UI to talk it out of a decision.
 *
 * Two rules, both decided here in code:
 * - What it can buy: the item is on the owner's shopping list, quantity is left, and the
 *   price is at or under that item's max. See `checkPurchase`.
 * - How much it can spend: (sum of purchases in the rolling 7-day window) + this
 *   purchase <= $300. See `checkSpend`.
 *
 * Design notes:
 * - Money is integer cents, so "exactly $300.00" vs "$300.01" is an exact comparison.
 * - The guard never accepts a pre-computed total. Callers hand it the raw ledger and it
 *   recomputes the window sum itself, so a client that sends `weeklySpent: 0` gains nothing.
 * - Window: an entry counts while `now - timestamp < 7 days`. At exactly 7 days old it
 *   falls out of the window and that money becomes spendable again.
 * - Entries timestamped in the future are still counted (conservative): back-dating or
 *   forward-dating a purchase must never free up budget.
 * - Malformed amounts (NaN, negative, fractional cents) can only make the guard stricter:
 *   a bad attempted amount is blocked, and a negative ledger amount counts as 0 rather than
 *   being allowed to "refund" budget.
 * - Ledger authenticity (were these entries really approved by the server?) is checked
 *   separately in `lib/server/ledger.ts` before this function runs.
 */

import type { GuardResult } from "../types";
import { WEEKLY_CAP_CENTS, WINDOW_MS, formatUsd } from "../money";
import { findListItem, unitsBought, type ShoppingListItem } from "../shopping/list";

export interface GuardLedgerEntry {
  paidCents: number;
  timestamp: number;
}

export interface GuardInput {
  ledger: readonly GuardLedgerEntry[];
  attemptedCents: number;
  now: number;
  capCents?: number;
  windowMs?: number;
}

/** Sum of what was paid inside the rolling window ending at `now`. */
export function spentInWindow(
  ledger: readonly GuardLedgerEntry[],
  now: number,
  windowMs: number = WINDOW_MS,
): number {
  let total = 0;
  for (const entry of ledger) {
    const age = now - entry.timestamp;
    // age < 0 means a future-dated entry; it still counts.
    if (age < windowMs) {
      const paid = Number.isFinite(entry.paidCents) ? Math.max(0, Math.round(entry.paidCents)) : 0;
      total += paid;
    }
  }
  return total;
}

export function checkSpend(input: GuardInput): GuardResult {
  const capCents = input.capCents ?? WEEKLY_CAP_CENTS;
  const windowMs = input.windowMs ?? WINDOW_MS;
  const spent = spentInWindow(input.ledger, input.now, windowMs);
  const remaining = Math.max(0, capCents - spent);
  const attempted = input.attemptedCents;

  const base = { spentInWindowCents: spent, remainingCents: remaining, attemptedCents: attempted, capCents };

  if (!Number.isInteger(attempted) || attempted <= 0) {
    return { ...base, allowed: false, reason: "Blocked: the payment amount is not a valid positive amount." };
  }

  if (spent + attempted > capCents) {
    const over = spent + attempted - capCents;
    return {
      ...base,
      allowed: false,
      reason:
        `Blocked by Spend Guard: this ${formatUsd(attempted)} purchase would bring the last 7 days to ` +
        `${formatUsd(spent + attempted)}, which is ${formatUsd(over)} over your ${formatUsd(capCents)} weekly limit. ` +
        `You have ${formatUsd(remaining)} left this week.`,
    };
  }

  return {
    ...base,
    allowed: true,
    reason: `Approved: ${formatUsd(attempted)} fits. ${formatUsd(remaining - attempted)} will remain in the 7-day window.`,
  };
}

export interface PurchaseInput extends GuardInput {
  ledger: readonly (GuardLedgerEntry & { itemName: string })[];
  itemName: string;
  /** The owner's approved rows. Quantity remaining is computed from `ledger`, not from this list. */
  list: readonly ShoppingListItem[];
}

/**
 * Full Spend Guard for one purchase. The list is checked first (what Melit may buy), then
 * the weekly cap (how much it may spend). The first failure is the reason the caller shows.
 */
export function checkPurchase(input: PurchaseInput): GuardResult {
  const attempted = input.attemptedCents;
  if (!Number.isInteger(attempted) || attempted <= 0) return checkSpend(input);

  const cap = checkSpend(input);
  const row = findListItem(input.list, input.itemName);
  if (!row) {
    return {
      ...cap,
      allowed: false,
      reason: `Blocked: "${input.itemName}" is not on your shopping list. Melit can only buy items you added and approved.`,
    };
  }

  const bought = unitsBought(input.ledger, row.name);
  if (bought >= row.quantity) {
    const verb = bought === 1 ? "has" : "have";
    return {
      ...cap,
      allowed: false,
      reason: `Blocked: your shopping list allows ${row.quantity} of "${row.name}" and ${bought} ${verb} already been bought, so none are left.`,
    };
  }

  if (attempted > row.maxPrice) {
    return {
      ...cap,
      allowed: false,
      reason: `Blocked: ${formatUsd(attempted)} is above the ${formatUsd(row.maxPrice)} maximum you set for "${row.name}" on your shopping list.`,
    };
  }

  return cap;
}
