// All money values are integer cents to avoid floating-point drift.

import type { PaymentRailId, PaymentReceipt, RailAttempt } from "./payments/types";
export type { PaymentRailId, PaymentReceipt, RailAttempt };
import type { DealSummary, SellerReputation, SellerReview } from "./learning/types";

export type Priority = "save" | "fast";

export type SellerPersonality = "firm" | "flexible" | "bluffer" | "bundler";

/** Item as it may be shown to the client or the reasoning model. Never contains the floor. */
export interface PublicItem {
  id: string;
  name: string;
  sellerId: string;
  sellerName: string;
  personality: SellerPersonality;
  listPriceCents: number;
  marketReferenceCents: number;
  tags: string[];
}

export interface ShoppingRequest {
  query: string;
  maxPriceCents: number;
  priority: Priority;
}

export interface LedgerEntry {
  id: string;
  itemId: string;
  itemName: string;
  sellerName: string;
  listPriceCents: number;
  paidCents: number;
  savedCents: number;
  timestamp: number;
  receiptId: string;
  /** Which rail actually paid. */
  rail: PaymentRailId;
  txHash: string | null;
  explorerUrl: string | null;
  /** pieUSD that moved on KiteAI testnet, or null when nothing moved. */
  testnetAmount: string | null;
  /** HMAC issued by the server when the purchase was approved. */
  sig: string;
}

export interface NegotiationDecision {
  action: "offer" | "accept" | "walk";
  offerPriceCents: number;
  reasoning: string[];
  confidence: number;
  source: "serv" | "fallback";
  fallbackReason?: string;
  model?: string;
  guardrails: string[];
}

export type SellerReply =
  | { status: "accept"; priceCents: number; message: string }
  | { status: "counter"; priceCents: number; message: string }
  | { status: "walk"; message: string };

export interface NegotiationRound {
  round: number;
  askBeforeCents: number;
  decision: NegotiationDecision;
  seller?: SellerReply;
}

export interface GuardResult {
  allowed: boolean;
  reason: string;
  spentInWindowCents: number;
  remainingCents: number;
  attemptedCents: number;
  capCents: number;
}

/** A seller push, or the owner's own request, that Melit refused because it was off the list. */
export interface DeclinedOffer {
  id: string;
  kind: "bundle" | "flash" | "request";
  itemName: string;
  sellerName: string;
  priceCents: number;
  pitch: string;
  /** Starts with "declined: not on your list" and includes the reason. */
  log: string;
  reasoning: string[];
  /** What "Add to list?" would approve. Nothing is added until the owner confirms. */
  suggested: { name: string; maxPrice: number; quantity: number };
  at: number;
}

export type FeedEvent =
  | { type: "start"; item: PublicItem; request: ShoppingRequest; remainingCents: number }
  | { type: "round"; round: NegotiationRound }
  | { type: "deal"; priceCents: number; message: string }
  | { type: "no-deal"; message: string }
  | { type: "blocked"; guard: GuardResult; item: PublicItem; priceCents: number }
  | { type: "declined-offer"; offer: DeclinedOffer }
  | { type: "purchased"; entry: LedgerEntry; receipt: PaymentReceipt; guard: GuardResult }
  | { type: "payment-failed"; message: string; attempts: RailAttempt[]; item: PublicItem; priceCents: number }
  | { type: "seller-review"; review: SellerReview; reputation: SellerReputation }
  | { type: "summary"; summary: DealSummary }
  | { type: "error"; message: string }
  | { type: "done" };
