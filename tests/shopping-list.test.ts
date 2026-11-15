import { describe, expect, it, vi } from "vitest";
import type { ReasoningAdapter } from "../lib/adapters/reasoning";
import { checkPurchase } from "../lib/guard/spend-guard";
import { sellerPushes } from "../lib/market/offers";
import { getCatalogItem, toPublicItem } from "../lib/market/catalog";
import { decide } from "../lib/negotiation/negotiator";
import { purchase, runShopping } from "../lib/negotiation/run";
import { signEntry } from "../lib/server/ledger";
import { POST } from "../app/api/shopping-list/route";
import { authorizePurchase, signShoppingList, verifyShoppingList } from "../lib/server/shopping-list";
import { OFF_LIST_LOG, itemStatus } from "../lib/shopping/list";
import type { FeedEvent, LedgerEntry } from "../lib/types";

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "list-test-secret";

function allow(name: string, maxPrice: number, quantity = 1) {
  return signShoppingList([{ name, maxPrice, quantity }], SECRET);
}

function bought(itemName: string, paidCents: number, timestamp = NOW - DAY, id = `led-${itemName}-${paidCents}`): LedgerEntry {
  return signEntry(
    {
      id,
      itemId: "item",
      itemName,
      sellerName: "Breezy Bazaar (mock)",
      listPriceCents: paidCents + 1_000,
      paidCents,
      savedCents: 1_000,
      timestamp,
      receiptId: `sim_${id}`,
      rail: "simulated",
      txHash: null,
      explorerUrl: null,
      testnetAmount: null,
    },
    SECRET,
  );
}

async function collect(gen: AsyncGenerator<FeedEvent>) {
  const out: FeedEvent[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

describe("Shopping list inside the Spend Guard", () => {
  const list = allow("Wireless Earbuds", 80_00, 1);

  it("blocks an off-list purchase", () => {
    const result = authorizePurchase([], list, "Rain Jacket", 50_00, NOW, SECRET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/not on your shopping list/);
  });

  it("blocks a price over the item's max", () => {
    const result = authorizePurchase([], list, "Wireless Earbuds", 80_01, NOW, SECRET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/above the \$80\.00 maximum/);
  });

  it("allows a price exactly at the item's max when the cap has room", () => {
    const result = authorizePurchase([], list, "wireless earbuds", 80_00, NOW, SECRET);
    expect(result.allowed).toBe(true);
  });

  it("blocks when the approved quantity is already bought", () => {
    const ledger = [bought("Wireless Earbuds", 70_00)];
    const result = authorizePurchase(ledger, list, "Wireless Earbuds", 60_00, NOW, SECRET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/none are left/);
  });

  it("blocks a listed item when the weekly cap would be exceeded", () => {
    const roomy = allow("Wireless Earbuds", 120_00, 2);
    const ledger = [bought("Pro Chef's Knife", 250_00)];
    const result = authorizePurchase(ledger, roomy, "Wireless Earbuds", 60_00, NOW, SECRET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/weekly limit/);
    expect(result.reason).toMatch(/\$10\.00 over/);
  });

  it("checks the list before the weekly cap", () => {
    const ledger = [bought("Pro Chef's Knife", 290_00)];
    const result = authorizePurchase(ledger, list, "Rain Jacket", 50_00, NOW, SECRET);
    expect(result.reason).toMatch(/not on your shopping list/);
  });

  it("checks quantity before max price", () => {
    const ledger = [bought("Wireless Earbuds", 70_00)];
    const result = authorizePurchase(ledger, list, "Wireless Earbuds", 90_00, NOW, SECRET);
    expect(result.reason).toMatch(/none are left/);
  });
});

describe("A tampered client list cannot bypass the server check", () => {
  const signed = allow("Wireless Earbuds", 50_00, 1);

  it("rejects a raised max price that keeps the old signature", () => {
    const tampered = { ...signed, items: [{ ...signed.items[0], maxPrice: 200_00 }] };
    const result = authorizePurchase([], tampered, "Wireless Earbuds", 90_00, NOW, SECRET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/signature mismatch/);
  });

  it("rejects an added item and a raised quantity", () => {
    const extra = { ...signed, items: [...signed.items, { name: "Rain Jacket", maxPrice: 140_00, quantity: 1 }] };
    expect(authorizePurchase([], extra, "Rain Jacket", 90_00, NOW, SECRET).reason).toMatch(/signature mismatch/);
    const more = { ...signed, items: [{ ...signed.items[0], quantity: 9 }] };
    expect(authorizePurchase([], more, "Wireless Earbuds", 40_00, NOW, SECRET).allowed).toBe(false);
  });

  it("ignores client fields that claim the item is allowed or that quantity remains", () => {
    const claimed = {
      ...signed,
      allowAll: true,
      items: signed.items.map((item) => ({ ...item, remaining: 9, onList: true, allowed: true })),
    };
    const offList = authorizePurchase([], claimed, "Espresso Machine Pro", 20_00, NOW, SECRET);
    expect(offList.allowed).toBe(false);
    expect(offList.reason).toMatch(/not on your shopping list/);

    const exhausted = authorizePurchase([bought("Wireless Earbuds", 40_00)], claimed, "Wireless Earbuds", 40_00, NOW, SECRET);
    expect(exhausted.allowed).toBe(false);
    expect(exhausted.reason).toMatch(/none are left/);
  });

  it("rejects a signed ledger entry whose item name was rewritten", () => {
    const list = allow("Wireless Earbuds", 120_00, 1);
    const entry = bought("Wireless Earbuds", 90_00);
    const renamed = { ...entry, itemName: "Not Earbuds" };
    const result = authorizePurchase([renamed], list, "Wireless Earbuds", 90_00, NOW, SECRET);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/signature mismatch/);
    const sellerRenamed = { ...entry, sellerName: "Someone else" };
    expect(authorizePurchase([sellerRenamed], list, "Wireless Earbuds", 90_00, NOW, SECRET).allowed).toBe(false);
  });

  it("rejects an unsigned list and a list signed with another secret", () => {
    const unsigned = { items: [{ name: "Wireless Earbuds", maxPrice: 500_00, quantity: 9 }] };
    expect(authorizePurchase([], unsigned, "Wireless Earbuds", 10_00, NOW, SECRET).allowed).toBe(false);
    const forged = signShoppingList([{ name: "Wireless Earbuds", maxPrice: 500_00, quantity: 9 }], "attacker");
    expect(authorizePurchase([], forged, "Wireless Earbuds", 10_00, NOW, SECRET).reason).toMatch(/signature mismatch/);
    expect(authorizePurchase([], null, "Wireless Earbuds", 10_00, NOW, SECRET).reason).toMatch(/no approved shopping list/i);
  });

  it("does not call the payment rail when the signed list was edited", async () => {
    const pay = vi.fn();
    const tampered = { ...signShoppingList([{ name: "LED Desk Lamp", maxPrice: 20_00, quantity: 1 }]), items: [{ name: "LED Desk Lamp", maxPrice: 80_00, quantity: 1 }] };
    const item = getCatalogItem("lamp")!;
    const events = await collect(purchase(item, toPublicItem(item), 40_00, [], { pay }, tampered));
    expect(events[0]?.type).toBe("blocked");
    expect(pay).not.toHaveBeenCalled();
  });
});

describe("Seller pushes and the model", () => {
  it("sometimes pushes a bundle or a flash deal, and stays quiet for most firm items", () => {
    expect(sellerPushes(getCatalogItem("keyboard")!)[0]).toMatchObject({ kind: "bundle", itemName: "LED Desk Lamp" });
    expect(sellerPushes(getCatalogItem("earbuds")!)[0]).toMatchObject({ kind: "flash", itemName: "Bluetooth Speaker" });
    expect(sellerPushes(getCatalogItem("knife")!)).toHaveLength(1);
    expect(sellerPushes(getCatalogItem("skillet")!)).toHaveLength(0);
    expect(sellerPushes(getCatalogItem("espresso")!)).toHaveLength(0);
  });

  it("declines an off-list flash deal, logs the reason, and does not buy it", async () => {
    const calls: { system: string; user: string }[] = [];
    const reasoner: ReasoningAdapter = {
      provider: "fake",
      model: "fake-model",
      configured: true,
      async completeJson({ system, user }) {
        calls.push({ system, user });
        return { json: { action: "offer", offerPrice: 90, reasoning: ["Take the bundle too."], confidence: 0.9 }, model: "fake-model" };
      },
    };
    const list = signShoppingList([{ name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 }]);
    const events = await collect(runShopping({ query: "earbuds", maxPriceCents: 120_00, priority: "save" }, [], reasoner, undefined, {}, list));
    const declined = events.find((event) => event.type === "declined-offer");
    expect(declined?.type).toBe("declined-offer");
    if (declined?.type !== "declined-offer") return;
    expect(declined.offer.itemName).toBe("Bluetooth Speaker");
    expect(declined.offer.log.startsWith(OFF_LIST_LOG)).toBe(true);
    expect(declined.offer.reasoning.join(" ")).toMatch(/allowlist/);
    expect(events.some((event) => event.type === "purchased" && event.entry.itemName === "Bluetooth Speaker")).toBe(false);
    expect(events.some((event) => event.type === "purchased" && event.entry.itemName === "Wireless Earbuds")).toBe(true);

    expect(calls[0].system).toMatch(/melit-negotiator-v3/);
    expect(calls[0].system).toMatch(/declined: not on your list/);
    const payload = JSON.parse(calls[0].user.slice(calls[0].user.indexOf("{")));
    expect(payload.shoppingList[0]).toMatchObject({ name: "Wireless Earbuds", maxPriceUsd: 120, quantityRemaining: 1 });
    expect(payload.sellerPushes[0]).toMatchObject({ itemName: "Bluetooth Speaker", onList: false });
    expect(calls[0].user).not.toMatch(/floor/i);
  });

  it("does not log an off-list decline for a push that is already approved", async () => {
    const reasoner: ReasoningAdapter = {
      provider: "fake",
      model: "fake-model",
      configured: true,
      async completeJson() {
        return { json: { action: "offer", offerPrice: 90, reasoning: ["Stay on the earbuds."], confidence: 0.8 }, model: "fake-model" };
      },
    };
    const list = signShoppingList([
      { name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 },
      { name: "Bluetooth Speaker", maxPrice: 79_00, quantity: 1 },
    ]);
    const events = await collect(runShopping({ query: "earbuds", maxPriceCents: 120_00, priority: "save" }, [], reasoner, undefined, {}, list));
    expect(events.some((event) => event.type === "declined-offer")).toBe(false);
    const purchased = events.filter((event) => event.type === "purchased");
    expect(purchased).toHaveLength(1);
  });

  it("walks away when the model accepts an item that is not on the list", async () => {
    const earbuds = toPublicItem(getCatalogItem("earbuds")!);
    const reasoner: ReasoningAdapter = {
      provider: "fake",
      model: "fake-model",
      configured: true,
      async completeJson() {
        return { json: { action: "accept", offerPrice: 129, reasoning: ["Buy it anyway."], confidence: 1 }, model: "fake-model" };
      },
    };
    const decision = await decide(
      {
        item: earbuds,
        round: 1,
        maxRounds: 4,
        currentAskCents: earbuds.listPriceCents,
        history: [],
        remainingBudgetCents: 300_00,
        userMaxPriceCents: 200_00,
        priority: "fast",
        shoppingList: [{ name: "Rain Jacket", maxPriceUsd: 110, quantity: 1, quantityRemaining: 1 }],
      },
      reasoner,
    );
    expect(decision.action).toBe("walk");
    expect(decision.guardrails.join(" ")).toMatch(/not on your shopping list/);
  });

  it("clamps a model accept down to the shopping-list maximum", async () => {
    const earbuds = toPublicItem(getCatalogItem("earbuds")!);
    const reasoner: ReasoningAdapter = {
      provider: "fake",
      model: "fake-model",
      configured: true,
      async completeJson() {
        return { json: { action: "accept", offerPrice: 129, reasoning: ["Pay the ask."], confidence: 1 }, model: "fake-model" };
      },
    };
    const decision = await decide(
      {
        item: earbuds,
        round: 1,
        maxRounds: 4,
        currentAskCents: earbuds.listPriceCents,
        history: [],
        remainingBudgetCents: 300_00,
        userMaxPriceCents: 200_00,
        priority: "fast",
        listMaxPriceCents: 80_00,
        quantityRemaining: 1,
        shoppingList: [{ name: "Wireless Earbuds", maxPriceUsd: 80, quantity: 1, quantityRemaining: 1 }],
      },
      reasoner,
    );
    expect(decision.action).toBe("offer");
    expect(decision.offerPriceCents).toBe(80_00);
    expect(decision.guardrails.join(" ")).toMatch(/shopping-list maximum/);
  });

  it("refuses the owner's own off-list request before negotiating", async () => {
    const reasoner: ReasoningAdapter = {
      provider: "fake",
      model: "fake-model",
      configured: true,
      async completeJson() {
        throw new Error("the model must not be asked");
      },
    };
    const list = signShoppingList([{ name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 }]);
    const events = await collect(runShopping({ query: "rain jacket", maxPriceCents: 140_00, priority: "fast" }, [], reasoner, undefined, {}, list));
    expect(events.some((event) => event.type === "round")).toBe(false);
    expect(events.some((event) => event.type === "purchased")).toBe(false);
    const declined = events.find((event) => event.type === "declined-offer" && event.offer.kind === "request");
    expect(declined?.type).toBe("declined-offer");
    if (declined?.type === "declined-offer") expect(declined.offer.log.startsWith(OFF_LIST_LOG)).toBe(true);
    expect(events.some((event) => event.type === "blocked" && /not on your shopping list/.test(event.guard.reason))).toBe(true);
  });
});

describe("List status and the save endpoint", () => {
  it("reports waiting, then bought with the savings", () => {
    const item = { name: "Wireless Earbuds", maxPrice: 120_00, quantity: 2 };
    expect(itemStatus(item, []).state).toBe("waiting");
    const after = itemStatus(item, [{ itemName: "wireless earbuds", savedCents: 40_00 }]);
    expect(after).toMatchObject({ state: "bought", bought: 1, remaining: 1, savedCents: 40_00 });
  });

  it("signs a saved list and rejects a duplicate name", async () => {
    const ok = await POST(
      new Request("http://melit.local/api/shopping-list", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "8.8.4.4" },
        body: JSON.stringify({ items: [{ name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 }] }),
      }),
    );
    expect(ok.status).toBe(200);
    const signed = await ok.json();
    expect(verifyShoppingList(signed).ok).toBe(true);

    const dup = await POST(
      new Request("http://melit.local/api/shopping-list", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": "8.8.4.4" },
        body: JSON.stringify({
          items: [
            { name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 },
            { name: "wireless earbuds", maxPrice: 90_00, quantity: 2 },
          ],
        }),
      }),
    );
    expect(dup.status).toBe(400);
  });

  it("reorders a signed list without treating that as tampering", () => {
    const signed = signShoppingList(
      [
        { name: "Rain Jacket", maxPrice: 100_00, quantity: 1 },
        { name: "Wireless Earbuds", maxPrice: 90_00, quantity: 1 },
      ],
      SECRET,
    );
    const flipped = { ...signed, items: [...signed.items].reverse() };
    const check = verifyShoppingList(flipped, SECRET);
    expect(check.ok).toBe(true);
    expect(checkPurchase({ ledger: [], list: check.ok ? check.items : [], itemName: "Rain Jacket", attemptedCents: 90_00, now: NOW }).allowed).toBe(true);
  });
});
