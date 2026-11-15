import type { AgentInfo } from "@/lib/client/api";
import { formatUsd } from "@/lib/money";
import { Badge } from "./ui";

export function AgentCard({ info }: { info: AgentInfo | null }) {
  if (!info) {
    return <div className="h-[92px] w-full animate-pulse rounded-2xl bg-white/70 sm:w-[340px]" aria-label="Loading agent identity" />;
  }
  const { identity, reasoning, payments } = info;
  return (
    <div className="w-full rounded-2xl border border-black/[0.07] bg-white p-4 sm:w-[360px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Melit Agent ID</p>
          <p className="truncate font-mono text-sm text-neutral-900" title={identity.agentId}>
            {identity.agentId}
          </p>
        </div>
        {identity.verified ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Simulated</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-neutral-500">Spending limit</dt>
        <dd className="text-right font-medium">
          {formatUsd(identity.spendingLimitCents)} / {identity.limitWindow}
        </dd>
        <dt className="text-neutral-500">Identity</dt>
        <dd className="text-right">{identity.provider} (simulated)</dd>
        <dt className="text-neutral-500">Payments</dt>
        <dd className="text-right">{payments.mode === "simulated" ? "Simulated (x402/Kite-ready)" : "Kite x402"}</dd>
        <dt className="text-neutral-500">Reasoning</dt>
        <dd className="text-right">
          {reasoning.configured ? (
            <span className="text-emerald-700">SERV · {reasoning.model}</span>
          ) : (
            <span className="text-amber-700">SERV not configured</span>
          )}
        </dd>
      </dl>
    </div>
  );
}
