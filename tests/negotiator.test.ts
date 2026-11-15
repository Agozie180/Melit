import { describe, expect, it } from "vitest";
import type { ReasoningAdapter } from "../lib/adapters/reasoning";
import { decide, type NegotiationContext } from "../lib/negotiation/negotiator";
import { runOverspend, runShopping } from "../lib/negotiation/run";
import { publicCatalog } from "../lib/market/catalog";
import { signEntry } from "../lib/server/ledger";
import type { FeedEvent } from "../lib/types";

function fakeReasoner(responses: unknown[] | ((ctx: string) => unknown)): ReasoningAdapter & { calls: string[] } {
  const calls: string[] = [];
  return {
    provider: "fake",
    model: "fake-model",
    configured: true,
    calls,
    async completeJson({ user }) {
      calls.push(user);
      const next = typeof responses === "function" ? responses(user) : responses.shift();
      if (next instanceof Error) throw next;
      return { json: next, model: "fake-model" };
    },
  };
}

const earbuds = publicCatalog().find((i) => i.id === "earbuds")!;
const baseCtx: NegotiationContext = {
  item: earbuds,
  round: 1,
  maxRounds: 4,
  currentAskCents: earbuds.listPriceCents,
  history: [],
  remainingBudgetCents: 300_00,
  userMaxPriceCents: 120_00,
  priority: "save",
};

async function collect(gen: AsyncGenerator<FeedEvent>) {
  const out: FeedEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("negotiator", () => {
  it("uses SERV output when it validates", async () => {
    const r = fakeReasoner([{ action: "offer", offerPrice: 85, reasoning: ["Open low."], confidence: 0.7 }]);
    const d = await decide(baseCtx, r);
    expect(d.source).toBe("serv");
    expect(d.offerPriceCents).toBe(85_00);
  });

  it("falls back and flags it when the JSON is invalid", async () => {
    const r = fakeReasoner([{ action: "buy-it-all", offerPrice: "lots" }]);
    const d = await decide(baseCtx, r);
    expect(d.source).toBe("fallback");
    expect(d.fallbackReason).toMatch(/schema validation/);
  });

  it("falls back when the SERV call throws", async () => {
    const r = fakeReasoner([new Error("SERV returned HTTP 500")]);
    const d = await decide(baseCtx, r);
    expect(d.source).toBe("fallback");
    expect(d.fallbackReason).toMatch(/500/);
  });

  it("clamps a model offer above the user's max price", async () => {
    const r = fakeReasoner([{ action: "offer", offerPrice: 125, reasoning: ["Go big."], confidence: 0.9 }]);
    const d = await decide({ ...baseCtx, userMaxPriceCents: 100_00 }, r);
    expect(d.offerPriceCents).toBe(100_00);
    expect(d.guardrails.length).toBeGreaterThan(0);
  });

  it("never sends the hidden floor price to the model", async () => {
    const r = fakeReasoner(() => ({ action: "walk", offerPrice: 0, reasoning: ["No."], confidence: 1 }));
    await collect(runShopping({ query: "earbuds", maxPriceCents: 120_00, priority: "save" }, [], r));
    expect(r.calls.join("\n")).not.toMatch(/floor|84(\.0+)?\b/i);
  });
});

describe("end to end", () => {
  it("negotiates, passes the Spend Guard, and records a signed purchase", async () => {
    const r = fakeReasoner(() => ({ action: "offer", offerPrice: 90, reasoning: ["Reasonable."], confidence: 0.8 }));
    const events = await collect(runShopping({ query: "wireless earbuds", maxPriceCents: 120_00, priority: "save" }, [], r));
    const purchased = events.find((e) => e.type === "purchased");
    expect(purchased?.type).toBe("purchased");
    if (purchased?.type !== "purchased") return;
    expect(purchased.entry.paidCents).toBe(90_00);
    expect(purchased.entry.savedCents).toBe(earbuds.listPriceCents - 90_00);
    expect(purchased.receipt.mode).toBe("simulated");
  });

  it("the overspend demo is always blocked by the Spend Guard", async () => {
    const events = await collect(runOverspend([]));
    expect(events.some((e) => e.type === "blocked")).toBe(true);
    expect(events.some((e) => e.type === "purchased")).toBe(false);
  });

  it("after real purchases, the overspend demo targets an item that only fails on the weekly total", async () => {
    const spent = signEntry({
      id: "led_1",
      itemId: "chair",
      itemName: "Ergonomic Office Chair",
      sellerName: "Bundle Barn (mock)",
      listPriceCents: 229_00,
      paidCents: 200_00,
      savedCents: 29_00,
      timestamp: Date.now() - 1000,
      receiptId: "sim_1",
      paymentMode: "simulated",
    });
    const events = await collect(runOverspend([spent]));
    const blocked = events.find((e) => e.type === "blocked");
    expect(blocked?.type).toBe("blocked");
    if (blocked?.type !== "blocked") return;
    expect(blocked.priceCents).toBeLessThanOrEqual(300_00);
    expect(blocked.priceCents).toBeGreaterThan(100_00);
  });
});
