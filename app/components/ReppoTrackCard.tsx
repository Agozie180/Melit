"use client";

import { formatUsd } from "@/lib/money";
import type { DealRecord, ReppoJob, ReppoJobState } from "@/lib/learning/types";
import { Badge, Card, CardTitle } from "./ui";

const STATE_TONE: Record<ReppoJobState, "neutral" | "green" | "amber" | "red" | "violet"> = {
  queued: "violet",
  pending: "violet",
  verdict: "green",
  failed: "red",
};

function jobLabel(job: ReppoJob): string {
  switch (job.state) {
    case "queued":
      return "Queued";
    case "pending":
      return `Pending (${(job.remoteStatus ?? "submitted").toLowerCase()})`;
    case "failed":
      return "Failed";
    case "verdict":
      return `Verdict ${job.verdict?.score ?? "?"}/100 · ${job.verdict?.route ?? "?"}`;
  }
}

export function ReppoTrackCard({
  jobs,
  deals,
  reppoConfigured,
}: {
  jobs: ReppoJob[];
  deals: DealRecord[];
  reppoConfigured: boolean;
}) {
  const byDeal = new Map(deals.map((d) => [d.dealId, d]));
  const sorted = [...jobs].sort((a, b) => b.queuedAt - a.queuedAt);
  const counts = { queued: 0, pending: 0, verdict: 0, failed: 0 } as Record<ReppoJobState, number>;
  for (const j of jobs) counts[j.state]++;

  return (
    <Card className="ring-1 ring-violet-200/80">
      <CardTitle
        aside={
          reppoConfigured ? (
            <Badge tone="violet">Reppo track</Badge>
          ) : (
            <Badge tone="amber">REPPO_API_KEY not set</Badge>
          )
        }
      >
        Reppo evaluations
      </CardTitle>
      <p className="mb-3 text-xs text-neutral-600">
        Every purchase is judged asynchronously by Reppo&apos;s evaluator panel. Purchases never wait on this queue. Keep this tab open until jobs reach verdict and
        learned — the queue runs in the browser, not on the server.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["queued", "pending", "verdict", "failed"] as const).map((s) => (
          <Badge key={s} tone={STATE_TONE[s]}>
            {s}: {counts[s]}
          </Badge>
        ))}
      </div>
      {sorted.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {reppoConfigured ? "No Reppo jobs yet. Complete a purchase to enqueue one." : "Configure Reppo on the server to see live evaluations here."}
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((job) => {
            const deal = byDeal.get(job.dealId);
            const tone = job.state === "verdict" && job.verdict?.route === "block" ? "red" : job.state === "verdict" && job.verdict?.route === "review" ? "amber" : STATE_TONE[job.state];
            return (
              <li key={job.dealId} className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-neutral-900">{deal?.itemName ?? job.dealId.slice(0, 8)}</span>
                {deal?.paidCents != null && <span className="text-xs text-neutral-500">{formatUsd(deal.paidCents)}</span>}
                <Badge tone={tone}>
                  {(job.state === "queued" || job.state === "pending") && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
                  {jobLabel(job)}
                </Badge>
                {job.state === "verdict" && job.verdict?.reason && (
                  <span className="w-full text-xs text-neutral-600" title={job.verdict.reason}>
                    {job.verdict.reason.length > 120 ? `${job.verdict.reason.slice(0, 117)}…` : job.verdict.reason}
                  </span>
                )}
                {job.state === "verdict" && job.verdict?.confidence && <span className="text-xs text-neutral-500">{job.verdict.confidence}</span>}
                {(job.state === "failed" || job.state === "pending") && job.attempts > 0 && (
                  <span className="text-xs text-neutral-500">attempt {job.attempts}</span>
                )}
                {job.learned && <Badge tone="green">learned</Badge>}
                {job.error && job.state !== "verdict" && <span className="w-full text-xs text-red-700">{job.error}</span>}
                {job.evalId && <span className="w-full font-mono text-[10px] text-neutral-400">eval {job.evalId}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}