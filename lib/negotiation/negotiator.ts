// Melit's side of the table. Every decision is asked of SERV Reasoning first; if that call
// fails or returns something that doesn't validate, a simple heuristic takes over and the
// round is flagged "fallback". Hard limits (shopping list, user max price, remaining weekly
// budget) are then applied in code, so the model can recommend but can never exceed them.

import { z } from "zod";
import type { NegotiationDecision, Priority, PublicItem } from "../types";
import { centsToDollars, dollarsToCents } from "../money";
import { normalizeItemName } from "../shopping/list";
import type { ReasoningAdapter } from "../adapters/reasoning";
import { DEFAULT_PROFILE, type StrategyProfile } from "../learning/profile";
import type { SellerReputation } from "../learning/types";

export interface HistoryTurn {
  round: number;
  melitAction: "offer" | "accept" | "walk";
  melitOfferCents: number;
  sellerStatus?: "accept" | "counter" | "walk";
  sellerPriceCents?: number;
  sellerMessage?: string;
}

export interface NegotiationContext {
  item: PublicItem;
  round: number;
  maxRounds: number;
  currentAskCents: number;
  history: HistoryTurn[];
  remainingBudgetCents: number;
  userMaxPriceCents: number;
  priority: Priority;
  /** Learned strategy (defaults to the untouched profile). */
  profile?: StrategyProfile;
  /** Melit's reputation with this seller, from the sellers' own reviews. */
  reputation?: SellerReputation;
  /** This item's shopping-list maximum, when the owner approved the item. */
  listMaxPriceCents?: number;
  /** How many of this item the list still allows. Omitted when no list was supplied to this call. */
  quantityRemaining?: number;
  /** Approved rows, so the model can see the allowlist. Code enforces it either way. */
  shoppingList?: { name: string; maxPriceUsd: number; quantity: number; quantityRemaining: number }[];
  /** Extra seller offers. Off-list ones are declined in code and are not purchased here. */
  sellerPushes?: { itemName: string; kind: "bundle" | "flash"; priceUsd: number; onList: boolean; pitch: string }[];
}

/** Lower of the user's max price and remaining weekly budget. Never negotiable. */
export function hardCeiling(ctx: NegotiationContext): number {
  return Math.min(ctx.userMaxPriceCents, ctx.remainingBudgetCents);
}

/** Highest final price the learned strategy will pay: walkAwayThreshold x market reference. */
export function walkAwayCents(ctx: NegotiationContext): number {
  const profile = ctx.profile ?? DEFAULT_PROFILE;
  return Math.floor((ctx.item.marketReferenceCents * profile.walkAwayThreshold) / 100) * 100;
}

export const DecisionSchema = z.object({
  action: z.enum(["offer", "accept", "walk"]),
  offerPrice: z.number().finite().nonnegative(),
  reasoning: z.array(z.string().min(1).max(400)).min(1).max(8),
  confidence: z.number().min(0).max(1),
});

const DECISION_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["offer", "accept", "walk"], description: "offer = propose offerPrice; accept = take the seller's current ask; walk = end without buying" },
    offerPrice: { type: "number", description: "USD. The price Melit proposes (for accept, the current ask; for walk, 0)." },
    reasoning: { type: "array", items: { type: "string" }, description: "2-5 short, user-readable reasoning steps." },
    confidence: { type: "number", description: "0 to 1" },
  },
  required: ["action", "offerPrice", "reasoning", "confidence"],
  additionalProperties: false,
} as const;

export const SYSTEM_PROMPT = `You are Melit, a careful shopping agent negotiating on behalf of a user who is not good at haggling or saving.
Prompt version: melit-negotiator-v3.

Objective: get the item for the lowest reasonable price without losing a good deal, then let the savings go to the user's vault.

Decision priorities:
1. Never recommend paying more than hardCeilingUsd (the lower of the user's max price, their remaining weekly budget, and the shopping-list maximum for this item). Code enforces this anyway.
2. Never accept above walkAwayPriceUsd (the owner's learned walk-away limit). Code enforces this too.
3. If priority is "save": open well below the market reference, raise offers in small steps, and be willing to walk if the seller will not come near the market reference.
4. If priority is "fast": open close to the market reference and accept quickly once the ask is at or below the market reference.
5. Offers must never go down between rounds and must be below the current ask (otherwise choose "accept").
6. Treat "this is my last price" claims with skepticism if the seller has kept conceding.
7. On the final round, accept if the current ask is within both limits and fair versus the market reference; otherwise make your best final offer or walk.
8. Buy only items on shoppingList. Each row has maxPriceUsd and quantityRemaining. If this item is missing, or quantityRemaining is 0, walk. Never pay more than that row's maxPriceUsd. If shoppingList is null, you were not given an approved list: walk.
9. sellerPushes are bundles and flash deals the seller added. Refuse any push whose onList is false. Code logs "declined: not on your list" and will not pay for it, whatever you recommend.

Learned strategy (strategyProfile in the user message, learned from owner feedback, seller reviews and external evaluation):
- aggressiveness 0..1 sets how far below the market reference to open and how slowly to raise: about 0.2 means open near 90% of market, 0.5 near 75%, 0.8 near 65%. suggestedOpeningOfferUsd is computed from it.
- profilePriority is the owner's standing preference ("save" = maximise savings, "speed" = close in fewer rounds). The per-request userPriority wins if they disagree.
- notes are the owner's own lessons. Follow them unless they conflict with the hard limits.
- sellerReputation is how this market rates Melit. A low average rating means sellers concede less and hold out for more; avoid insulting lowball offers when the rating is low, because that makes later deals worse.
Mention in your reasoning which learned setting or note influenced the move when one did.

Output rules: respond only with the JSON object required by the schema. offerPrice is in US dollars with at most 2 decimals. For "accept" set offerPrice to the current ask; for "walk" set it to 0. reasoning is 2-5 short plain-English steps the user will read. confidence is 0 to 1.
Do not do arithmetic you do not need: the user message already includes the computed gaps and ceilings.`;

/** Opening share of the market reference implied by aggressiveness and priority. */
export function openingShare(aggressiveness: number, priority: Priority): number {
  return priority === "save" ? 0.86 - 0.24 * aggressiveness : 0.95 - 0.12 * aggressiveness;
}

export function buildUserMessage(ctx: NegotiationContext): string {
  const listCap = ctx.listMaxPriceCents ?? Number.POSITIVE_INFINITY;
  const ceiling = Math.min(hardCeiling(ctx), listCap);
  const profile = ctx.profile ?? DEFAULT_PROFILE;
  const walkAway = walkAwayCents(ctx);
  const lastOffer = [...ctx.history].reverse().find((h) => h.melitAction === "offer");
  const payload = {
    item: ctx.item.name,
    seller: ctx.item.sellerName,
    sellerStyle: ctx.item.personality,
    listPriceUsd: centsToDollars(ctx.item.listPriceCents),
    marketReferencePriceUsd: centsToDollars(ctx.item.marketReferenceCents),
    currentAskUsd: centsToDollars(ctx.currentAskCents),
    askMinusMarketUsd: centsToDollars(ctx.currentAskCents - ctx.item.marketReferenceCents),
    askVsMarketPercent: Math.round((ctx.currentAskCents / ctx.item.marketReferenceCents) * 1000) / 10,
    lastMelitOfferUsd: lastOffer ? centsToDollars(lastOffer.melitOfferCents) : null,
    round: ctx.round,
    maxRounds: ctx.maxRounds,
    isFinalRound: ctx.round >= ctx.maxRounds,
    userPriority: ctx.priority,
    userMaxPriceUsd: centsToDollars(ctx.userMaxPriceCents),
    remainingWeeklyBudgetUsd: centsToDollars(ctx.remainingBudgetCents),
    hardCeilingUsd: centsToDollars(ceiling),
    currentAskWithinCeiling: ctx.currentAskCents <= ceiling,
    shoppingListMaxUsd: ctx.listMaxPriceCents != null ? centsToDollars(ctx.listMaxPriceCents) : null,
    quantityRemaining: ctx.quantityRemaining ?? null,
    shoppingList: ctx.shoppingList ?? null,
    sellerPushes: ctx.sellerPushes ?? [],
    walkAwayPriceUsd: centsToDollars(walkAway),
    currentAskWithinWalkAway: ctx.currentAskCents <= walkAway,
    strategyProfile: {
      aggressiveness: profile.aggressiveness,
      walkAwayThresholdOfMarket: profile.walkAwayThreshold,
      profilePriority: profile.priority,
      notes: profile.notes,
      updatesApplied: profile.version,
    },
    suggestedOpeningOfferUsd: centsToDollars(Math.round(ctx.item.marketReferenceCents * openingShare(profile.aggressiveness, ctx.priority))),
    sellerReputation: ctx.reputation
      ? {
          averageRating: ctx.reputation.avgRating,
          reviews: ctx.reputation.reviews,
          basedOn: ctx.reputation.sellerId ? "this seller's reviews" : ctx.reputation.reviews ? "market-wide reviews" : "no reviews yet",
          sellerWillingness: ctx.reputation.willingness,
        }
      : null,
    history: ctx.history.map((h) => ({
      round: h.round,
      melit: h.melitAction === "offer" ? `offered $${centsToDollars(h.melitOfferCents)}` : h.melitAction,
      seller: h.sellerStatus
        ? `${h.sellerStatus}${h.sellerPriceCents ? ` at $${centsToDollars(h.sellerPriceCents)}` : ""}: "${h.sellerMessage ?? ""}"`
        : null,
    })),
  };
  return `Decide Melit's next move.\n${JSON.stringify(payload, null, 2)}`;
}

/** Deterministic fallback used when SERV is unavailable or returns invalid output. */
export function heuristicDecision(ctx: NegotiationContext): Omit<NegotiationDecision, "source" | "guardrails" | "fallbackReason"> {
  const profile = ctx.profile ?? DEFAULT_PROFILE;
  const listCap = ctx.listMaxPriceCents ?? Number.POSITIVE_INFINITY;
  const ceiling = Math.min(hardCeiling(ctx), walkAwayCents(ctx), listCap);
  const market = ctx.item.marketReferenceCents;
  const step = ctx.round - 1;
  const stepShare = ctx.priority === "save" ? 0.09 - 0.05 * profile.aggressiveness : 0.05;
  const targetShare = openingShare(profile.aggressiveness, ctx.priority) + stepShare * step;
  const acceptBelow = ctx.priority === "save" ? market * 0.95 : market * 1.02;
  const target = Math.min(ceiling, Math.round(market * targetShare));
  const final = ctx.round >= ctx.maxRounds;

  if (ctx.currentAskCents <= ceiling && (ctx.currentAskCents <= acceptBelow || ctx.currentAskCents <= target || (final && ctx.currentAskCents <= market * 1.05))) {
    return {
      action: "accept",
      offerPriceCents: ctx.currentAskCents,
      reasoning: ["Heuristic: the current ask is at or below my acceptable price for this priority.", "Accepting now to lock in the deal."],
      confidence: 0.6,
    };
  }
  if (target <= 0) {
    return { action: "walk", offerPriceCents: 0, reasoning: ["Heuristic: no budget left within the user's limits."], confidence: 0.9 };
  }
  return {
    action: "offer",
    offerPriceCents: target,
    reasoning: [
      `Heuristic: offer ${Math.round(targetShare * 100)}% of the market reference price (aggressiveness ${profile.aggressiveness.toFixed(2)}).`,
      final ? "Final round: this is my best offer." : "Raise the offer a little each round.",
    ],
    confidence: 0.5,
  };
}

/** Hard limits applied to every decision, whichever brain produced it. */
export function applyGuardrails(
  ctx: NegotiationContext,
  d: Omit<NegotiationDecision, "guardrails">,
): NegotiationDecision {
  const guardrails: string[] = [];
  const hard = hardCeiling(ctx);
  const walkAway = walkAwayCents(ctx);
  let ceiling = Math.min(hard, walkAway);
  let limitName = walkAway < hard ? "learned walk-away limit" : "hard ceiling";
  if (ctx.listMaxPriceCents !== undefined && ctx.listMaxPriceCents < ceiling) {
    ceiling = ctx.listMaxPriceCents;
    limitName = "shopping-list maximum";
  }
  const lastOffer = [...ctx.history].reverse().find((h) => h.melitAction === "offer")?.melitOfferCents ?? 0;
  let { action, offerPriceCents } = d;

  const onList =
    ctx.shoppingList === undefined
      ? true
      : ctx.shoppingList.some((row) => normalizeItemName(row.name) === normalizeItemName(ctx.item.name));
  if (!onList && action !== "walk") {
    guardrails.push("This item is not on your shopping list: walking away.");
    return { ...d, action: "walk", offerPriceCents: 0, guardrails };
  }
  if (ctx.quantityRemaining !== undefined && ctx.quantityRemaining <= 0 && action !== "walk") {
    guardrails.push("No quantity left on your shopping list: walking away.");
    return { ...d, action: "walk", offerPriceCents: 0, guardrails };
  }

  if (hard <= 0 && action !== "walk") {
    guardrails.push("No room under the user's max price or weekly budget: walking away.");
    return { ...d, action: "walk", offerPriceCents: 0, guardrails };
  }

  if (action === "accept") {
    if (ctx.currentAskCents > ceiling) {
      if (ctx.round < ctx.maxRounds) {
        guardrails.push(`Ask is above the ${limitName}, so the accept became an offer at that limit.`);
        action = "offer";
        offerPriceCents = ceiling;
      } else {
        guardrails.push(`Ask is above the ${limitName} on the final round: walking away.`);
        return { ...d, action: "walk", offerPriceCents: 0, guardrails };
      }
    } else {
      offerPriceCents = ctx.currentAskCents;
    }
  }

  // The opening ask is the sticker price, which sits above the walk-away limit on every
  // catalog item. A walk there skips the haggle. Until the last round, make the offer the
  // strategy would have opened with instead, still capped by the same limit.
  if (action === "walk" && ctx.round < ctx.maxRounds && ceiling > lastOffer && ctx.currentAskCents > ceiling) {
    const opened = heuristicDecision(ctx);
    if (opened.action === "offer" && opened.offerPriceCents > lastOffer && opened.offerPriceCents < ctx.currentAskCents) {
      guardrails.push(`Ask is above the ${limitName}, so the walk became an offer under that limit.`);
      action = "offer";
      offerPriceCents = Math.min(opened.offerPriceCents, ceiling);
    }
  }

  if (action === "offer") {
    if (offerPriceCents > ceiling) {
      guardrails.push(`Offer was above the ${limitName} and was lowered to it.`);
      offerPriceCents = ceiling;
    }
    if (offerPriceCents < lastOffer) {
      guardrails.push("Offer can't go below the previous offer; raised back to it.");
      offerPriceCents = lastOffer;
    }
    if (offerPriceCents <= 0) {
      guardrails.push("Offer was not a positive amount; walking away.");
      return { ...d, action: "walk", offerPriceCents: 0, guardrails };
    }
    if (offerPriceCents >= ctx.currentAskCents) {
      guardrails.push("Offer met the current ask, so it was treated as accepting the ask.");
      action = "accept";
      offerPriceCents = ctx.currentAskCents;
    }
  }

  if (action === "walk") offerPriceCents = 0;
  return { ...d, action, offerPriceCents, guardrails };
}

export async function decide(ctx: NegotiationContext, reasoner: ReasoningAdapter): Promise<NegotiationDecision> {
  let fallbackReason: string;
  try {
    const result = await reasoner.completeJson({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(ctx),
      schemaName: "melit_negotiation_decision",
      schema: DECISION_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    const parsed = DecisionSchema.safeParse(result.json);
    if (parsed.success) {
      return applyGuardrails(ctx, {
        action: parsed.data.action,
        offerPriceCents: dollarsToCents(parsed.data.offerPrice),
        reasoning: parsed.data.reasoning,
        confidence: parsed.data.confidence,
        source: "serv",
        model: result.model,
      });
    }
    fallbackReason = `SERV output failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}`;
  } catch (err) {
    fallbackReason = (err as Error).message;
  }

  return applyGuardrails(ctx, { ...heuristicDecision(ctx), source: "fallback", fallbackReason });
}
