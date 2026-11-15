// Aggregate seller reputation from reviews. Pure, shared by client (display) and server
// (which only feeds it signature-verified reviews before it changes seller behaviour).

import type { SellerReputation, SellerReview } from "./types";

export const REPUTATION_WINDOW = 8;

/** avg 5 -> 1.0, 4 -> 0.9, 3 -> 0.8, 2 -> 0.7, 1 -> 0.6 */
export function willingnessFor(avgRating: number | null): number {
  if (avgRating === null) return 1;
  return Math.round(Math.min(1, Math.max(0.6, 0.6 + 0.1 * (avgRating - 1))) * 100) / 100;
}

export function floorPremiumFor(avgRating: number | null): number {
  if (avgRating === null) return 0;
  if (avgRating <= 2) return 0.05;
  if (avgRating <= 2.5) return 0.03;
  return 0;
}

/**
 * Reputation with one seller. Sellers talk to each other: with no reviews from this seller yet,
 * the market-wide average applies.
 */
export function reputationFor(reviews: SellerReview[], sellerId: string | null): SellerReputation {
  const sorted = [...reviews].sort((a, b) => a.at - b.at);
  const own = sellerId ? sorted.filter((r) => r.sellerId === sellerId) : [];
  const pool = (own.length ? own : sorted).slice(-REPUTATION_WINDOW);
  const avgRating = pool.length ? Math.round((pool.reduce((s, r) => s + r.rating, 0) / pool.length) * 100) / 100 : null;
  return {
    sellerId: own.length ? sellerId : null,
    reviews: pool.length,
    avgRating,
    willingness: willingnessFor(avgRating),
    floorPremium: floorPremiumFor(avgRating),
  };
}
