import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { runShopping, type PurchaseDeps } from "../lib/negotiation/run";
import { loadDemoState, setSignedList, wipeDemoSession } from "../lib/server/demo-state";
import { financialScopeFromRequest } from "../lib/server/request-session";
import { purchaseHooks } from "../lib/server/purchase-scope";
import { signShoppingList } from "../lib/server/shopping-list";
import type { FeedEvent, PaymentReceipt } from "../lib/types";
import type { ReasoningAdapter } from "../lib/adapters/reasoning";

function req(budgetId: string, sessionId?: string) {
  const headers = new Headers({ "X-Melit-Budget": budgetId });
  if (sessionId) headers.set("cookie", `melit_sid=${sessionId}`);
  return new Request("https://melit.test/api/state", { headers });
}

function fakeReasoner(): ReasoningAdapter {
  return {
    provider: "fake",
    model: "fake",
    configured: true,
    async completeJson() {
      return { json: { action: "offer", offerPrice: 90, reasoning: ["Deal."], confidence: 0.8 }, model: "fake" };
    },
  };
}

const deps: PurchaseDeps = {
  pay: async () =>
    ({
      receiptId: "sim_1",
      rail: "simulated",
      amountCents: 90_00,
      testnetAmount: null,
      asset: null,
      payee: "mock",
      network: "simulated",
      txHash: null,
      explorerUrl: null,
      settledAt: Date.now(),
      attempts: [],
    }) satisfies PaymentReceipt,
};

async function collect(gen: AsyncGenerator<FeedEvent>) {
  const out: FeedEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("budget scope survives a new session cookie", () => {
  const budget = randomUUID();
  const sessionA = randomUUID();
  const sessionB = randomUUID();

  afterEach(async () => {
    await wipeDemoSession(budget);
  });

  it("resolves the same financial scope from header despite different melit_sid values", () => {
    expect(financialScopeFromRequest(req(budget, sessionA))).toBe(budget);
    expect(financialScopeFromRequest(req(budget, sessionB))).toBe(budget);
  });

  it("reuses server ledger for the budget scope after a new session id", async () => {
    const list = signShoppingList([{ name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 }]);
    await setSignedList(budget, list);
    const hooks = purchaseHooks(budget, list);
    await collect(
      runShopping({ query: "wireless earbuds", maxPriceCents: 120_00, priority: "save" }, [], fakeReasoner(), deps, {}, list, hooks),
    );
    expect((await loadDemoState(budget)).ledger).toHaveLength(1);

    const stored = await loadDemoState(budget);
    const second = await collect(
      runShopping(
        { query: "wireless earbuds", maxPriceCents: 120_00, priority: "save" },
        [],
        fakeReasoner(),
        deps,
        {},
        list,
        hooks,
      ),
    );
    expect(second.some((e) => e.type === "purchased")).toBe(false);
    expect(stored.ledger).toHaveLength(1);
  });
});