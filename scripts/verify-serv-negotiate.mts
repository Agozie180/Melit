/**
 * Live check: one negotiation round must return source "serv", not fallback from max_tokens HTTP 400.
 * Usage: OPENSERV_API_KEY=… npm run verify:serv
 * Does not print the key or write secrets.
 */
import { publicCatalog } from "../lib/market/catalog";
import { ServReasoningAdapter } from "../lib/adapters/reasoning";
import { decide } from "../lib/negotiation/negotiator";

const key = process.env.OPENSERV_API_KEY || process.env.SERV_API_KEY;
if (!key) {
  console.error("Missing OPENSERV_API_KEY (or SERV_API_KEY).");
  process.exit(2);
}

const item = publicCatalog().find((i) => i.id === "earbuds");
if (!item) {
  console.error("Catalog missing earbuds.");
  process.exit(2);
}

const decision = await decide(
  {
    item,
    round: 1,
    maxRounds: 4,
    currentAskCents: item.listPriceCents,
    history: [],
    remainingBudgetCents: 30_000,
    userMaxPriceCents: 12_900,
    priority: "save",
    listMaxPriceCents: 12_900,
    quantityRemaining: 1,
    shoppingList: [{ name: item.name, maxPriceUsd: 129, quantity: 1, quantityRemaining: 1 }],
    sellerPushes: [],
  },
  new ServReasoningAdapter(),
);

if (decision.source !== "serv") {
  console.error("FAIL: expected source serv, got", decision.source);
  console.error("fallbackReason:", decision.fallbackReason ?? "(none)");
  process.exit(1);
}

console.log("OK: SERV Reasoning round succeeded.");
console.log("action:", decision.action, "offerCents:", decision.offerPriceCents, "model:", decision.model ?? "—");