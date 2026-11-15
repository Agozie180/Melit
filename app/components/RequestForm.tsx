"use client";

import { useState, type FormEvent } from "react";
import type { Priority, PublicItem, ShoppingRequest } from "@/lib/types";
import { dollarsToCents, formatUsd } from "@/lib/money";
import { Card, CardTitle } from "./ui";

const PERSONALITY_LABEL: Record<PublicItem["personality"], string> = {
  firm: "firm",
  flexible: "flexible",
  bluffer: "bluffs",
  bundler: "likes bundles",
};

export function RequestForm({
  catalog,
  busy,
  onSubmit,
}: {
  catalog: PublicItem[];
  busy: boolean;
  onSubmit: (req: ShoppingRequest) => void;
}) {
  const [query, setQuery] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [priority, setPriority] = useState<Priority>("save");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const max = Number(maxPrice);
    if (!query.trim()) return setError("Tell Melit what you need.");
    if (!Number.isFinite(max) || max <= 0) return setError("Set a max price above $0.");
    setError(null);
    onSubmit({ query: query.trim(), maxPriceCents: dollarsToCents(max), priority });
  }

  function pick(item: PublicItem) {
    setQuery(item.name);
    setMaxPrice(String(Math.round(item.listPriceCents / 100)));
    setError(null);
  }

  const shoppable = catalog.filter((i) => i.listPriceCents <= 300_00);

  return (
    <Card>
      <CardTitle>Shopping request</CardTitle>
      <form onSubmit={submit} className="space-y-3">
        <label className="block">
          <span className="text-sm font-medium">What do you need?</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            list="melit-catalog"
            placeholder="e.g. wireless earbuds"
            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
          />
          <datalist id="melit-catalog">
            {catalog.map((i) => (
              <option key={i.id} value={i.name} />
            ))}
          </datalist>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Max price ($)</span>
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              inputMode="decimal"
              placeholder="120"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
            />
          </label>
          <fieldset>
            <legend className="text-sm font-medium">Priority</legend>
            <div className="mt-1 grid grid-cols-2 rounded-xl bg-neutral-100 p-1 text-sm">
              {(["save", "fast"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  aria-pressed={priority === p}
                  className={`rounded-lg px-2 py-1.5 font-medium transition-colors ${priority === p ? "bg-white shadow-sm" : "text-neutral-500 hover:text-neutral-800"}`}
                >
                  {p === "save" ? "Save more" : "Buy fast"}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Melit is negotiating…" : "Negotiate and buy"}
        </button>
      </form>

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Mock market (labelled test sellers)</p>
        <ul className="flex flex-wrap gap-1.5">
          {shoppable.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => pick(item)}
                className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs transition-colors hover:border-emerald-600 hover:bg-emerald-50"
                title={`${item.sellerName}: ${PERSONALITY_LABEL[item.personality]}. Market reference ${formatUsd(item.marketReferenceCents)}`}
              >
                {item.name} <span className="text-neutral-500">{formatUsd(item.listPriceCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
