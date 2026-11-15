// Deterministic seller rules. No LLM is involved on the seller side.
//
// - Offer >= hidden floor (or >= current ask): accept at the offer.
// - Otherwise counter, conceding a shrinking slice of the gap between the current ask and the floor.
// - After MAX_ROUNDS rejected offers the seller walks away.

import type { SellerPersonality, SellerReply } from "../types";
import { formatUsd } from "../money";
import type { CatalogItem } from "./catalog";
import { getSeller } from "./catalog";

export const MAX_ROUNDS = 4;

interface Style {
  /** Share of the (ask - floor) gap conceded in round 1. */
  firstConcession: number;
  /** Each later round concedes this fraction of the previous round's concession share. */
  shrink: number;
}

const STYLES: Record<SellerPersonality, Style> = {
  firm: { firstConcession: 0.2, shrink: 0.5 },
  flexible: { firstConcession: 0.45, shrink: 0.75 },
  bluffer: { firstConcession: 0.3, shrink: 0.6 },
  bundler: { firstConcession: 0.3, shrink: 0.7 },
};

function counterMessage(p: SellerPersonality, round: number, ask: number): string {
  const price = formatUsd(ask);
  switch (p) {
    case "firm":
      return round === 1
        ? `That's too low. I can do ${price}, and I don't haggle much.`
        : `I've moved enough. ${price}.`;
    case "flexible":
      return round === 1
        ? `Ooh, tough crowd! How about ${price}?`
        : `You drive a hard bargain. Meet me at ${price}?`;
    case "bluffer":
      return round === 1
        ? `No way. ${price}. This is my LAST price.`
        : `Fine, fine, ${price}. Absolutely final this time, I swear.`;
    case "bundler":
      return round === 1
        ? `I'd rather sell you two! But for one: ${price}.`
        : `${price}. Add a second item next time and I'll go lower.`;
  }
}

function acceptMessage(p: SellerPersonality, price: number): string {
  const v = formatUsd(price);
  switch (p) {
    case "firm":
      return `Fair enough. ${v}, deal.`;
    case "flexible":
      return `Deal at ${v}! Pleasure doing business.`;
    case "bluffer":
      return `...okay, ${v}. Don't tell anyone.`;
    case "bundler":
      return `Sold at ${v}. Come back for the matching set!`;
  }
}

function walkMessage(p: SellerPersonality): string {
  switch (p) {
    case "firm":
      return "We're too far apart. Good day.";
    case "flexible":
      return "I really can't go that low. Maybe next time!";
    case "bluffer":
      return "That's it, I'm out. (Really, this time.)";
    case "bundler":
      return "Can't do it for a single item. Bye for now.";
  }
}

/** How Melit's reputation with this seller changes their behaviour. Defaults to neutral. */
export interface SellerMood {
  /** Multiplier on concessions (1 = normal, lower = concedes less per round). */
  willingness: number;
  /** Fraction added on top of the hidden floor (0 = none). */
  floorPremium: number;
}

export const NEUTRAL_MOOD: SellerMood = { willingness: 1, floorPremium: 0 };

/** The floor the seller holds out for right now, given their mood. Server-only (uses the hidden floor). */
export function effectiveFloor(item: CatalogItem, mood: SellerMood = NEUTRAL_MOOD): number {
  const premium = Math.min(0.1, Math.max(0, mood.floorPremium));
  if (premium === 0) return item.floorPriceCents;
  return Math.min(item.listPriceCents, Math.ceil((item.floorPriceCents * (1 + premium)) / 100) * 100);
}

/**
 * @param currentAskCents the seller's latest asking price (list price before round 1)
 * @param round 1-based round number of this offer
 * @param mood reputation-driven adjustments (see lib/learning/reputation.ts)
 */
export function sellerRespond(
  item: CatalogItem,
  offerCents: number,
  currentAskCents: number,
  round: number,
  mood: SellerMood = NEUTRAL_MOOD,
): SellerReply {
  const personality = getSeller(item.sellerId).personality;
  const floor = effectiveFloor(item, mood);
  const willingness = Math.min(1, Math.max(0.5, mood.willingness));

  if (offerCents >= floor || offerCents >= currentAskCents) {
    return { status: "accept", priceCents: offerCents, message: acceptMessage(personality, offerCents) };
  }
  if (round >= MAX_ROUNDS) {
    return { status: "walk", message: walkMessage(personality) };
  }

  const style = STYLES[personality];
  const share = style.firstConcession * Math.pow(style.shrink, round - 1) * willingness;
  const concession = Math.max(100, Math.round((currentAskCents - floor) * share));
  const nextAsk = Math.max(floor, currentAskCents - concession);
  // Whole-dollar asks read more like a real seller.
  const rounded = Math.max(floor, Math.ceil(nextAsk / 100) * 100);
  return { status: "counter", priceCents: rounded, message: counterMessage(personality, round, rounded) };
}
