// SERVER-ONLY. Chooses the payment rails from the environment.
//
// MELIT_PAYMENT_MODE:
//   testnet   -> Kite Passport sandbox (if MELIT_KPASS=1), then direct testnet transfer (if AGENT_PRIVATE_KEY)
//   recorded  -> replay receipts from data/recorded-receipts.json, else simulated
//   simulated -> simulated receipts only
// Default: testnet when either testnet rail is configured, recorded on Vercel, simulated otherwise.

import { KitePassportSandboxRail } from "./kpass-rail";
import { RecordedRail, SimulatedRail } from "./offline-rails";
import { PaymentRouter } from "./router";
import { DirectTestnetRail } from "./testnet-rail";
import type { PaymentRail } from "./types";

export type PaymentMode = "testnet" | "recorded" | "simulated";

export function kpassEnabled(): boolean {
  return process.env.MELIT_KPASS === "1";
}

export function directTestnetEnabled(): boolean {
  return Boolean(process.env.AGENT_PRIVATE_KEY);
}

export function paymentMode(): PaymentMode {
  const explicit = process.env.MELIT_PAYMENT_MODE;
  if (explicit === "testnet" || explicit === "recorded" || explicit === "simulated") return explicit;
  if (kpassEnabled() || directTestnetEnabled()) return "testnet";
  return process.env.VERCEL ? "recorded" : "simulated";
}

export function configuredRails(mode = paymentMode()): PaymentRail[] {
  switch (mode) {
    case "testnet": {
      const rails: PaymentRail[] = [];
      if (kpassEnabled()) rails.push(new KitePassportSandboxRail());
      if (directTestnetEnabled()) rails.push(new DirectTestnetRail());
      return rails;
    }
    case "recorded":
      return [new RecordedRail(), new SimulatedRail()];
    case "simulated":
      return [new SimulatedRail()];
  }
}

export function getPaymentRouter(): PaymentRouter {
  return new PaymentRouter(configuredRails());
}
