// Browser-side state for the feedback loop. Everything lives in localStorage (there is no
// database); the server re-validates whatever it relies on (profile bounds, signed deal
// summaries, signed seller reviews, Reppo verdicts fetched from Reppo itself).

import { DEFAULT_PROFILE, applyBoundedUpdate, parseProfile, type StrategyProfile } from "../learning/profile";
import { marketLesson } from "../learning/market";
import { reputationFor } from "../learning/reputation";
import { enqueue } from "../learning/reppo-queue";
import type { DealRecord, DealSummary, FeedbackResponse, LearningEvent, ReppoJob, SellerReputation, SellerReview } from "../learning/types";

function createJsonStore<T>(key: string, fallback: T, parse: (raw: unknown) => T) {
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: T } | undefined;
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      const onStorage = (e: StorageEvent) => e.key === key && listener();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    getSnapshot(): T {
      const raw = localStorage.getItem(key);
      if (cache && cache.raw === raw) return cache.value;
      let value = fallback;
      try {
        value = raw ? parse(JSON.parse(raw)) : fallback;
      } catch {
        value = fallback;
      }
      cache = { raw, value };
      return value;
    },
    getServerSnapshot(): T {
      return fallback;
    },
    set(next: T | ((prev: T) => T)) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(store.getSnapshot()) : next;
      localStorage.setItem(key, JSON.stringify(value));
      listeners.forEach((l) => l());
    },
    clear() {
      localStorage.removeItem(key);
      listeners.forEach((l) => l());
    },
  };
  return store;
}

const asArray = <T,>(limit: number) => (raw: unknown): T[] => (Array.isArray(raw) ? (raw.slice(-limit) as T[]) : []);
const EMPTY_DEALS: DealRecord[] = [];
const EMPTY_REVIEWS: SellerReview[] = [];
const EMPTY_LOG: LearningEvent[] = [];
const EMPTY_JOBS: ReppoJob[] = [];

export const profileStore = createJsonStore<StrategyProfile>("melit.profile.v1", DEFAULT_PROFILE, parseProfile);
export const dealsStore = createJsonStore<DealRecord[]>("melit.deals.v1", EMPTY_DEALS, asArray<DealRecord>(100));
export const reviewsStore = createJsonStore<SellerReview[]>("melit.reviews.v1", EMPTY_REVIEWS, asArray<SellerReview>(100));
export const learningLogStore = createJsonStore<LearningEvent[]>("melit.learning.v1", EMPTY_LOG, asArray<LearningEvent>(100));
export const reppoJobsStore = createJsonStore<ReppoJob[]>("melit.reppo.v1", EMPTY_JOBS, asArray<ReppoJob>(50));

export function resetLearning() {
  profileStore.clear();
  dealsStore.clear();
  reviewsStore.clear();
  learningLogStore.clear();
  reppoJobsStore.clear();
}

function logEvent(event: LearningEvent) {
  learningLogStore.set((log) => [...log, event].slice(-100));
}

/** A seller reviewed Melit: store it and apply the market rule to the strategy. */
export function recordSellerReview(review: SellerReview): SellerReputation {
  const reviews = [...reviewsStore.getSnapshot().filter((r) => r.id !== review.id), review].slice(-100);
  reviewsStore.set(reviews);
  const reputation = reputationFor(reviews, review.sellerId);
  const lesson = marketLesson(review, reputation);
  if (lesson) {
    const applied = applyBoundedUpdate(profileStore.getSnapshot(), lesson.update, "market");
    if (applied.changes.length) {
      profileStore.set(applied.profile);
      logEvent({
        id: `learn_${crypto.randomUUID()}`,
        at: Date.now(),
        source: "market",
        dealId: null,
        learned: lesson.learned,
        changes: applied.changes,
        capped: applied.capped,
        method: "rule",
        profileVersion: applied.profile.version,
      });
    }
  }
  return reputation;
}

/** A negotiation finished: keep it for metrics and, for purchases, queue it for Reppo. */
/** Queue purchased deals for Reppo immediately; the hook no-ops submit when Reppo is not configured. */
export function recordDeal(summary: DealSummary, review: SellerReview | null) {
  const record: DealRecord = {
    dealId: summary.dealId,
    at: summary.at,
    itemName: summary.itemName,
    sellerName: summary.sellerName,
    outcome: summary.outcome,
    listPriceCents: summary.listPriceCents,
    marketReferenceCents: summary.marketReferenceCents,
    paidCents: summary.paidCents,
    rounds: summary.rounds.length,
    profileVersion: summary.profile.version,
    summary,
    review,
    feedback: null,
  };
  dealsStore.set((deals) => [...deals.filter((d) => d.dealId !== record.dealId), record].slice(-100));
  if (summary.outcome === "purchased") {
    reppoJobsStore.set((jobs) => enqueue(jobs, summary.dealId, Date.now()));
  }
}

/** After Reppo becomes configured, enqueue any purchased deals that finished before /api/agent loaded. */
export function backfillReppoJobs() {
  const jobs = reppoJobsStore.getSnapshot();
  const jobDeals = new Set(jobs.map((j) => j.dealId));
  const missing = dealsStore
    .getSnapshot()
    .filter((d) => d.outcome === "purchased" && d.summary && !jobDeals.has(d.dealId));
  if (missing.length === 0) return;
  let next = jobs;
  const now = Date.now();
  for (const d of missing) {
    next = enqueue(next, d.dealId, now);
  }
  reppoJobsStore.set(next);
}

async function postFeedback(body: Record<string, unknown>): Promise<FeedbackResponse> {
  const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as (FeedbackResponse & { error?: string; retryable?: boolean }) | null;
  if (!res.ok || !data?.profile) {
    const err = new Error(data?.error ?? `Feedback failed (HTTP ${res.status})`) as Error & { retryable?: boolean };
    err.retryable = data?.retryable ?? res.status >= 500;
    throw err;
  }
  return data;
}

function applyServerProfile(profile: StrategyProfile) {
  profileStore.set(parseProfile(profile));
}

export async function sendOwnerFeedback(dealId: string, rating: "up" | "down", note: string): Promise<LearningEvent> {
  const deal = dealsStore.getSnapshot().find((d) => d.dealId === dealId);
  if (!deal?.summary) throw new Error("That negotiation is no longer stored in this browser.");
  const data = await postFeedback({ kind: "owner", summary: deal.summary, profile: profileStore.getSnapshot(), rating, note });
  applyServerProfile(data.profile);
  logEvent(data.event);
  dealsStore.set((deals) => deals.map((d) => (d.dealId === dealId ? { ...d, feedback: { rating, note: note.trim(), at: Date.now() } } : d)));
  return data.event;
}

/** Turn a finished Reppo verdict into a strategy update. The server re-fetches the verdict from Reppo. */
export async function learnFromReppo(job: ReppoJob): Promise<LearningEvent> {
  const deal = dealsStore.getSnapshot().find((d) => d.dealId === job.dealId);
  if (!deal?.summary || !job.evalId) throw Object.assign(new Error("Negotiation no longer stored."), { retryable: false });
  const data = await postFeedback({ kind: "reppo", summary: deal.summary, profile: profileStore.getSnapshot(), evalId: job.evalId });
  applyServerProfile(data.profile);
  logEvent(data.event);
  return data.event;
}
