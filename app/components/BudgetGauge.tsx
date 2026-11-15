import { formatUsd } from "@/lib/money";
import { Card, CardTitle } from "./ui";

export function BudgetGauge({ spentCents, capCents }: { spentCents: number; capCents: number }) {
  const remaining = Math.max(0, capCents - spentCents);
  const pct = Math.min(100, (spentCents / capCents) * 100);
  const tone = pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <Card>
      <CardTitle aside={<span className="text-xs text-neutral-500">rolling 7 days</span>}>Weekly budget</CardTitle>
      <div className="flex items-baseline justify-between">
        <p className="text-3xl font-semibold tabular-nums">{formatUsd(spentCents)}</p>
        <p className="text-sm text-neutral-500">of {formatUsd(capCents)}</p>
      </div>
      <div
        className="mt-3 h-2.5 overflow-hidden rounded-full bg-neutral-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={capCents / 100}
        aria-valuenow={spentCents / 100}
        aria-label="Spent this week"
      >
        <div className={`h-full rounded-full transition-all duration-500 ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-sm">
        <span className="font-medium tabular-nums">{formatUsd(remaining)}</span>{" "}
        <span className="text-neutral-500">left. Hard cap enforced by the server-side Spend Guard.</span>
      </p>
    </Card>
  );
}
