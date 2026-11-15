// Shared (client + server) types for the feedback loop.

import type { LearningSource, ProfileUpdate, StrategyProfile } from "./profile";

export type Pressure = "generous" | "firm" | "aggressive" | "insulting";

/** A mock seller's rating of Melit after a negotiation. Deterministic rules, signed by the server. */
export interface SellerReview {
  id: string;
  sellerId: string;
  sellerName: string;
  itemName: string;
  /** 1 (worst) to 5 (best). */
  rating: number;
  pressure: Pressure;
  text: string;
  outcome: DealOutcome;
  at: number;
  sig: string;
}

export interface SellerReputation {
  sellerId: string | null;
  reviews: number;
  avgRating: number | null;
  /** Multiplier on how much the seller concedes per round (1 = normal). */
  willingness: number;
  /** Extra the seller now holds out for above their usual floor, as a fraction (0 = none). */
  floorPremium: number;
}

export type DealOutcome = "purchased" | "melit-walked" | "seller-walked" | "no-deal" | "blocked" | "payment-failed";

export interface SummaryRound {
  round: number;
  askCents: number;
  action: "offer" | "accept" | "walk";
  offerCents: number;
  source: "serv" | "fallback";
  reasoning: string[];
  sellerStatus: "accept" | "counter" | "walk" | null;
  sellerPriceCents: number | null;
  sellerMessage: string | null;
}

/**
 * Everything needed to judge one negotiation, with no keys, wallet addresses, tx hashes or
 * personal data. Signed by the server so feedback and Reppo submissions only accept real runs.
 */
export interface DealSummary {
  dealId: string;
  at: number;
  itemId: string;
  itemName: string;
  sellerId: string;
  sellerName: string;
  sellerStyle: string;
  listPriceCents: number;
  marketReferenceCents: number;
  maxPriceCents: number;
  requestPriority: "save" | "fast";
  remainingBudgetCents: number;
  rounds: SummaryRound[];
  outcome: DealOutcome;
  paidCents: number | null;
  savedCents: number | null;
  profile: Pick<StrategyProfile, "aggressiveness" | "walkAwayThreshold" | "priority" | "notes" | "version">;
  reputation: SellerReputation;
  sig: string;
}

export type ReppoJobState = "queued" | "pending" | "verdict" | "failed";

export interface ReppoVerdict {
  score: number | null;
  route: string | null;
  decision: string | null;
  confidence: string | null;
  reason: string | null;
  rubric: Record<string, number>;
  evaluators: { model: string; overall: number | null; reasoning: string | null }[];
  completedAt: string | null;
}

export interface ReppoJob {
  dealId: string;
  state: ReppoJobState;
  evalId: string | null;
  queuedAt: number;
  submittedAt: number | null;
  /** Reppo's own status string (QUEUED, PROCESSING, COMPLETED, FAILED) when known. */
  remoteStatus: string | null;
  verdict: ReppoVerdict | null;
  error: string | null;
  /** Earliest time the queue may contact Reppo again for this job (backoff after errors). */
  retryAt: number;
  /** Consecutive transient errors; the job fails after REPPO_MAX_ATTEMPTS. */
  attempts: number;
  learned: boolean;
}

export interface LearningEvent {
  id: string;
  at: number;
  source: LearningSource;
  dealId: string | null;
  /** The "what Melit learned" line. */
  learned: string;
  changes: string[];
  capped: boolean;
  /** "serv" when SERV Reasoning produced the update, "rule" for deterministic rules, "fallback" when SERV failed. */
  method: "serv" | "rule" | "fallback";
  fallbackReason?: string;
  profileVersion: number;
}

export interface OwnerFeedback {
  rating: "up" | "down";
  note: string;
  at: number;
}

/** One negotiation as stored on the client for metrics. */
export interface DealRecord {
  dealId: string;
  at: number;
  itemName: string;
  sellerName: string;
  outcome: DealOutcome;
  listPriceCents: number;
  marketReferenceCents: number;
  paidCents: number | null;
  rounds: number;
  /** Profile version in force when the deal ran: 0 = before any feedback. */
  profileVersion: number;
  summary: DealSummary | null;
  review: SellerReview | null;
  feedback: OwnerFeedback | null;
}

export type FeedbackRequest =
  | { kind: "owner"; summary: DealSummary; profile: StrategyProfile; rating: "up" | "down"; note: string }
  | { kind: "reppo"; summary: DealSummary; profile: StrategyProfile; evalId: string };

export interface FeedbackResponse {
  profile: StrategyProfile;
  event: LearningEvent;
  update: ProfileUpdate;
  verdict?: ReppoVerdict;
}
