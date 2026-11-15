import { beforeEach, describe, expect, it, vi } from "vitest";
import { KitePassportSandboxRail, type KpassResult, type KpassRunner } from "../lib/payments/kpass-rail";
import { resetSandboxMerchantCache } from "../lib/kite/sandbox-merchant";
import { PaymentRouter } from "../lib/payments/router";
import { RecordedRail } from "../lib/payments/offline-rails";
import { signOrder, verifyOrder } from "../lib/payments/order-token";
import { PaymentFailedError, type PaymentOrder, type PaymentRail } from "../lib/payments/types";
import { centsToTestnetUnits, formatTestnetAmount } from "../lib/kite/config";
import { purchase, runOverspend, type PurchaseDeps } from "../lib/negotiation/run";
import { getCatalogItem, toPublicItem } from "../lib/market/catalog";
import { signEntry, verifyEntry } from "../lib/server/ledger";
import { signShoppingList } from "../lib/server/shopping-list";
import type { FeedEvent } from "../lib/types";

const SELLER_URL = "https://melit.example";

function sandboxOk(): KpassResult {
  return { exitCode: 0, json: { status: "success", mode: "sandbox" }, stderr: "" };
}

/** Fake kpass: answers `sandbox status` with `mode`, and `session execute` with `execute`. */
function fakeKpass(execute: KpassResult, mode: KpassResult = sandboxOk()) {
  const calls: string[][] = [];
  const run: KpassRunner = async (args) => {
    calls.push(args);
    if (args[0] === "sandbox") return mode;
    return execute;
  };
  return { run, calls };
}

function fakeDirectRail(): PaymentRail & { pay: ReturnType<typeof vi.fn> } {
  return {
    id: "direct-testnet",
    pay: vi.fn(async (order: PaymentOrder) => ({
      receiptId: "tx_abc",
      rail: "direct-testnet" as const,
      amountCents: order.priceCents,
      testnetAmount: formatTestnetAmount(centsToTestnetUnits(order.priceCents)),
      asset: "pieUSD",
      payee: "0x000000000000000000000000000000000000dEaD",
      network: "eip155:2368",
      txHash: "0x" + "ab".repeat(32),
      explorerUrl: "https://testnet.kitescan.ai/tx/0x" + "ab".repeat(32),
      settledAt: Date.now(),
    })),
  };
}

const order: PaymentOrder = { orderId: "ord-1", itemId: "earbuds", itemName: "Wireless Earbuds", sellerId: "breezy", priceCents: 90_00 };

function ledgerWith(paidCents: number) {
  return [
    signEntry({
      id: "led_1",
      itemId: "chair",
      itemName: "Ergonomic Office Chair",
      sellerName: "Bundle Barn (mock)",
      listPriceCents: paidCents + 10_00,
      paidCents,
      savedCents: 10_00,
      timestamp: Date.now() - 60_000,
      receiptId: "tx_1",
      rail: "direct-testnet",
      txHash: "0x" + "cd".repeat(32),
      explorerUrl: null,
      testnetAmount: "2.9",
    }),
  ];
}

async function collect(gen: AsyncGenerator<FeedEvent>) {
  const out: FeedEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("Spend Guard runs before any payment rail", () => {
  it("blocks an over-cap purchase without calling kpass or sending a transfer", async () => {
    const kpass = fakeKpass(sandboxOk());
    const direct = fakeDirectRail();
    const router = new PaymentRouter([new KitePassportSandboxRail(kpass.run, SELLER_URL), direct]);
    const deps: PurchaseDeps = { pay: (o) => router.pay(o) };

    const item = getCatalogItem("earbuds")!;
    const list = signShoppingList([{ name: "Wireless Earbuds", maxPrice: 120_00, quantity: 1 }]);
    const events = await collect(purchase(item, toPublicItem(item), 20_00, ledgerWith(290_00), deps, list));

    expect(events.map((e) => e.type)).toEqual(["blocked"]);
    expect(kpass.calls).toHaveLength(0);
    expect(direct.pay).not.toHaveBeenCalled();
  });

  it("the overspend demo never reaches a rail", async () => {
    const pay = vi.fn();
    const events = await collect(runOverspend(ledgerWith(250_00), { pay }));
    expect(events.some((e) => e.type === "blocked")).toBe(true);
    expect(pay).not.toHaveBeenCalled();
  });

  it("a tampered ledger blocks before any rail", async () => {
    const pay = vi.fn();
    const tampered = ledgerWith(250_00).map((e) => ({ ...e, paidCents: 1_00 }));
    const item = getCatalogItem("lamp")!;
    const events = await collect(purchase(item, toPublicItem(item), 40_00, tampered, { pay }));
    expect(events[0].type).toBe("blocked");
    expect(pay).not.toHaveBeenCalled();
  });
});

describe("rail fallback", () => {
  beforeEach(() => {
    resetSandboxMerchantCache();
  });

  it("falls back to a direct testnet transfer when Passport errors", async () => {
    const kpass = fakeKpass({
      exitCode: 1,
      json: { status: "error", error_code: "host_not_in_executable_catalog", error: "host is not in the executable catalog" },
      stderr: "",
    });
    const direct = fakeDirectRail();
    const router = new PaymentRouter([new KitePassportSandboxRail(kpass.run, SELLER_URL), direct]);

    const receipt = await router.pay(order);

    expect(receipt.rail).toBe("direct-testnet");
    expect(receipt.explorerUrl).toMatch(/^https:\/\/testnet\.kitescan\.ai\/tx\/0x/);
    expect(receipt.attempts).toEqual([
      { rail: "kite-passport-sandbox", ok: false, error: expect.stringContaining("host_not_in_executable_catalog") },
      { rail: "direct-testnet", ok: true },
    ]);
    expect(direct.pay).toHaveBeenCalledTimes(1);
  });

  it("registers the merchant host before session execute", async () => {
    const kpass = fakeKpass({
      exitCode: 0,
      json: {
        status: "success",
        x402: { status_code: 200, chain_id: 2368, payment_response: { reference: "0x" + "cd".repeat(32), success: true } },
        payment_requirement: { amount: "0.9", asset: "pieUSD" },
      },
      stderr: "",
    });
    await new PaymentRouter([new KitePassportSandboxRail(kpass.run, SELLER_URL)]).pay(order);
    const register = kpass.calls.find((c) => c.includes("merchant") && (c.includes("register") || c.includes("allowlist")));
    expect(register).toBeTruthy();
    const execIdx = kpass.calls.findIndex((c) => c[0] === "session");
    const regIdx = kpass.calls.findIndex((c) => c === register);
    expect(regIdx).toBeGreaterThanOrEqual(0);
    expect(regIdx).toBeLessThan(execIdx);
  });

  it("calls kpass with explicit args and a signed seller checkout URL", async () => {
    const kpass = fakeKpass({
      exitCode: 0,
      json: {
        status: "success",
        x402: { status_code: 200, chain_id: 2368 },
        payment: { payment_response: { reference: "0x" + "ef".repeat(32) } },
        payment_requirement: { amount: "0.9", asset: "pieUSD" },
      },
      stderr: "",
    });
    const receipt = await new PaymentRouter([new KitePassportSandboxRail(kpass.run, SELLER_URL)]).pay(order);

    const exec = kpass.calls.find((c) => c[0] === "session")!;
    expect(exec.slice(0, 4)).toEqual(["session", "execute", "--method", "GET"]);
    const url = new URL(exec[exec.indexOf("--url") + 1]);
    expect(url.origin + url.pathname).toBe(`${SELLER_URL}/api/sellers/breezy/checkout`);
    expect(verifyOrder(url.searchParams.get("order"))).toMatchObject({ orderId: "ord-1", priceCents: 90_00 });
    expect(exec[exec.indexOf("--idempotency-key") + 1]).toBe("ord-1");
    expect(receipt.rail).toBe("kite-passport-sandbox");
    expect(receipt.explorerUrl).toBe("https://testnet.kitescan.ai/tx/0x" + "ef".repeat(32));
  });

  it("refuses to pay through kpass outside sandbox mode, then falls back", async () => {
    const kpass = fakeKpass(sandboxOk(), { exitCode: 0, json: { status: "success", mode: "live" }, stderr: "" });
    const direct = fakeDirectRail();
    const receipt = await new PaymentRouter([new KitePassportSandboxRail(kpass.run, SELLER_URL), direct]).pay(order);
    expect(kpass.calls.some((c) => c[0] === "session")).toBe(false);
    expect(receipt.rail).toBe("direct-testnet");
  });

  it("does NOT fall back when the Passport session cap refuses (second guard layer)", async () => {
    const kpass = fakeKpass({ exitCode: 6, json: { status: "error", error_code: "session_total_exceeded", error: "used up" }, stderr: "" });
    const direct = fakeDirectRail();
    const router = new PaymentRouter([new KitePassportSandboxRail(kpass.run, SELLER_URL), direct]);
    await expect(router.pay(order)).rejects.toBeInstanceOf(PaymentFailedError);
    expect(direct.pay).not.toHaveBeenCalled();
  });

  it("does NOT fall back when the Passport outcome is unknown (could double-pay)", async () => {
    const kpass = fakeKpass({ exitCode: 7, json: { status: "error", error_code: "payment_outcome_pending" }, stderr: "" });
    const direct = fakeDirectRail();
    await expect(new PaymentRouter([new KitePassportSandboxRail(kpass.run, SELLER_URL), direct]).pay(order)).rejects.toThrow(/unknown/);
    expect(direct.pay).not.toHaveBeenCalled();
  });

  it("a failed payment produces no ledger entry", async () => {
    const router = new PaymentRouter([]);
    const item = getCatalogItem("lamp")!;
    const list = signShoppingList([{ name: "LED Desk Lamp", maxPrice: 49_00, quantity: 1 }]);
    const events = await collect(purchase(item, toPublicItem(item), 40_00, [], { pay: (o) => router.pay(o) }, list));
    expect(events.map((e) => e.type)).toEqual(["payment-failed"]);
  });
});

describe("testnet plumbing", () => {
  it("scales dollars down to small pieUSD amounts", () => {
    expect(formatTestnetAmount(centsToTestnetUnits(100, 0.01))).toBe("0.01");
    expect(formatTestnetAmount(centsToTestnetUnits(300_00, 0.01))).toBe("3");
    expect(formatTestnetAmount(centsToTestnetUnits(86_90, 0.01))).toBe("0.869");
    expect(centsToTestnetUnits(100, 1)).toBe(10n ** 18n);
  });

  it("order tokens reject tampering and expiry", () => {
    const token = signOrder(order, 1_000);
    expect(verifyOrder(token, 2_000)).toMatchObject(order);
    expect(verifyOrder(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), 2_000)).toBeNull();
    expect(verifyOrder(token, 1_000 + 11 * 60 * 1000)).toBeNull();
  });

  it("ledger signatures cover the rail and tx hash", () => {
    const [entry] = ledgerWith(10_00);
    expect(verifyEntry(entry)).toBe(true);
    expect(verifyEntry({ ...entry, rail: "kite-passport-sandbox" })).toBe(false);
    expect(verifyEntry({ ...entry, txHash: "0x" + "00".repeat(32) })).toBe(false);
  });

  it("recorded receipts say clearly that no new payment was made", async () => {
    const rail = new RecordedRail([
      {
        rail: "direct-testnet",
        txHash: "0x" + "12".repeat(32),
        explorerUrl: "https://testnet.kitescan.ai/tx/0x" + "12".repeat(32),
        testnetAmount: "0.869",
        asset: "pieUSD",
        payee: "0x000000000000000000000000000000000000dEaD",
        network: "eip155:2368",
        itemName: "Wireless Earbuds",
        amountCents: 86_90,
        recordedAt: Date.UTC(2026, 10, 15, 10, 0),
      },
    ]);
    const receipt = await rail.pay(order);
    expect(receipt.rail).toBe("recorded");
    expect(receipt.note).toMatch(/No new payment was made/);
  });
});
