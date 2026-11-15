// SERVER-ONLY. Short-lived locks and pending rows so concurrent purchases cannot double-spend.

import type { LedgerEntry } from "../types";
import type { PaymentOrder } from "../payments/types";
import { authorizePurchase } from "./shopping-list";
import {
  finalizePendingPurchase,
  loadDemoState,
  PurchaseBlockedError,
  releasePendingPurchase,
  reservePendingPurchase,
} from "./demo-state";
import type { RunHooks } from "../negotiation/run";

export function isPurchaseBlocked(err: unknown): err is PurchaseBlockedError {
  return err instanceof PurchaseBlockedError;
}

/** Hooks that re-check the Spend Guard under lock immediately before pay and append. */
export function purchaseHooks(scopeId: string, fallbackList: unknown): RunHooks {
  let listHint = fallbackList;
  return {
    onBeforePay: async (order: PaymentOrder) => {
      const state = await loadDemoState(scopeId);
      if (state.list) listHint = state.list;
      await reservePendingPurchase(scopeId, order, listHint);
    },
    onLedgerAppend: async (entry: LedgerEntry, order: PaymentOrder) => {
      await finalizePendingPurchase(scopeId, order.orderId, entry);
    },
    onPaymentFailed: async (order: PaymentOrder) => {
      await releasePendingPurchase(scopeId, order.orderId);
    },
  };
}
