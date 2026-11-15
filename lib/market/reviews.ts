// SERVER-ONLY. Mock sellers review Melit after every negotiation. Deterministic rules, no LLM:
// the review depends on how hard Melit pushed relative to the seller's hidden floor, how long
// it haggled and how the negotiation ended. Reviews are signed so the client can't forge
// a better reputation; the floor itself never leaves the server.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SellerPersonality } from "../types";
import type { DealOutcome, Pressure, SellerReview } from "../learning/types";
import { signObject, verifyObject } from "../server/signing";
import type { CatalogItem } from "./catalog";
import { getSeller } from "./catalog";

const DOMAIN = "seller-review";

export function pressureFor(lowestOfferCents: number | null, floorCents: number): Pressure {
  if (lowestOfferCents === null) return "generous";
  const ratio = lowestOfferCents / floorCents;
  if (ratio < 0.75) return "insulting";
  if (ratio < 0.9) return "aggressive";
  if (ratio < 1) return "firm";
  return "generous";
}

export function ratingFor(args: { pressure: Pressure; offers: number; outcome: DealOutcome; paidCents: number | null; floorCents: number }): number {
  let rating = 5;
  if (args.pressure === "insulting") rating -= 2;
  else if (args.pressure === "aggressive") rating -= 1;
  if (args.offers >= 3) rating -= 1;
  if (args.outcome === "seller-walked") rating = Math.min(rating, 2);
  if (args.outcome === "melit-walked" || args.outcome === "no-deal") rating -= 1;
  if (args.outcome === "purchased" && args.paidCents !== null && args.paidCents >= args.floorCents * 1.15) rating += 1;
  return Math.max(1, Math.min(5, rating));
}

const LINES: Record<SellerPersonality, Record<Pressure, string>> = {
  firm: {
    generous: "Straightforward buyer. Respected my price.",
    firm: "Pushed, but stayed reasonable. I'd sell to Melit again.",
    aggressive: "Opened far too low. I don't appreciate that.",
    insulting: "Insulting opening offer. I nearly ended the conversation.",
  },
  flexible: {
    generous: "Lovely to deal with! Easy deal.",
    firm: "Haggled hard but fair. Fun negotiation!",
    aggressive: "Bit of a lowballer, but we got there.",
    insulting: "Those opening offers were way out of line.",
  },
  bluffer: {
    generous: "Didn't even test my 'last price'. Great customer.",
    firm: "Called my bluff politely. Fair enough.",
    aggressive: "Saw straight through me and squeezed hard.",
    insulting: "Lowballed me so hard I almost meant 'last price'.",
  },
  bundler: {
    generous: "Good buyer. Hope they come back for the set.",
    firm: "Tough on price, but fair.",
    aggressive: "Wanted a bundle discount on a single item.",
    insulting: "Treated my shop like a clearance bin.",
  },
};

function outcomeLine(outcome: DealOutcome): string {
  switch (outcome) {
    case "seller-walked":
      return " I walked away.";
    case "melit-walked":
      return " Then it walked away.";
    case "no-deal":
      return " We never closed.";
    default:
      return "";
  }
}

export function reviewDeal(args: {
  item: CatalogItem;
  offersCents: number[];
  outcome: DealOutcome;
  paidCents: number | null;
  now?: number;
}): SellerReview {
  const seller = getSeller(args.item.sellerId);
  const floor = args.item.floorPriceCents;
  const lowest = args.offersCents.length ? Math.min(...args.offersCents) : null;
  const pressure = pressureFor(lowest, floor);
  const rating = ratingFor({ pressure, offers: args.offersCents.length, outcome: args.outcome, paidCents: args.paidCents, floorCents: floor });
  const review: Omit<SellerReview, "sig"> = {
    id: `rev_${randomUUID()}`,
    sellerId: seller.id,
    sellerName: seller.name,
    itemName: args.item.name,
    rating,
    pressure,
    text: `${LINES[seller.personality][pressure]}${outcomeLine(args.outcome)}`,
    outcome: args.outcome,
    at: args.now ?? Date.now(),
  };
  return { ...review, sig: signObject(DOMAIN, review) };
}

const ReviewSchema = z.object({
  id: z.string().max(80),
  sellerId: z.string().max(40),
  sellerName: z.string().max(80),
  itemName: z.string().max(120),
  rating: z.number().int().min(1).max(5),
  pressure: z.enum(["generous", "firm", "aggressive", "insulting"]),
  text: z.string().max(300),
  outcome: z.enum(["purchased", "melit-walked", "seller-walked", "no-deal", "blocked", "payment-failed"]),
  at: z.number().finite(),
  sig: z.string().max(120),
});

/** Keeps only well-formed reviews with a valid server signature. */
export function verifiedReviews(raw: unknown): SellerReview[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(-200)
    .map((r) => ReviewSchema.safeParse(r))
    .filter((r) => r.success)
    .map((r) => r.data as SellerReview)
    .filter((r) => verifyObject(DOMAIN, r));
}
