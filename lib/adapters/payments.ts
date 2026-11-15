// SERVER-ONLY. Payments adapter.
//
// Real Kite payments use x402: the paid endpoint answers HTTP 402 with a PAYMENT-REQUIRED
// challenge, the payer signs an EIP-3009 TransferWithAuthorization (USDC.e on Kite mainnet
// eip155:2366, pieUSD on testnet eip155:2368) and retries with PAYMENT-SIGNATURE, and a
// facilitator settles it (see gokite-ai/kite-x402-services and BrKDDD/kite-x402-hono).
// The mock sellers have no wallets and Melit holds no keys, so payments are simulated.
// TODO(kite): add KiteX402PaymentAdapter that pays through an approved Kite Passport session.

import { randomUUID } from "node:crypto";
import type { PaymentReceipt } from "../types";

export interface PaymentAdapter {
  readonly mode: PaymentReceipt["mode"];
  pay(args: { amountCents: number; payee: string; memo: string }): Promise<PaymentReceipt>;
}

export class SimulatedPaymentAdapter implements PaymentAdapter {
  readonly mode = "simulated" as const;

  async pay(args: { amountCents: number; payee: string; memo: string }): Promise<PaymentReceipt> {
    return {
      receiptId: `sim_${randomUUID()}`,
      mode: "simulated",
      amountCents: args.amountCents,
      payee: args.payee,
      network: "none (simulated, x402/Kite-ready)",
      txHash: null,
      settledAt: Date.now(),
    };
  }
}

export function getPaymentAdapter(): PaymentAdapter {
  return new SimulatedPaymentAdapter();
}
