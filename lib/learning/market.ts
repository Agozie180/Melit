// Market feedback rule: what Melit takes away from a seller's review. Deterministic, applied
// with the smallest step limit ("market") so sellers nudge the strategy rather than steer it.

import { NO_CHANGE, type ProfileUpdate } from "./profile";
import type { SellerReputation, SellerReview } from "./types";

export const MARKET_NOTE = "Sellers punish insulting lowballs: open closer to market";

export function marketLesson(review: SellerReview, reputation: SellerReputation): { update: ProfileUpdate; learned: string } | null {
  if (review.pressure === "insulting" || review.rating <= 2) {
    const low = reputation.avgRating !== null && reputation.avgRating < 3;
    return {
      update: { ...NO_CHANGE, aggressivenessDelta: -0.05, addNote: low ? MARKET_NOTE : null },
      learned: `${review.sellerName} rated me ${review.rating}/5 for pushing too hard, so I'll ease off a little.`,
    };
  }
  if (review.pressure === "generous" && review.outcome === "purchased") {
    return {
      update: { ...NO_CHANGE, aggressivenessDelta: 0.03 },
      learned: `${review.sellerName} took my offer without any pressure, so there's room to push a bit harder.`,
    };
  }
  return null;
}
