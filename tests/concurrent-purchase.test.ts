import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { purchase, type PurchaseDeps } from "../lib/negotiation/run";
import { getCatalogItem, toPublicItem } from "../lib/market/catalog";
import { loadDemoState, setSignedList, wipeDemoSession } from "../lib/server/demo-state";
import { purchaseHooks } from "../lib/server/purchase-scope";
import { signShoppingList } from "../lib/server/shopping-list";
import type { FeedEvent, PaymentReceipt } from "../lib/types";
import type { PaymentOrder } from "../lib/payments/types";

async function collect(gen: AsyncGenerator<FeedEvent>) {
  const out: FeedEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const list = signShoppingList([
  { name: "Wireless Earbuds", maxPrice: 200_00, quantity: 2 },
  { name: "LED Desk Lamp", maxPrice: 200_00, quantity: 2 },
]);

function depsFor(priceCents: number): PurchaseDeps {
  return {
    pay: async (order: PaymentOrder) =>
      ({
        receiptId: `sim_${order.orderId}`,
        rail: "simulated",
        amountCents: priceCents,
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
}

describe("concurrent purchases", () => {
  const scope = `race_${randomUUID()}`;

  afterEach(async () => {
    await wipeDemoSession(scope);
  });

  it("allows only one purchase when two requests race the weekly cap", async () => {
    await setSignedList(scope, list);
    const lamp = getCatalogItem("lamp")!;
    const earbuds = getCatalogItem("earbuds")!;
    const hooks = purchaseHooks(scope, list);

    const paidA = 150_00;
    const paidB = 160_00;
    const [a, b] = await Promise.all([
      collect(purchase(lamp, toPublicItem(lamp), paidA, [], depsFor(paidA), list, hooks)),
      collect(purchase(earbuds, toPublicItem(earbuds), paidB, [], depsFor(paidB), list, hooks)),
    ]);

    const purchased = [...a, ...b].filter((e) => e.type === "purchased").length;
    const blocked = [...a, ...b].filter((e) => e.type === "blocked").length;
    expect(purchased).toBe(1);
    expect(blocked).toBe(1);

    const state = await loadDemoState(scope);
    expect(state.ledger).toHaveLength(1);
    expect(state.pending).toHaveLength(0);
    const spent = state.ledger.reduce((s, e) => s + e.paidCents, 0);
    expect(spent).toBeLessThanOrEqual(300_00);
  });

  it("allows only one unit when quantity is 1 under concurrency", async () => {
    const single = signShoppingList([{ name: "LED Desk Lamp", maxPrice: 49_00, quantity: 1 }]);
    await setSignedList(scope, single);
    const lamp = getCatalogItem("lamp")!;
    const hooks = purchaseHooks(scope, single);
    const price = 40_00;
    const [a, b] = await Promise.all([
      collect(purchase(lamp, toPublicItem(lamp), price, [], depsFor(price), single, hooks)),
      collect(purchase(lamp, toPublicItem(lamp), price, [], depsFor(price), single, hooks)),
    ]);
    expect([...a, ...b].filter((e) => e.type === "purchased")).toHaveLength(1);
    expect((await loadDemoState(scope)).ledger).toHaveLength(1);
  });
});