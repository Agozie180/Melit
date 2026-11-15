export type PaymentRailId = "kite-passport-sandbox" | "direct-testnet" | "recorded" | "simulated";

export const RAIL_LABEL: Record<PaymentRailId, string> = {
  "kite-passport-sandbox": "Kite Passport sandbox",
  "direct-testnet": "Direct testnet transfer",
  recorded: "Recorded receipt (replay)",
  simulated: "Simulated payment",
};

export interface PaymentOrder {
  orderId: string;
  itemId: string;
  itemName: string;
  sellerId: string;
  priceCents: number;
}

export interface RailAttempt {
  rail: PaymentRailId;
  ok: boolean;
  error?: string;
}

export interface PaymentReceipt {
  receiptId: string;
  rail: PaymentRailId;
  amountCents: number;
  /** Amount that actually moved on chain (pieUSD), or null when nothing moved. */
  testnetAmount: string | null;
  asset: string | null;
  payee: string;
  network: string;
  txHash: string | null;
  explorerUrl: string | null;
  settledAt: number;
  /** Plain-language caveats shown next to the receipt (e.g. "replay, no new payment"). */
  note?: string;
  attempts: RailAttempt[];
}

export interface PaymentRail {
  readonly id: PaymentRailId;
  pay(order: PaymentOrder): Promise<Omit<PaymentReceipt, "attempts">>;
}

export class RailError extends Error {
  constructor(
    message: string,
    /** When false the router must NOT try another rail (e.g. a policy denial or an unknown outcome). */
    readonly allowFallback = true,
    readonly code?: string,
  ) {
    super(message);
  }
}

export class PaymentFailedError extends Error {
  constructor(message: string, readonly attempts: RailAttempt[]) {
    super(message);
  }
}
