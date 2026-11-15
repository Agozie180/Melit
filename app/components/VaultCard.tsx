import { formatUsd, splitSavings } from "@/lib/money";
import { Card, CardTitle } from "./ui";

export function VaultCard({ savedCents, purchases }: { savedCents: number; purchases: number }) {
  const { feeCents, userCents } = splitSavings(savedCents);
  return (
    <Card className="bg-gradient-to-br from-emerald-50 to-white">
      <CardTitle aside={<span className="text-xs text-neutral-500">{purchases} purchase{purchases === 1 ? "" : "s"}</span>}>Savings Vault</CardTitle>
      <p className="text-3xl font-semibold tabular-nums text-emerald-800">{formatUsd(savedCents)}</p>
      <p className="text-sm text-neutral-500">saved versus list prices</p>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-white/80 p-3 ring-1 ring-emerald-100">
          <p className="text-xs text-neutral-500">Yours (85%)</p>
          <p className="font-semibold tabular-nums">{formatUsd(userCents)}</p>
        </div>
        <div className="rounded-xl bg-white/80 p-3 ring-1 ring-black/5">
          <p className="text-xs text-neutral-500">Melit fee (15%)</p>
          <p className="font-semibold tabular-nums">{formatUsd(feeCents)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs text-neutral-500">Melit only earns when it saves you money. No savings, no fee.</p>
    </Card>
  );
}
