// SERVER-ONLY. Rails that move no money: a simulated receipt, and a replay of real testnet
// receipts recorded on a local run (for the deployed demo, where kpass can't run).

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { normalizeItemName } from "../shopping/list";
import { z } from "zod";
import { RailError, type PaymentOrder, type PaymentRail, type PaymentReceipt } from "./types";

export class SimulatedRail implements PaymentRail {
  readonly id = "simulated" as const;

  async pay(order: PaymentOrder): Promise<Omit<PaymentReceipt, "attempts">> {
    return {
      receiptId: `sim_${randomUUID()}`,
      rail: this.id,
      amountCents: order.priceCents,
      testnetAmount: null,
      asset: null,
      payee: `mock-seller:${order.sellerId}`,
      network: "none",
      txHash: null,
      explorerUrl: null,
      settledAt: Date.now(),
      note: "Simulated. No money moved and nothing was sent on chain.",
    };
  }
}

const RecordedSchema = z.object({
  rail: z.enum(["kite-passport-sandbox", "direct-testnet"]),
  txHash: z.string().nullable(),
  explorerUrl: z.string().url().nullable(),
  testnetAmount: z.string().nullable(),
  asset: z.string().nullable(),
  payee: z.string(),
  network: z.string(),
  itemName: z.string(),
  amountCents: z.number().int(),
  recordedAt: z.number().int(),
});
export type RecordedReceipt = z.infer<typeof RecordedSchema>;

const DEFAULT_RECORDED_RECEIPTS = join(process.cwd(), "data", "recorded-receipts.json");

export function recordedReceiptsPath(): string {
  return process.env.MELIT_RECORDED_RECEIPTS_PATH || DEFAULT_RECORDED_RECEIPTS;
}

export function loadRecordedReceipts(path = recordedReceiptsPath()): RecordedReceipt[] {
  if (!existsSync(/* turbopackIgnore: true */ path)) return [];
  try {
    return z.array(RecordedSchema).parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ path, "utf8")));
  } catch {
    return [];
  }
}

/** Appends a real testnet receipt (local runs with MELIT_RECORD_RECEIPTS=1 only). */
export function recordReceipt(receipt: PaymentReceipt, itemName: string, path = recordedReceiptsPath()) {
  if (receipt.rail !== "kite-passport-sandbox" && receipt.rail !== "direct-testnet") return;
  const all = loadRecordedReceipts(path);
  all.push({
    rail: receipt.rail,
    txHash: receipt.txHash,
    explorerUrl: receipt.explorerUrl,
    testnetAmount: receipt.testnetAmount,
    asset: receipt.asset,
    payee: receipt.payee,
    network: receipt.network,
    itemName,
    amountCents: receipt.amountCents,
    recordedAt: receipt.settledAt,
  });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(all, null, 2) + "\n");
}

export class RecordedRail implements PaymentRail {
  readonly id = "recorded" as const;
  private next = 0;

  constructor(private readonly receipts: RecordedReceipt[] = loadRecordedReceipts()) {}

  async pay(order: PaymentOrder): Promise<Omit<PaymentReceipt, "attempts">> {
    if (this.receipts.length === 0) throw new RailError("No recorded testnet receipts are available to replay.");
    const forItem = this.receipts.filter((row) => normalizeItemName(row.itemName) === normalizeItemName(order.itemName));
    const pool = forItem.length ? forItem : this.receipts;
    const r = pool[this.next++ % pool.length]!;
    const when = new Date(r.recordedAt).toISOString().replace("T", " ").slice(0, 16);
    const amountNote =
      r.amountCents !== order.priceCents
        ? ` Ledger amount is ${order.priceCents}¢; the replayed tx was for ${r.amountCents}¢.`
        : "";
    return {
      receiptId: `rec_${randomUUID()}`,
      rail: this.id,
      amountCents: order.priceCents,
      testnetAmount: r.testnetAmount,
      asset: r.asset,
      payee: r.payee,
      network: r.network,
      txHash: r.txHash,
      explorerUrl: r.explorerUrl,
      settledAt: Date.now(),
      note: `Recorded: replays a real ${r.rail === "direct-testnet" ? "direct testnet transfer" : "Kite Passport sandbox payment"} for "${r.itemName}" made ${when} UTC on a local run. No new payment was made.${amountNote}`,
    };
  }
}
