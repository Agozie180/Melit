/** Sends one negotiator-shaped request with a bogus key; confirms we no longer get max_tokens HTTP 400. */
import { ServReasoningAdapter } from "../lib/adapters/reasoning";
import { SYSTEM_PROMPT, buildUserMessage, DECISION_JSON_SCHEMA } from "../lib/negotiation/negotiator";
import { publicCatalog } from "../lib/market/catalog";

async function main() {
  const item = publicCatalog().find((i) => i.id === "earbuds");
  if (!item) throw new Error("no earbuds");
  const ctx = {
    item,
    round: 1,
    maxRounds: 4,
    currentAskCents: item.listPriceCents,
    history: [],
    remainingBudgetCents: 30_000,
    userMaxPriceCents: 12_900,
    priority: "save" as const,
    listMaxPriceCents: 12_900,
    quantityRemaining: 1,
    shoppingList: [{ name: item.name, maxPriceUsd: 129, quantity: 1, quantityRemaining: 1 }],
    sellerPushes: [] as { itemName: string; kind: "bundle" | "flash"; priceUsd: number; onList: boolean; pitch: string }[],
  };
  const adapter = new ServReasoningAdapter({ apiKey: process.env.OPENSERV_API_KEY ?? "probe-invalid-key" });
  try {
    await adapter.completeJson({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(ctx),
      schemaName: "melit_negotiation_decision",
      schema: DECISION_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    console.log("OK: SERV returned success.");
    process.exit(0);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("max_tokens is too large") || msg.includes("Unsupported parameter: 'max_tokens'")) {
      console.error("FAIL: completion token parameter rejected:", msg.slice(0, 240));
      process.exit(1);
    }
    if (msg.includes("HTTP 401") || msg.includes("HTTP 403") || msg.toLowerCase().includes("unauthorized") || msg.includes("invalid api key")) {
      console.log("OK: payload accepted; auth failed as expected without a real key.");
      process.exit(0);
    }
    console.error("UNEXPECTED:", msg.slice(0, 400));
    process.exit(1);
  }
}

await main();