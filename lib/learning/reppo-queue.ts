// Client-side Reppo job queue as pure functions. One evaluation is submitted at a time; a job
// waits in "queued" until nothing else is pending. Nothing here is awaited by a purchase: the
// queue runs on its own timer after deals finish.

import type { ReppoJob, ReppoVerdict } from "./types";

export const REPPO_POLL_MS = 10_000;
export const REPPO_MAX_ATTEMPTS = 5;
export const REPPO_MAX_JOBS = 50;

export type QueueAction = { type: "submit"; job: ReppoJob } | { type: "poll"; job: ReppoJob } | null;

export function enqueue(jobs: ReppoJob[], dealId: string, now: number): ReppoJob[] {
  if (jobs.some((j) => j.dealId === dealId)) return jobs;
  const job: ReppoJob = {
    dealId,
    state: "queued",
    evalId: null,
    queuedAt: now,
    submittedAt: null,
    remoteStatus: null,
    verdict: null,
    error: null,
    retryAt: now,
    attempts: 0,
    learned: false,
  };
  return [...jobs, job].slice(-REPPO_MAX_JOBS);
}

/** What the queue should do next, if anything is due. Polling the pending job beats submitting. */
export function nextAction(jobs: ReppoJob[], now: number): QueueAction {
  const pending = jobs.find((j) => j.state === "pending");
  if (pending) return pending.retryAt <= now ? { type: "poll", job: pending } : null;
  const queued = jobs.filter((j) => j.state === "queued").sort((a, b) => a.queuedAt - b.queuedAt)[0];
  return queued && queued.retryAt <= now ? { type: "submit", job: queued } : null;
}

const update = (jobs: ReppoJob[], dealId: string, patch: (j: ReppoJob) => Partial<ReppoJob>) =>
  jobs.map((j) => (j.dealId === dealId ? { ...j, ...patch(j) } : j));

export function markSubmitted(jobs: ReppoJob[], dealId: string, evalId: string, remoteStatus: string, now: number): ReppoJob[] {
  return update(jobs, dealId, () => ({ state: "pending", evalId, remoteStatus, submittedAt: now, retryAt: now + REPPO_POLL_MS, attempts: 0, error: null }));
}

export function markPolled(
  jobs: ReppoJob[],
  dealId: string,
  result: { status: string; verdict: ReppoVerdict | null; error: string | null },
  now: number,
): ReppoJob[] {
  if (result.status === "COMPLETED" && result.verdict) {
    return update(jobs, dealId, () => ({ state: "verdict", remoteStatus: result.status, verdict: result.verdict, error: null }));
  }
  if (result.status === "FAILED") {
    return update(jobs, dealId, () => ({ state: "failed", remoteStatus: result.status, error: result.error ?? "Reppo marked the evaluation FAILED." }));
  }
  return update(jobs, dealId, () => ({ remoteStatus: result.status, retryAt: now + REPPO_POLL_MS, attempts: 0, error: null }));
}

/** Network or server error. Transient errors back off and retry; others fail the job. */
export function markError(jobs: ReppoJob[], dealId: string, error: string, retryable: boolean, now: number): ReppoJob[] {
  return update(jobs, dealId, (j) => {
    const attempts = j.attempts + 1;
    if (!retryable || attempts >= REPPO_MAX_ATTEMPTS) return { state: "failed", error, attempts };
    return { error, attempts, retryAt: now + REPPO_POLL_MS * 2 ** attempts };
  });
}

export function markLearned(jobs: ReppoJob[], dealId: string): ReppoJob[] {
  return update(jobs, dealId, () => ({ learned: true }));
}

/** Verdicts that arrived but haven't been turned into a strategy update yet. */
export function verdictsToLearn(jobs: ReppoJob[]): ReppoJob[] {
  return jobs.filter((j) => j.state === "verdict" && !j.learned && j.evalId);
}
