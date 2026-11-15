import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signEntry, verifyLedger } from "../lib/server/ledger";
import { loadDemoState, resetLedger, wipeDemoSession } from "../lib/server/demo-state";
import { kvSet } from "../lib/server/kv";
import { authorizePurchase, signShoppingList } from "../lib/server/shopping-list";
import type { LedgerEntry } from "../lib/types";

const SECRET = "melit-demo-state-test-secret";

function storageKey(scope: string) {
  return `melit:demo:${scope}`;
}

function entry(partial: Partial<LedgerEntry>): LedgerEntry {
  return signEntry(
    {
      id: "led_1",
      itemId: "lamp",
      itemName: "LED Desk Lamp",
      sellerName: "Bright Cove",
      listPriceCents: 49_00,
      paidCents: 40_00,
      savedCents: 9_00,
      timestamp: Date.now(),
      receiptId: "sim_1",
      rail: "simulated",
      txHash: null,
      explorerUrl: null,
      testnetAmount: null,
      ...partial,
    },
    SECRET,
  );
}

describe("financial state fail-closed", () => {
  const scope = `test_${randomUUID()}`;

  beforeEach(() => {
    process.env.MELIT_LEDGER_SECRET = SECRET;
  });

  afterEach(async () => {
    await wipeDemoSession(scope);
  });

  it("keeps a tampered ledger intact and blocks spending instead of wiping it", async () => {
    const good = entry({});
    const tampered = { ...good, paidCents: 1_00 };
    await kvSet(
      storageKey(scope),
      JSON.stringify({ version: 1, ledger: [tampered], list: null, ledgerIntegrity: "ok", pending: [] }),
    );

    const state = await loadDemoState(scope);
    expect(state.ledger).toHaveLength(1);
    expect(state.ledger[0].paidCents).toBe(1_00);
    expect(state.ledgerIntegrity).toBe("invalid");
    expect(state.ledgerInvalidReason).toMatch(/signature mismatch/i);

    const list = signShoppingList([{ name: "LED Desk Lamp", maxPrice: 49_00, quantity: 1 }], SECRET);
    const guard = authorizePurchase(state.ledger, list, "LED Desk Lamp", 20_00, Date.now(), SECRET);
    expect(guard.allowed).toBe(false);
    expect(guard.reason).toMatch(/signature mismatch/i);
    expect(verifyLedger(state.ledger, SECRET).ok).toBe(false);
  });

  it("reset clears a locked ledger so spending can resume", async () => {
    const bad = entry({});
    const tampered = { ...bad, itemName: "Espresso Machine Pro" };
    await kvSet(
      storageKey(scope),
      JSON.stringify({ version: 2, ledger: [tampered], list: null, ledgerIntegrity: "invalid", pending: [] }),
    );
    await resetLedger(scope);
    const state = await loadDemoState(scope);
    expect(state.ledger).toEqual([]);
    expect(state.ledgerIntegrity).toBe("ok");
  });
});