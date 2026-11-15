// SERVER-ONLY. Orchestrates one shopping request end to end and yields feed events:
// negotiate (SERV-driven) -> deal check -> Spend Guard -> payment rail -> signed ledger entry.

import { randomUUID } from "node:crypto";
import type { FeedEvent, LedgerEntry, PublicItem, ShoppingRequest } from "../types";
import { centsToDollars, formatUsd } from "../money";
import { CATALOG, findItem, getCatalogItem, toPublicItem, type CatalogItem } from "../market/catalog";
import { sellerPushes } from "../market/offers";
import { MAX_ROUNDS, sellerRespond } from "../market/seller";
import { checkSpend } from "../guard/spend-guard";
import { signEntry, verifyLedger } from "../server/ledger";
import { authorizePurchase, NO_LIST_REASON, verifyShoppingList } from "../server/shopping-list";
import { declineOffer, findListItem, unitsBought } from "../shopping/list";
import { getPaymentRouter } from "../payments";
import { recordReceipt } from "../payments/offline-rails";
import { PaymentFailedError, type PaymentOrder, type PaymentReceipt } from "../payments/types";
import type { ReasoningAdapter } from "../adapters/reasoning";
import { decide, type HistoryTurn } from "./negotiator";
import { DEFAULT_PROFILE, parseProfile, type StrategyProfile } from "../learning/profile";
import { reputationFor } from "../learning/reputation";
import type { DealOutcome, DealSummary, SummaryRound } from "../learning/types";
import { reviewDeal, verifiedReviews } from "../market/reviews";
import { signDealSummary } from "../server/deal-summary";

export interface PurchaseDeps {
  /** Pays an approved order. Only ever called after the Spend Guard has said yes. */
  pay: (order: PaymentOrder) => Promise<PaymentReceipt>;
}

const defaultDeps = (): PurchaseDeps => {
  const router = getPaymentRouter();
  return { pay: (order) => router.pay(order) };
};

/** What the client sends back so Melit can learn: its strategy and the sellers' signed reviews. */
export interface LearningInput {
  profile?: StrategyProfile;
  /** Raw reviews from the client; only server-signed ones are used. */
  reviews?: unknown;
}

export interface RunHooks {
  /** Re-checks Spend Guard under server lock immediately before calling a payment rail. */
  onBeforePay?: (order: PaymentOrder) => Promise<void>;
  /** Persists a signed ledger row after payment; runs before the purchased event is streamed. */
  onLedgerAppend?: (entry: LedgerEntry, order: PaymentOrder) => Promise<void>;
  /** Drops a reserved in-flight row when payment fails. */
  onPaymentFailed?: (order: PaymentOrder) => Promise<void>;
}

export async function* runShopping(
  request: ShoppingRequest,
  rawLedger: unknown,
  reasoner: ReasoningAdapter,
  deps: PurchaseDeps = defaultDeps(),
  learning: LearningInput = {},
  rawList: unknown = undefined,
  hooks: RunHooks = {},
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
  const listCheck = verifyShoppingList(rawList);
  if (!listCheck.ok) {
    if (listCheck.reason === NO_LIST_REASON) {
      const attempted = Math.min(catalogItem.listPriceCents, request.maxPriceCents);
      yield {
        type: "declined-offer",
        offer: declineOffer({
          id: `request:${catalogItem.id}`,
          kind: "request",
          itemName: item.name,
          sellerName: item.sellerName,
          priceCents: catalogItem.listPriceCents,
          pitch: listCheck.reason,
          at: Date.now(),
        }),
      };
      yield { type: "blocked", guard: authorizePurchase(rawLedger, rawList, item.name, attempted, Date.now()), item, priceCents: attempted };
      return;
    }
    yield { type: "error", message: listCheck.reason };
    return;
  }
  const list = listCheck.items;
  const bought = unitsBought(ledgerCheck.entries, item.name);
  const row = findListItem(list, item.name);
  const pushes = sellerPushes(catalogItem);
  const remaining = checkSpend({ ledger: ledgerCheck.entries, attemptedCents: 1, now: Date.now() }).remainingCents;
  const profile = parseProfile(learning.profile ?? DEFAULT_PROFILE);
  const reputation = reputationFor(verifiedReviews(learning.reviews), catalogItem.sellerId);
  const mood = { willingness: reputation.willingness, floorPremium: reputation.floorPremium };
  yield { type: "start", item, request, remainingCents: remaining };

  const now = Date.now();
  for (const push of pushes) {
    if (findListItem(list, push.itemName)) continue;
    yield {
      type: "declined-offer",
      offer: declineOffer({
        id: push.id,
        kind: push.kind,
        itemName: push.itemName,
        sellerName: push.sellerName,
        priceCents: push.priceCents,
        pitch: push.pitch,
        at: now,
      }),
    };
  }

  if (!row || bought >= row.quantity) {
    const attempted = Math.max(1, row ? Math.min(row.maxPrice, catalogItem.listPriceCents) : catalogItem.listPriceCents);
    if (!row) {
      yield {
        type: "declined-offer",
        offer: declineOffer({
          id: `request:${catalogItem.id}`,
          kind: "request",
          itemName: item.name,
          sellerName: item.sellerName,
          priceCents: catalogItem.listPriceCents,
          pitch: "You asked Melit to buy this, and it is not on your list.",
          at: now,
        }),
      };
    }
    yield { type: "blocked", guard: authorizePurchase(rawLedger, rawList, item.name, attempted, now), item, priceCents: attempted };
    return;
  }

  const quantityRemaining = row.quantity - bought;
  const shoppingList = list.map((entry) => ({
    name: entry.name,
    maxPriceUsd: centsToDollars(entry.maxPrice),
    quantity: entry.quantity,
    quantityRemaining: Math.max(0, entry.quantity - unitsBought(ledgerCheck.entries, entry.name)),
  }));
  const sellerPushContext = pushes.map((push) => ({
    itemName: push.itemName,
    kind: push.kind,
    priceUsd: centsToDollars(push.priceCents),
    onList: Boolean(findListItem(list, push.itemName)),
    pitch: push.pitch,
  }));

  let ask = catalogItem.listPriceCents;
  const history: HistoryTurn[] = [];
  const rounds: SummaryRound[] = [];
  let dealPrice: number | undefined;
  let outcome: DealOutcome | undefined;

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
        profile,
        reputation,
        listMaxPriceCents: row.maxPrice,
        quantityRemaining,
        shoppingList,
        sellerPushes: sellerPushContext,
      },
      reasoner,
    );
    const askBefore = ask;
    const summaryRound: SummaryRound = {
      round,
      askCents: askBefore,
      action: decision.action,
      offerCents: decision.offerPriceCents,
      source: decision.source,
      reasoning: decision.reasoning.slice(0, 5).map((r) => r.slice(0, 300)),
      sellerStatus: null,
      sellerPriceCents: null,
      sellerMessage: null,
    };
    rounds.push(summaryRound);

    if (decision.action === "walk") {
      yield { type: "round", round: { round, askBeforeCents: askBefore, decision } };
      yield { type: "no-deal", message: "Melit walked away: the deal wasn't good enough within your limits." };
      outcome = "melit-walked";
      break;
    }

    if (decision.action === "accept") {
      yield { type: "round", round: { round, askBeforeCents: askBefore, decision } };
      dealPrice = ask;
      yield { type: "deal", priceCents: ask, message: `Melit accepted the seller's ask of ${formatUsd(ask)}.` };
      break;
    }

    const reply = sellerRespond(catalogItem, decision.offerPriceCents, ask, round, mood);
    yield { type: "round", round: { round, askBeforeCents: askBefore, decision, seller: reply } };
    summaryRound.sellerStatus = reply.status;
    summaryRound.sellerPriceCents = reply.status === "walk" ? null : reply.priceCents;
    summaryRound.sellerMessage = reply.message;
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
      outcome = "seller-walked";
      break;
    }
    ask = reply.priceCents;
  }

  let paidCents: number | null = null;
  if (!outcome) {
    if (dealPrice === undefined) {
      yield { type: "no-deal", message: "No deal within the round limit. Nothing was bought." };
      outcome = "no-deal";
    } else if (dealPrice > request.maxPriceCents) {
      yield { type: "no-deal", message: `Deal price ${formatUsd(dealPrice)} is above your max of ${formatUsd(request.maxPriceCents)}. Not buying.` };
      outcome = "no-deal";
    } else {
      for await (const event of purchase(catalogItem, item, dealPrice, rawLedger, deps, rawList, hooks)) {
        if (event.type === "purchased") {
          outcome = "purchased";
          paidCents = event.entry.paidCents;
        } else if (event.type === "blocked") outcome = "blocked";
        else if (event.type === "payment-failed") outcome = "payment-failed";
        yield event;
      }
      outcome ??= "payment-failed";
    }
  }

  const review = reviewDeal({
    item: catalogItem,
    offersCents: rounds.filter((r) => r.action === "offer").map((r) => r.offerCents),
    outcome,
    paidCents,
  });
  yield { type: "seller-review", review, reputation };

  const summary: Omit<DealSummary, "sig"> = {
    dealId: `deal_${randomUUID()}`,
    at: Date.now(),
    itemId: item.id,
    itemName: item.name,
    sellerId: item.sellerId,
    sellerName: item.sellerName,
    sellerStyle: item.personality,
    listPriceCents: item.listPriceCents,
    marketReferenceCents: item.marketReferenceCents,
    maxPriceCents: request.maxPriceCents,
    requestPriority: request.priority,
    remainingBudgetCents: remaining,
    rounds,
    outcome,
    paidCents,
    savedCents: paidCents === null ? null : item.listPriceCents - paidCents,
    profile: {
      aggressiveness: profile.aggressiveness,
      walkAwayThreshold: profile.walkAwayThreshold,
      priority: profile.priority,
      notes: profile.notes,
      version: profile.version,
    },
    reputation,
  };
  yield { type: "summary", summary: signDealSummary(summary) };
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
  rawList: unknown = undefined,
  hooks: RunHooks = {},
): AsyncGenerator<FeedEvent> {
  const guard = authorizePurchase(rawLedger, rawList, item.name, priceCents, Date.now());
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

  try {
    if (hooks.onBeforePay) await hooks.onBeforePay(order);
  } catch (err) {
    yield {
      type: "blocked",
      guard: {
        allowed: false,
        reason: (err as Error).message.startsWith("Blocked:") ? (err as Error).message : `Blocked: ${(err as Error).message}`,
        spentInWindowCents: 0,
        remainingCents: 0,
        attemptedCents: priceCents,
        capCents: guard.capCents,
      },
      item,
      priceCents,
    };
    return;
  }

  let receipt: PaymentReceipt;
  try {
    receipt = await deps.pay(order);
  } catch (err) {
    await hooks.onPaymentFailed?.(order);
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
    testnetAmount: receipt.testnetAmount ? `${receipt.testnetAmount} ${receipt.asset ?? ""}`.trim() : null,
  });
  try {
    if (hooks.onLedgerAppend) await hooks.onLedgerAppend(entry, order);
  } catch (err) {
    await hooks.onPaymentFailed?.(order);
    yield {
      type: "error",
      message: `Payment succeeded but the ledger could not be updated: ${(err as Error).message}. Contact support with receipt ${receipt.receiptId}.`,
    };
    return;
  }
  yield { type: "purchased", entry, receipt, guard };
}

/** Demo: Melit tries to buy something that doesn't fit the remaining weekly budget. */
export async function* runOverspend(
  rawLedger: unknown,
  deps: PurchaseDeps = defaultDeps(),
  rawList: unknown = undefined,
  hooks: RunHooks = {},
): AsyncGenerator<FeedEvent> {
  const check = verifyLedger(rawLedger);
  if (!check.ok) {
    yield { type: "error", message: check.reason };
    return;
  }
  const listCheck = verifyShoppingList(rawList);
  const entries = check.entries;
  const list = listCheck.ok ? listCheck.items : [];
  const remaining = checkSpend({ ledger: entries, attemptedCents: 1, now: Date.now() }).remainingCents;
  // Prefer an on-list item that only fails the weekly cap, so this demo still shows the
  // spending limit when the list allows the item. Otherwise the cheapest item that doesn't
  // fit, and the espresso machine (> $300) as a last resort. The guard still decides.
  const candidates = [...CATALOG].sort((a, b) => a.listPriceCents - b.listPriceCents);
  const onListOverCap = candidates.find((candidate) => {
    const allowed = findListItem(list, candidate.name);
    if (!allowed || candidate.listPriceCents > allowed.maxPrice) return false;
    if (unitsBought(entries, candidate.name) >= allowed.quantity) return false;
    return candidate.listPriceCents > remaining;
  });
  const target = onListOverCap ?? candidates.find((candidate) => candidate.listPriceCents > remaining) ?? getCatalogItem("espresso")!;
  const item = toPublicItem(target);
  yield {
    type: "start",
    item,
    request: { query: item.name, maxPriceCents: target.listPriceCents, priority: "fast" },
    remainingCents: remaining,
  };
  yield* purchase(target, item, target.listPriceCents, rawLedger, deps, rawList, hooks);
}
