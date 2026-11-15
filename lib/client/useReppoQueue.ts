"use client";

// Drives the Reppo job queue in the background. It runs on its own timer, holds no lock that
// shopping uses, and nothing in a purchase awaits it: a pending evaluation can never block
// a negotiation or a payment.

import { useEffect, useRef } from "react";
import { markError, markLearned, markPolled, markSubmitted, nextAction, verdictsToLearn } from "../learning/reppo-queue";
import type { ReppoVerdict } from "../learning/types";
import { backfillReppoJobs, dealsStore, learnFromReppo, reppoJobsStore } from "./learning";

const TICK_MS = 1_500;
const LEARN_RETRY_MS = 30_000;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const data = (await res.json().catch(() => null)) as (T & { error?: string; retryable?: boolean }) | null;
  if (!res.ok || !data) {
    throw Object.assign(new Error(data?.error ?? `HTTP ${res.status}`), { retryable: data?.retryable ?? (res.status >= 500 || res.status === 429) });
  }
  return data;
}

export function useReppoQueue(enabled: boolean) {
  const inFlight = useRef(false);
  const learnRetryAt = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) return;
    backfillReppoJobs();
    let cancelled = false;

    async function tick() {
      if (inFlight.current || cancelled) return;
      inFlight.current = true;
      try {
        const now = Date.now();
        const action = nextAction(reppoJobsStore.getSnapshot(), now);
        if (action?.type === "submit") {
          const deal = dealsStore.getSnapshot().find((d) => d.dealId === action.job.dealId);
          if (!deal?.summary) {
            reppoJobsStore.set((jobs) => markError(jobs, action.job.dealId, "Negotiation is no longer stored in this browser.", false, now));
          } else {
            try {
              const res = await call<{ evalId: string; status: string }>("/api/reppo", { method: "POST", body: JSON.stringify({ summary: deal.summary }) });
              reppoJobsStore.set((jobs) => markSubmitted(jobs, action.job.dealId, res.evalId, res.status, Date.now()));
            } catch (err) {
              const e = err as Error & { retryable?: boolean };
              reppoJobsStore.set((jobs) => markError(jobs, action.job.dealId, e.message, e.retryable ?? true, Date.now()));
            }
          }
        } else if (action?.type === "poll" && action.job.evalId) {
          try {
            const res = await call<{
              status: string;
              verdict: ReppoVerdict | null;
              error: string | null;
              terminal?: boolean;
            }>(`/api/reppo/${encodeURIComponent(action.job.evalId)}`);
            if (res.status === "COMPLETED" && !res.verdict) {
              reppoJobsStore.set((jobs) =>
                markError(jobs, action.job.dealId, "Reppo marked COMPLETED without a verdict payload.", false, Date.now()),
              );
            } else {
              reppoJobsStore.set((jobs) => markPolled(jobs, action.job.dealId, res, Date.now()));
            }
          } catch (err) {
            const e = err as Error & { retryable?: boolean };
            reppoJobsStore.set((jobs) => markError(jobs, action.job.dealId, e.message, e.retryable ?? true, Date.now()));
          }
        }

        for (const job of verdictsToLearn(reppoJobsStore.getSnapshot())) {
          if ((learnRetryAt.current.get(job.dealId) ?? 0) > Date.now()) continue;
          try {
            await learnFromReppo(job);
            reppoJobsStore.set((jobs) => markLearned(jobs, job.dealId));
          } catch (err) {
            const e = err as Error & { retryable?: boolean };
            if (e.retryable === false) reppoJobsStore.set((jobs) => markLearned(jobs, job.dealId));
            else learnRetryAt.current.set(job.dealId, Date.now() + LEARN_RETRY_MS);
          }
        }
      } finally {
        inFlight.current = false;
      }
    }

    const timer = setInterval(tick, TICK_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
}
