// Owner-controlled allowlist. Safe to import from client components: no secrets, no Node APIs.
//
// A row is { name, maxPrice, quantity }. maxPrice is integer cents, the same unit as the ledger.
// The server signs the rows the owner saves. Before a payment, code recomputes quantity remaining
// from the signed ledger. A client field such as `remaining` or `allowed` is never consulted.

import type { DeclinedOffer } from "../types";
import { formatUsd } from "../money";

export interface ShoppingListItem {
  name: string;
  /** Integer cents. The most Melit may pay for one of these. */
  maxPrice: number;
  /** How many the owner approved. Remaining is this minus matching ledger rows. */
  quantity: number;
}

export interface SignedShoppingList {
  items: ShoppingListItem[];
  /** HMAC from the server over the canonical items. */
  sig: string;
}

/** Logged on every off-list refusal. Tests and the UI look for this exact phrase. */
export const OFF_LIST_LOG = "declined: not on your list";

export function normalizeItemName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function findListItem(items: readonly ShoppingListItem[], name: string): ShoppingListItem | undefined {
  const key = normalizeItemName(name);
  if (!key) return undefined;
  return items.find((item) => normalizeItemName(item.name) === key);
}

/** Purchases of this name in the ledger. The weekly window does not refill quantity. */
export function unitsBought(ledger: readonly { itemName: string }[], name: string): number {
  const key = normalizeItemName(name);
  if (!key) return 0;
  let count = 0;
  for (const entry of ledger) {
    if (normalizeItemName(entry.itemName) === key) count += 1;
  }
  return count;
}

export function canonicalItems(items: readonly ShoppingListItem[]): ShoppingListItem[] {
  return [...items]
    .map((item) => ({ name: item.name.trim(), maxPrice: item.maxPrice, quantity: item.quantity }))
    .sort((a, b) => normalizeItemName(a.name).localeCompare(normalizeItemName(b.name)) || a.name.localeCompare(b.name));
}

/** Null when the rows are unique after normalization. */
export function duplicateItemMessage(items: readonly ShoppingListItem[]): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizeItemName(item.name);
    if (!key) return "Item names need letters or numbers.";
    if (seen.has(key)) return `Two rows match "${item.name}". Keep one line per item.`;
    seen.add(key);
  }
  return null;
}

export interface ItemStatus {
  state: "waiting" | "bought";
  bought: number;
  remaining: number;
  savedCents: number;
}

export function itemStatus(item: ShoppingListItem, ledger: readonly { itemName: string; savedCents: number }[]): ItemStatus {
  const key = normalizeItemName(item.name);
  let bought = 0;
  let savedCents = 0;
  for (const entry of ledger) {
    if (normalizeItemName(entry.itemName) !== key) continue;
    bought += 1;
    savedCents += Math.max(0, entry.savedCents);
  }
  const remaining = Math.max(0, item.quantity - bought);
  return { state: bought > 0 ? "bought" : "waiting", bought, remaining, savedCents };
}

export function declineOffer(input: {
  id: string;
  kind: DeclinedOffer["kind"];
  itemName: string;
  sellerName: string;
  priceCents: number;
  pitch: string;
  at: number;
}): DeclinedOffer {
  const price = formatUsd(input.priceCents);
  const log =
    input.kind === "request"
      ? `${OFF_LIST_LOG}. You asked for ${input.itemName} (${price}). Melit will not negotiate or pay until you add it and approve that change.`
      : `${OFF_LIST_LOG}. ${input.sellerName} pushed ${input.kind === "bundle" ? "a bundle" : "a flash deal"} for ${input.itemName} at ${price}. ${input.pitch}`;
  return {
    id: input.id,
    kind: input.kind,
    itemName: input.itemName,
    sellerName: input.sellerName,
    priceCents: input.priceCents,
    pitch: input.pitch,
    log,
    reasoning: [
      `${input.itemName} at ${price} is not on your shopping list.`,
      "The list is the allowlist: Melit may buy only those items, within each max price and quantity, and inside the $300 weekly cap.",
      "This decline is enforced in code. SERV Reasoning is told the list, and it cannot approve an off-list purchase.",
    ],
    suggested: { name: input.itemName, maxPrice: input.priceCents, quantity: 1 },
    at: input.at,
  };
}
