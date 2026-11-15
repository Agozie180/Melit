import { learningMetrics, type MetricSet } from "@/lib/learning/metrics";
import type { DealRecord, ReppoJob } from "@/lib/learning/types";
import { Card, CardTitle } from "./ui";

const fmt = (v: number | null, suffix = "%") => (v === null ? "–" : `${v.toFixed(1)}${suffix}`);

function Delta({ before, after, higherIsBetter = true }: { before: number | null; after: number | null; higherIsBetter?: boolean }) {
  if (before === null || after === null) return null;
  const d = Math.round((after - before) * 10) / 10;
  if (d === 0) return <span className="text-xs text-neutral-400">±0</span>;
  const good = higherIsBetter ? d > 0 : d < 0;
  return <span className={`text-xs font-medium ${good ? "text-emerald-700" : "text-red-600"}`}>{d > 0 ? `+${d}` : d}</span>;
}

const ROWS: { label: string; get: (m: MetricSet) => number | null; higherIsBetter?: boolean; suffix?: string }[] = [
  { label: "Average saved vs list", get: (m) => m.avgSavedPct },
  { label: "Paid vs market reference", get: (m) => m.avgPaidVsMarketPct, higherIsBetter: false },
  { label: "Deals closed", get: (m) => m.closedPct },
  { label: "Owner approval", get: (m) => m.approvalPct },
];

export function MetricsCard({ deals, jobs }: { deals: DealRecord[]; jobs: ReppoJob[] }) {
  const m = learningMetrics(deals);
  const verdicts = jobs.filter((j) => j.state === "verdict" && j.verdict?.score !== null);
  const avgReppo = verdicts.length ? verdicts.reduce((s, j) => s + (j.verdict?.score ?? 0), 0) / verdicts.length : null;
  return (
    <Card>
      <CardTitle aside={<span className="text-xs text-neutral-500">from your real negotiations in this browser</span>}>Is Melit getting better?</CardTitle>
      {m.all.negotiations === 0 ? (
        <p className="text-sm text-neutral-500">No negotiations yet. Metrics appear after your first deal; nothing here is pre-filled.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500">
                  <th className="py-1 font-medium" />
                  <th className="py-1 text-right font-medium">Before feedback</th>
                  <th className="py-1 text-right font-medium">After feedback</th>
                  <th className="py-1 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-t border-black/[0.05]">
                    <td className="py-1.5">{r.label}</td>
                    <td className="py-1.5 text-right">{fmt(r.get(m.before))}</td>
                    <td className="py-1.5 text-right">{fmt(r.get(m.after))}</td>
                    <td className="py-1.5 text-right">
                      <Delta before={r.get(m.before)} after={r.get(m.after)} higherIsBetter={r.higherIsBetter} />
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-black/[0.05] text-xs text-neutral-500">
                  <td className="py-1.5">Negotiations · purchases · rated</td>
                  <td className="py-1.5 text-right">
                    {m.before.negotiations} · {m.before.closed} · {m.before.rated}
                  </td>
                  <td className="py-1.5 text-right">
                    {m.after.negotiations} · {m.after.closed} · {m.after.rated}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            &quot;Before&quot; = deals run with the default strategy; &quot;after&quot; = deals run once feedback had changed it at least once.
            {avgReppo !== null
              ? ` Reppo average: ${avgReppo.toFixed(0)}/100 across ${verdicts.length} returned verdict${verdicts.length === 1 ? "" : "s"}.`
              : " No Reppo verdicts returned yet."}
          </p>
        </>
      )}
    </Card>
  );
}
