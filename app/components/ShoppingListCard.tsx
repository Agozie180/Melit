"use client";

import { useState, type FormEvent } from "react";
import type { LedgerEntry, PublicItem } from "@/lib/types";
import { dollarsToCents, formatUsd } from "@/lib/money";
import {
  duplicateItemMessage,
  itemStatus,
  normalizeItemName,
  type ShoppingListItem,
  type SignedShoppingList,
} from "@/lib/shopping/list";
import { Badge, Card, CardTitle } from "./ui";

interface DraftRow {
  name: string;
  maxPrice: string;
  quantity: string;
}

function toDraft(items: readonly ShoppingListItem[]): DraftRow[] {
  return items.map((item) => ({ name: item.name, maxPrice: String(item.maxPrice / 100), quantity: String(item.quantity) }));
}

function sameDraft(a: readonly DraftRow[], b: readonly DraftRow[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ShoppingListCard({
  signed,
  ledger,
  catalog,
  onSave,
}: {
  signed: SignedShoppingList | null;
  ledger: LedgerEntry[];
  catalog: PublicItem[];
  onSave: (items: ShoppingListItem[]) => Promise<void>;
}) {
  const sig = signed?.sig ?? "";
  const savedRows = toDraft(signed?.items ?? []);
  const [seenSig, setSeenSig] = useState(sig);
  const [rows, setRows] = useState<DraftRow[]>(savedRows);
  const [name, setName] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (sig !== seenSig) {
    setSeenSig(sig);
    setRows(savedRows);
  }

  const dirty = !sameDraft(rows, savedRows);
  const known = new Set(catalog.map((item) => normalizeItemName(item.name)));

  function addRow(e: FormEvent) {
    e.preventDefault();
    const max = Number(maxPrice);
    const qty = Number(quantity);
    if (!name.trim()) return setError("Name the item the way the seller lists it.");
    if (!Number.isFinite(max) || max <= 0) return setError("Set a max price above $0.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return setError("Quantity must be a whole number from 1 to 99.");
    if (rows.length >= 30) return setError("The list holds 30 items.");
    setError(null);
    setRows((prev) => [...prev, { name: name.trim(), maxPrice: String(max), quantity: String(qty) }]);
    setName("");
    setMaxPrice("");
    setQuantity("1");
  }

  async function save() {
    const items: ShoppingListItem[] = [];
    for (const row of rows) {
      const max = Number(row.maxPrice);
      const qty = Number(row.quantity);
      if (!row.name.trim()) return setError("Every row needs a name.");
      if (!Number.isFinite(max) || max <= 0) return setError(`Set a max price above $0 for ${row.name}.`);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) return setError(`Quantity for ${row.name} must be a whole number from 1 to 99.`);
      items.push({ name: row.name.trim(), maxPrice: dollarsToCents(max), quantity: qty });
    }
    const dup = duplicateItemMessage(items);
    if (dup) return setError(dup);
    setSaving(true);
    setError(null);
    try {
      await onSave(items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardTitle aside={<Badge tone={signed ? "green" : "amber"}>{signed ? "signed" : "not saved"}</Badge>}>Shopping list</CardTitle>
      <p className="text-sm text-neutral-600">
        This is what Melit can buy: only these items, at or under each max price, while any quantity is left. The $300 weekly cap is separate. That is how much it can spend. The server signs this list and checks it again before every payment.
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-black/10 p-3 text-sm text-neutral-500">
          Nothing here yet. Press Negotiate and buy before you save if you want to see the refusal. Melit declines every purchase until you add an item and save.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row, index) => {
            const max = Number(row.maxPrice);
            const qty = Number(row.quantity);
            const parsed =
              row.name.trim() && Number.isFinite(max) && max > 0 && Number.isInteger(qty) && qty > 0
                ? { name: row.name.trim(), maxPrice: dollarsToCents(max), quantity: qty }
                : null;
            const status = parsed ? itemStatus(parsed, ledger) : null;
            const knownName = known.has(normalizeItemName(row.name));
            return (
              <li key={`${row.name}-${index}`} className="rounded-xl border border-black/[0.06] bg-neutral-50/70 p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.name}</p>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <label className="block text-[11px] text-neutral-500">
                        Max price ($)
                        <input
                          value={row.maxPrice}
                          onChange={(e) => setRows((prev) => prev.map((entry, i) => (i === index ? { ...entry, maxPrice: e.target.value } : entry)))}
                          inputMode="decimal"
                          aria-label={`Max price for ${row.name}`}
                          className="mt-0.5 w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm tabular-nums text-neutral-900 outline-none focus:border-emerald-600"
                        />
                      </label>
                      <label className="block text-[11px] text-neutral-500">
                        Quantity
                        <input
                          value={row.quantity}
                          onChange={(e) => setRows((prev) => prev.map((entry, i) => (i === index ? { ...entry, quantity: e.target.value } : entry)))}
                          inputMode="numeric"
                          aria-label={`Quantity for ${row.name}`}
                          className="mt-0.5 w-full rounded-lg border border-black/10 bg-white px-2 py-1 text-sm tabular-nums text-neutral-900 outline-none focus:border-emerald-600"
                        />
                      </label>
                    </div>
                    {status && status.remaining > 0 && status.bought > 0 && (
                      <p className="mt-1 text-xs text-neutral-500">{status.remaining} left</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    className="shrink-0 text-xs font-medium text-neutral-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {status?.state === "waiting" && <Badge>waiting</Badge>}
                  {status?.state === "bought" && <Badge tone="green">bought</Badge>}
                  {status?.state === "bought" && <Badge tone="green">saved {formatUsd(status.savedCents)}</Badge>}
                  {!knownName && <Badge tone="amber">name not in the catalog</Badge>}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={addRow} className="mt-3 space-y-2">
        <label className="block">
          <span className="text-xs font-medium">Item</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            list="melit-list-catalog"
            placeholder="Wireless Earbuds"
            className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
          />
          <datalist id="melit-list-catalog">
            {catalog.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-medium">Max price ($)</span>
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              inputMode="decimal"
              placeholder="120"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Quantity</span>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="numeric"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
            />
          </label>
        </div>
        <button type="submit" className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50">
          Add item
        </button>
      </form>

      {dirty && (
        <p className="mt-3 text-xs text-amber-800">Unsaved changes. Melit still uses the last signed list until you save.</p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={saving || !dirty}
        className="mt-3 w-full rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save list"}
      </button>
      <p className="mt-2 text-xs text-neutral-500">Reset demo clears the ledger, which also restores quantities. It does not change this list.</p>
    </Card>
  );
}
