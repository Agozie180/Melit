"use client";

import { useState } from "react";
import { formatUsd } from "@/lib/money";
import type { DealRecord, LearningEvent, ReppoJob } from "@/lib/learning/types";
import { Badge, Card, CardTitle } from "./ui";
import { Stars } from "./ReputationCard";

const OUTCOME: Record<DealRecord["outcome"], { label: string; tone: "green" | "neutral" | "red" | "amber" }> = {
  purchased: { label: "Bought", tone: "green" },
  "melit-walked": { label: "Melit walked", tone: "neutral" },
  "seller-walked": { label: "Seller walked", tone: "neutral" },
  "no-deal": { label: "No deal", tone: "neutral" },
  blocked: { label: "Blocked by Spend Guard", tone: "red" },
  "payment-failed": { label: "Payment failed", tone: "amber" },
};

function ReppoStatus({ job, reppoConfigured, outcome }: { job: ReppoJob | undefined; reppoConfigured: boolean; outcome: DealRecord["outcome"] }) {
  if (!job) {
    if (outcome !== "purchased") return null;
    return <p className="text-xs text-neutral-500">{reppoConfigured ? "Not sent to Reppo." : "Reppo isn't configured on this deployment."}</p>;
  }
  const label =
    job.state === "queued"
      ? "Reppo: queued"
      : job.state === "pending"
        ? `Reppo: pending (${(job.remoteStatus ?? "submitted").toLowerCase()})`
        : job.state === "failed"
          ? "Reppo: failed"
          : `Reppo verdict: ${job.verdict?.score ?? "?"}/100 · ${job.verdict?.route ?? "?"}`;
  const tone = job.state === "verdict" ? (job.verdict?.route === "ship" ? "green" : job.verdict?.route === "block" ? "red" : "amber") : job.state === "failed" ? "red" : "neutral";
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={tone}>
          {(job.state === "queued" || job.state === "pending") && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
          {label}
        </Badge>
        {job.state === "verdict" && job.verdict?.confidence && <span className="text-neutral-500">{job.verdict.confidence} confidence</span>}
        {job.state === "verdict" && !job.learned && <span className="text-neutral-500">applying to strategy…</span>}
      </div>
      {job.state === "verdict" && job.verdict?.reason && (
        <details className="mt-1">
          <summary className="cursor-pointer text-emerald-800 hover:underline">Why Reppo said that</summary>
          <p className="mt-1 text-neutral-700">{job.verdict.reason}</p>
          {Object.keys(job.verdict.rubric).length > 0 && (
            <p className="mt-1 text-neutral-500">
              {Object.entries(job.verdict.rubric)
                .map(([k, v]) => `${k.replace(/_/g, " ")} ${Math.round(v)}`)
                .join(" · ")}
            </p>
          )}
          {job.verdict.evaluators.length > 0 && (
            <p className="mt-1 text-neutral-500">Evaluators: {job.verdict.evaluators.map((e) => `${e.model}${e.overall !== null ? ` ${Math.round(e.overall)}` : ""}`).join(", ")}</p>
          )}
          {job.evalId && <p className="mt-1 font-mono text-[10px] text-neutral-400">Reppo eval {job.evalId}</p>}
        </details>
      )}
      {job.error && job.state !== "verdict" && <p className="mt-1 text-neutral-500">{job.error}</p>}
    </div>
  );
}

function FeedbackForm({ deal, onSend }: { deal: DealRecord; onSend: (rating: "up" | "down", note: string) => Promise<LearningEvent> }) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ status: "idle" | "sending" | "error"; message?: string }>({ status: "idle" });

  if (deal.feedback) {
    return (
      <p className="text-xs text-neutral-600">
        You gave this a {deal.feedback.rating === "up" ? "👍" : "👎"}
        {deal.feedback.note && <> · “{deal.feedback.note}”</>}
      </p>
    );
  }
  if (!deal.summary) return null;

  async function send() {
    if (!rating) return;
    setState({ status: "sending" });
    try {
      await onSend(rating, note);
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500">How did Melit do?</span>
        {(["up", "down"] as const).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRating(r)}
            aria-pressed={rating === r}
            aria-label={r === "up" ? "Thumbs up" : "Thumbs down"}
            className={`rounded-lg px-2 py-1 text-sm ring-1 transition-colors ${rating === r ? (r === "up" ? "bg-emerald-50 ring-emerald-400" : "bg-red-50 ring-red-300") : "ring-black/10 hover:bg-neutral-50"}`}
          >
            {r === "up" ? "👍" : "👎"}
          </button>
        ))}
      </div>
      {rating && (
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder={rating === "up" ? "Optional: what was good?" : "Optional: e.g. you paid too much / you lost the deal"}
            className="min-w-0 flex-1 rounded-lg border border-black/10 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
            onKeyDown={(e) => e.key === "Enter" && void send()}
          />
          <button
            type="button"
            onClick={send}
            disabled={state.status === "sending"}
            className="rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {state.status === "sending" ? "Learning…" : "Send"}
          </button>
        </div>
      )}
      {state.status === "error" && <p className="text-xs text-red-600">{state.message}</p>}
    </div>
  );
}

export function DealFeedback({
  deals,
  jobs,
  log,
  reppoConfigured,
  onFeedback,
}: {
  deals: DealRecord[];
  jobs: ReppoJob[];
  log: LearningEvent[];
  reppoConfigured: boolean;
  onFeedback: (dealId: string, rating: "up" | "down", note: string) => Promise<LearningEvent>;
}) {
  const recent = [...deals].reverse().slice(0, 6);
  return (
    <Card>
      <CardTitle aside={<span className="text-xs text-neutral-500">latest {recent.length} of {deals.length}</span>}>Deals & feedback</CardTitle>
      {recent.length === 0 ? (
        <p className="text-sm text-neutral-500">Finished negotiations appear here so you can rate them. Purchases are also sent to Reppo&apos;s evaluator panel.</p>
      ) : (
        <ul className="space-y-3">
          {recent.map((d) => {
            const job = jobs.find((j) => j.dealId === d.dealId);
            const learned = [...log].reverse().find((e) => e.dealId === d.dealId && e.source === "owner");
            const o = OUTCOME[d.outcome];
            return (
              <li key={d.dealId} className="space-y-2 rounded-xl border border-black/[0.06] p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">{d.itemName}</span>
                  <Badge tone={o.tone}>{o.label}</Badge>
                  {d.paidCents !== null && (
                    <span className="text-neutral-600">
                      {formatUsd(d.paidCents)} <span className="text-neutral-400">of {formatUsd(d.listPriceCents)}</span>
                    </span>
                  )}
                  <span className="ml-auto text-xs text-neutral-500">
                    {d.rounds} round{d.rounds === 1 ? "" : "s"} · strategy v{d.profileVersion}
                  </span>
                </div>
                {d.review && (
                  <p className="text-xs text-neutral-600">
                    <Stars rating={d.review.rating} /> <span className="font-medium">{d.review.sellerName}</span>: “{d.review.text}”
                  </p>
                )}
                <ReppoStatus job={job} reppoConfigured={reppoConfigured} outcome={d.outcome} />
                <FeedbackForm deal={d} onSend={(rating, note) => onFeedback(d.dealId, rating, note)} />
                {learned && (
                  <p className="rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs text-violet-950">
                    <span className="font-semibold">What Melit learned:</span> {learned.learned}
                    {learned.method === "fallback" && <span className="text-amber-800"> (fallback rule; SERV unavailable)</span>}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
