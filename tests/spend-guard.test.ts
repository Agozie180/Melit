import { describe, expect, it } from "vitest";
import { checkSpend, spentInWindow } from "../lib/guard/spend-guard";
import { authorizeSpend, signEntry } from "../lib/server/ledger";
import { WINDOW_MS } from "../lib/money";
import type { LedgerEntry } from "../lib/types";

const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "test-secret";

function entry(paidCents: number, timestamp: number, id = `e-${paidCents}-${timestamp}`): LedgerEntry {
  return signEntry(
    {
      id,
      itemId: "knife",
      itemName: "Pro Chef's Knife",
      sellerName: "Granite & Co. (mock)",
      listPriceCents: paidCents + 1000,
      paidCents,
      savedCents: 1000,
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

describe("Spend Guard (pure)", () => {
  it("allows a purchase that lands exactly on the $300 cap", () => {
    const ledger = [entry(200_00, NOW - DAY)];
    const r = checkSpend({ ledger, attemptedCents: 100_00, now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.spentInWindowCents).toBe(200_00);
  });

  it("blocks a purchase one cent over the cap", () => {
    const ledger = [entry(200_00, NOW - DAY)];
    const r = checkSpend({ ledger, attemptedCents: 100_01, now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/\$0\.01 over/);
  });

  it("blocks a single purchase above $300 on an empty ledger", () => {
    const r = checkSpend({ ledger: [], attemptedCents: 349_00, now: NOW });
    expect(r.allowed).toBe(false);
  });

  it("frees budget once a purchase rolls out of the 7-day window", () => {
    const ledger = [entry(250_00, NOW - 6 * DAY)];
    expect(checkSpend({ ledger, attemptedCents: 100_00, now: NOW }).allowed).toBe(false);

    // Exactly 7 days after the purchase it no longer counts.
    const later = NOW + DAY;
    expect(spentInWindow(ledger, later)).toBe(0);
    expect(checkSpend({ ledger, attemptedCents: 100_00, now: later }).allowed).toBe(true);

    // One millisecond before that, it still counts.
    expect(spentInWindow(ledger, NOW - 6 * DAY + WINDOW_MS - 1)).toBe(250_00);
  });

  it("counts future-dated entries instead of ignoring them", () => {
    const ledger = [entry(290_00, NOW + 3 * DAY)];
    expect(checkSpend({ ledger, attemptedCents: 20_00, now: NOW }).allowed).toBe(false);
  });

  it("rejects zero, negative, fractional and NaN amounts", () => {
    for (const bad of [0, -100, 10.5, Number.NaN]) {
      expect(checkSpend({ ledger: [], attemptedCents: bad, now: NOW }).allowed).toBe(false);
    }
  });

  it("never lets a negative ledger amount act as a refund", () => {
    const ledger = [
      { paidCents: 300_00, timestamp: NOW - DAY },
      { paidCents: -300_00, timestamp: NOW - DAY },
    ];
    expect(checkSpend({ ledger, attemptedCents: 1, now: NOW }).allowed).toBe(false);
  });
});

describe("Server authorization with a client-held ledger", () => {
  const honest = [entry(150_00, NOW - 2 * DAY, "a"), entry(120_00, NOW - DAY, "b")];

  it("recomputes from entries and ignores a client-supplied total", () => {
    const tampered = honest.map((e) => ({ ...e, weeklySpentCents: 0 }));
    const r = authorizeSpend(tampered, 40_00, NOW, SECRET);
    expect(r.spentInWindowCents).toBe(270_00);
    expect(r.allowed).toBe(false);
  });

  it("blocks when the client lowers a paid amount", () => {
    const tampered = [{ ...honest[0], paidCents: 1_00 }, honest[1]];
    const r = authorizeSpend(tampered, 40_00, NOW, SECRET);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/signature mismatch/);
  });

  it("blocks when the client back-dates a purchase out of the window", () => {
    const tampered = [{ ...honest[0], timestamp: NOW - 30 * DAY }, honest[1]];
    const r = authorizeSpend(tampered, 40_00, NOW, SECRET);
    expect(r.allowed).toBe(false);
  });

  it("blocks forged entries signed with a different secret", () => {
    const forged = signEntry({ ...honest[0], id: "forged", paidCents: 0 }, "attacker-secret");
    const r = authorizeSpend([forged], 10_00, NOW, SECRET);
    expect(r.allowed).toBe(false);
  });

  it("blocks a malformed ledger", () => {
    expect(authorizeSpend({ not: "an array" }, 10_00, NOW, SECRET).allowed).toBe(false);
    expect(authorizeSpend([{ paidCents: -5 }], 10_00, NOW, SECRET).allowed).toBe(false);
  });

  it("approves an honest ledger with room left", () => {
    const r = authorizeSpend(honest, 30_00, NOW, SECRET);
    expect(r.allowed).toBe(true);
    expect(r.remainingCents).toBe(30_00);
  });
});
