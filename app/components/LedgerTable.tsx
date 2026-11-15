import type { LedgerEntry } from "@/lib/types";
import { formatUsd } from "@/lib/money";
import { Badge, Card, CardTitle } from "./ui";

export function LedgerTable({ ledger }: { ledger: LedgerEntry[] }) {
  const rows = [...ledger].sort((a, b) => b.timestamp - a.timestamp);
  return (
    <Card>
      <CardTitle aside={<Badge tone="amber">Simulated payments</Badge>}>Ledger</CardTitle>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/10 p-4 text-center text-sm text-neutral-500">Nothing bought yet.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 text-right font-medium">List</th>
                <th className="py-2 text-right font-medium">Paid</th>
                <th className="py-2 text-right font-medium">Saved</th>
                <th className="py-2 text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-black/[0.06]">
                  <td className="py-2">
                    <p className="font-medium">{e.itemName}</p>
                    <p className="text-xs text-neutral-500">{e.sellerName}</p>
                  </td>
                  <td className="py-2 text-right text-neutral-500">{formatUsd(e.listPriceCents)}</td>
                  <td className="py-2 text-right">{formatUsd(e.paidCents)}</td>
                  <td className="py-2 text-right font-medium text-emerald-700">{formatUsd(e.savedCents)}</td>
                  <td className="py-2 text-right text-xs text-neutral-500">
                    {new Date(e.timestamp).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
