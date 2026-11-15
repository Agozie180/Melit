"use client";

import { useState, type FormEvent } from "react";
import { dollarsToCents } from "@/lib/money";
import type { ShoppingListItem } from "@/lib/shopping/list";

/** Opens an approval step. The item is not added until the owner submits. */
export function ApproveAdd({
  suggested,
  onApprove,
}: {
  suggested: ShoppingListItem;
  onApprove: (item: ShoppingListItem) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [maxPrice, setMaxPrice] = useState(String(suggested.maxPrice / 100));
  const [quantity, setQuantity] = useState(String(suggested.quantity));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function approve(e: FormEvent) {
    e.preventDefault();
    const max = Number(maxPrice);
    const qty = Number(quantity);
    if (!Number.isFinite(max) || max <= 0) return setError("Set a max price above $0.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return setError("Quantity must be a whole number from 1 to 99.");
    setPending(true);
    setError(null);
    try {
      await onApprove({ name: suggested.name, maxPrice: dollarsToCents(max), quantity: qty });
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-amber-400 bg-white px-2.5 py-1 text-xs font-semibold text-amber-950 transition-colors hover:bg-amber-50"
      >
        Add to list?
      </button>
    );
  }

  return (
    <form onSubmit={approve} className="mt-2 space-y-2 rounded-lg bg-white p-2.5 ring-1 ring-amber-200">
      <p className="text-xs font-semibold text-neutral-800">Approve adding {suggested.name}?</p>
      <p className="text-xs text-neutral-600">Nothing is added until you approve. You can set a lower max price than the offer.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs">
          <span className="font-medium">Max price ($)</span>
          <input
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1 text-sm tabular-nums outline-none focus:border-emerald-600"
          />
        </label>
        <label className="block text-xs">
          <span className="font-medium">Quantity</span>
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="numeric"
            className="mt-1 w-full rounded-lg border border-black/10 px-2 py-1 text-sm tabular-nums outline-none focus:border-emerald-600"
          />
        </label>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Approve and save"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
