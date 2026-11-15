// Learning dashboard numbers, computed only from negotiations this browser actually ran.

import type { DealRecord } from "./types";

export interface MetricSet {
  negotiations: number;
  closed: number;
  /** Purchases / negotiations, 0..100, or null with no negotiations. */
  closedPct: number | null;
  /** Mean of (list - paid) / list over purchases, 0..100. */
  avgSavedPct: number | null;
  /** Mean of paid / market reference over purchases, 0..100+. */
  avgPaidVsMarketPct: number | null;
  rated: number;
  /** Thumbs up / rated deals, 0..100. */
  approvalPct: number | null;
}

/** Outcomes where negotiation quality decided the result (guard blocks and payment errors don't count). */
const COUNTED = new Set<DealRecord["outcome"]>(["purchased", "melit-walked", "seller-walked", "no-deal"]);

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

export function metricsFor(records: DealRecord[]): MetricSet {
  const counted = records.filter((r) => COUNTED.has(r.outcome));
  const bought = counted.filter((r) => r.outcome === "purchased" && r.paidCents !== null);
  const rated = records.filter((r) => r.feedback);
  return {
    negotiations: counted.length,
    closed: bought.length,
    closedPct: pct(bought.length, counted.length),
    avgSavedPct: mean(bought.map((r) => ((r.listPriceCents - (r.paidCents as number)) / r.listPriceCents) * 100)),
    avgPaidVsMarketPct: mean(bought.map((r) => ((r.paidCents as number) / r.marketReferenceCents) * 100)),
    rated: rated.length,
    approvalPct: pct(rated.filter((r) => r.feedback?.rating === "up").length, rated.length),
  };
}

export interface LearningMetrics {
  all: MetricSet;
  /** Deals run with the untouched default strategy (profile version 0). */
  before: MetricSet;
  /** Deals run after at least one feedback-driven update. */
  after: MetricSet;
}

export function learningMetrics(records: DealRecord[]): LearningMetrics {
  return {
    all: metricsFor(records),
    before: metricsFor(records.filter((r) => r.profileVersion === 0)),
    after: metricsFor(records.filter((r) => r.profileVersion > 0)),
  };
}
