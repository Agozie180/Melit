import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { purchase, runShopping, type PurchaseDeps } from "../lib/negotiation/run";
import { getCatalogItem, toPublicItem } from "../lib/market/catalog";
import { resetLedger, setSignedList, wipeDemoSession, loadDemoState } from "../lib/server/demo-state";
import { purchaseHooks } from "../lib/server/purchase-scope";
import { signShoppingList } from "../lib/server/shopping-list";
import type { FeedEvent, LedgerEntry, PaymentReceipt } from "../lib/types";
import type { ReasoningAdapter } from "../lib/adapters/reasoning";

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

describe("server-persisted financial state", () => {
  const sid = `test_${randomUUID()}`;

  afterEach(async () => {
    await wipeDemoSession(sid);
  });

  it("keeps the weekly cap after a cleared client ledger", async () => {
    const list = signShoppingList([{ name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 }]);
    await setSignedList(sid, list);

    const hooks = purchaseHooks(sid, list);

    await collect(
      runShopping({ query: "wireless earbuds", maxPriceCents: 120_00, priority: "save" }, [], fakeReasoner(), deps, {}, list, hooks),
    );

    const stored = await loadDemoState(sid);
    expect(stored.ledger).toHaveLength(1);
    expect(stored.list?.items[0].name).toMatch(/Earbuds/i);

    const afterBuy = await loadDemoState(sid);
    const second = await collect(
      runShopping(
        { query: "wireless earbuds", maxPriceCents: 120_00, priority: "save" },
        afterBuy.ledger,
        fakeReasoner(),
        deps,
        {},
        list,
        hooks,
      ),
    );
    expect(second.some((e) => e.type === "purchased")).toBe(false);
    expect(second.some((e) => e.type === "blocked")).toBe(true);

    await resetLedger(sid);
    const afterReset = await loadDemoState(sid);
    expect(afterReset.ledger).toHaveLength(0);
    expect(afterReset.list).not.toBeNull();
  });

  it("persists each purchase through the payment hook", async () => {
    const list = signShoppingList([{ name: "LED Desk Lamp", maxPrice: 49_00, quantity: 2 }]);
    await setSignedList(sid, list);
    const item = getCatalogItem("lamp")!;
    const events = await collect(
      purchase(item, toPublicItem(item), 40_00, [], deps, list, purchaseHooks(sid, list)),
    );
    expect(events.at(-1)?.type).toBe("purchased");
    expect((await loadDemoState(sid)).ledger).toHaveLength(1);
  });
});