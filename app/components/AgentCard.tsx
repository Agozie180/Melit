import type { AgentInfo } from "@/lib/client/api";
import { formatUsd } from "@/lib/money";
import { RAIL_LABEL } from "@/lib/payments/types";
import { Badge } from "./ui";

const MODE_LABEL: Record<AgentInfo["payments"]["mode"], string> = {
  testnet: "KiteAI testnet",
  recorded: "Recorded testnet receipts",
  simulated: "Simulated",
};

export function AgentCard({ info }: { info: AgentInfo | null }) {
  if (!info) {
    return <div className="h-[92px] w-full animate-pulse rounded-2xl bg-white/70 sm:w-[360px]" aria-label="Loading agent identity" />;
  }
  const { identity, reasoning, payments } = info;
  const idBadge =
    identity.status === "kite-passport-sandbox" ? (
      <Badge tone="green">Passport sandbox</Badge>
    ) : identity.status === "testnet-wallet" ? (
      <Badge tone="violet">Testnet wallet</Badge>
    ) : (
      <Badge tone="amber">Simulated</Badge>
    );
  return (
    <div className="w-full rounded-2xl border border-black/[0.07] bg-white p-4 sm:w-[380px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Melit Agent ID</p>
          {identity.explorerUrl ? (
            <a href={identity.explorerUrl} target="_blank" rel="noreferrer" className="block truncate font-mono text-sm text-neutral-900 underline decoration-dotted" title={identity.agentId}>
              {identity.agentId}
            </a>
          ) : (
            <p className="truncate font-mono text-sm text-neutral-900" title={identity.agentId}>
              {identity.agentId}
            </p>
          )}
          <p className="text-[11px] text-neutral-500">{identity.statusLabel}</p>
        </div>
        {idBadge}
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-neutral-500">Spending limit</dt>
        <dd className="text-right font-medium">
          {formatUsd(identity.spendingLimitCents)} / {identity.limitWindow}
        </dd>
        <dt className="text-neutral-500">Payments</dt>
        <dd className="text-right">
          {MODE_LABEL[payments.mode]}
          {payments.mode === "testnet" && ` · ${payments.asset}, chain ${payments.chainId}`}
        </dd>
        <dt className="text-neutral-500">Rails</dt>
        <dd className="text-right">
          {payments.rails.length ? payments.rails.map((r) => RAIL_LABEL[r]).join(" → ") : <span className="text-red-700">none configured</span>}
        </dd>
        {payments.mode === "testnet" && (
          <>
            <dt className="text-neutral-500">Testnet scale</dt>
            <dd className="text-right">
              $1.00 = {payments.testnetScale} {payments.asset}
            </dd>
          </>
        )}
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
