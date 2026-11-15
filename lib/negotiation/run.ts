// SERVER-ONLY. Orchestrates one shopping request end to end and yields feed events:
// negotiate (SERV-driven) -> deal check -> Spend Guard -> payment rail -> signed ledger entry.

import { randomUUID } from "node:crypto";
import type { FeedEvent, LedgerEntry, PublicItem, ShoppingRequest } from "../types";
import { formatUsd } from "../money";
import { CATALOG, findItem, getCatalogItem, toPublicItem, type CatalogItem } from "../market/catalog";
import { MAX_ROUNDS, sellerRespond } from "../market/seller";
import { checkSpend } from "../guard/spend-guard";
import { authorizeSpend, signEntry, verifyLedger } from "../server/ledger";
import { getPaymentRouter } from "../payments";
import { recordReceipt } from "../payments/offline-rails";
import { PaymentFailedError, type PaymentOrder, type PaymentReceipt } from "../payments/types";
import type { ReasoningAdapter } from "../adapters/reasoning";
import { decide, type HistoryTurn } from "./negotiator";

export interface PurchaseDeps {
  /** Pays an approved order. Only ever called after the Spend Guard has said yes. */
  pay: (order: PaymentOrder) => Promise<PaymentReceipt>;
}

const defaultDeps = (): PurchaseDeps => {
  const router = getPaymentRouter();
  return { pay: (order) => router.pay(order) };
};

export async function* runShopping(
  request: ShoppingRequest,
  rawLedger: unknown,
  reasoner: ReasoningAdapter,
  deps: PurchaseDeps = defaultDeps(),
): AsyncGenerator<FeedEvent> {
  const catalogItem = findItem(request.query);
  if (!catalogItem) {
    yield { type: "error", message: `No seller in the mock market has "${request.query}". Try one of the listed items.` };
    return;
  }
  const item = toPublicItem(catalogItem);

  const ledgerCheck = verifyLedger(rawLedger);
  if (!ledgerCheck.ok) {
    yield { type: "error", message: ledgerCheck.reason };
    return;
  }
  const remaining = checkSpend({ ledger: ledgerCheck.entries, attemptedCents: 1, now: Date.now() }).remainingCents;
  yield { type: "start", item, request, remainingCents: remaining };

  let ask = catalogItem.listPriceCents;
  const history: HistoryTurn[] = [];
  let dealPrice: number | undefined;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const decision = await decide(
      {
        item,
        round,
        maxRounds: MAX_ROUNDS,
        currentAskCents: ask,
        history,
        remainingBudgetCents: remaining,
        userMaxPriceCents: request.maxPriceCents,
        priority: request.priority,
      },
      reasoner,
    );
    const askBefore = ask;

    if (decision.action === "walk") {
      yield { type: "round", round: { round, askBeforeCents: askBefore, decision } };
      yield { type: "no-deal", message: "Melit walked away: the deal wasn't good enough within your limits." };
      return;
    }

    if (decision.action === "accept") {
      yield { type: "round", round: { round, askBeforeCents: askBefore, decision } };
      dealPrice = ask;
      yield { type: "deal", priceCents: ask, message: `Melit accepted the seller's ask of ${formatUsd(ask)}.` };
      break;
    }

    const reply = sellerRespond(catalogItem, decision.offerPriceCents, ask, round);
    yield { type: "round", round: { round, askBeforeCents: askBefore, decision, seller: reply } };
    history.push({
      round,
      melitAction: "offer",
      melitOfferCents: decision.offerPriceCents,
      sellerStatus: reply.status,
      sellerPriceCents: reply.status === "walk" ? undefined : reply.priceCents,
      sellerMessage: reply.message,
    });

    if (reply.status === "accept") {
      dealPrice = reply.priceCents;
      yield { type: "deal", priceCents: reply.priceCents, message: `Seller accepted Melit's offer of ${formatUsd(reply.priceCents)}.` };
      break;
    }
    if (reply.status === "walk") {
      yield { type: "no-deal", message: "The seller walked away after the final round. Nothing was bought." };
      return;
    }
    ask = reply.priceCents;
  }

  if (dealPrice === undefined) {
    yield { type: "no-deal", message: "No deal within the round limit. Nothing was bought." };
    return;
  }
  if (dealPrice > request.maxPriceCents) {
    yield { type: "no-deal", message: `Deal price ${formatUsd(dealPrice)} is above your max of ${formatUsd(request.maxPriceCents)}. Not buying.` };
    return;
  }

  yield* purchase(catalogItem, item, dealPrice, rawLedger, deps);
}

/**
 * Spend Guard, then a payment rail, then a signed ledger entry. Every purchase path goes
 * through here, and no rail is touched unless the guard approved the exact amount.
 */
export async function* purchase(
  catalogItem: CatalogItem,
  item: PublicItem,
  priceCents: number,
  rawLedger: unknown,
  deps: PurchaseDeps = defaultDeps(),
): AsyncGenerator<FeedEvent> {
  const guard = authorizeSpend(rawLedger, priceCents, Date.now());
  if (!guard.allowed) {
    yield { type: "blocked", guard, item, priceCents };
    return;
  }

  const order: PaymentOrder = {
    orderId: randomUUID(),
    itemId: item.id,
    itemName: item.name,
    sellerId: catalogItem.sellerId,
    priceCents,
  };

  let receipt: PaymentReceipt;
  try {
    receipt = await deps.pay(order);
  } catch (err) {
    const attempts = err instanceof PaymentFailedError ? err.attempts : [];
    yield {
      type: "payment-failed",
      message: `Payment failed, so nothing was bought: ${(err as Error).message}`,
      attempts,
      item,
      priceCents,
    };
    return;
  }

  if (process.env.MELIT_RECORD_RECEIPTS === "1") {
    try {
      recordReceipt(receipt, item.name);
    } catch (e) {
      console.warn("[melit] could not record receipt", e);
    }
  }

  const entry: LedgerEntry = signEntry({
    id: `led_${order.orderId}`,
    itemId: item.id,
    itemName: item.name,
    sellerName: item.sellerName,
    listPriceCents: item.listPriceCents,
    paidCents: priceCents,
    savedCents: item.listPriceCents - priceCents,
    timestamp: Date.now(),
    receiptId: receipt.receiptId,
    rail: receipt.rail,
    txHash: receipt.txHash,
    explorerUrl: receipt.explorerUrl,
    testnetAmount: receipt.testnetAmount,
  });
  yield { type: "purchased", entry, receipt, guard };
}

/** Demo: Melit tries to buy something that doesn't fit the remaining weekly budget. */
export async function* runOverspend(rawLedger: unknown, deps: PurchaseDeps = defaultDeps()): AsyncGenerator<FeedEvent> {
  const check = verifyLedger(rawLedger);
  const remaining = check.ok ? checkSpend({ ledger: check.entries, attemptedCents: 1, now: Date.now() }).remainingCents : 0;
  // Cheapest item that no longer fits, so the block is about the rolling total, not a silly price.
  // The espresso machine (> $300) always qualifies as a last resort.
  const target =
    [...CATALOG].sort((a, b) => a.listPriceCents - b.listPriceCents).find((i) => i.listPriceCents > remaining) ??
    getCatalogItem("espresso")!;
  const item = toPublicItem(target);
  yield {
    type: "start",
    item,
    request: { query: item.name, maxPriceCents: target.listPriceCents, priority: "fast" },
    remainingCents: remaining,
  };
  yield* purchase(target, item, target.listPriceCents, rawLedger, deps);
}
