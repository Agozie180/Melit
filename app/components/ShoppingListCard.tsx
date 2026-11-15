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
  const savedRows = toDraft(signed?.items ?? []);
  const [rows, setRows] = useState<DraftRow[]>(savedRows);
  const [addFormKey, setAddFormKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty = !sameDraft(rows, savedRows);
  const known = new Set(catalog.map((item) => normalizeItemName(item.name)));

  function readAddFields(form: HTMLFormElement) {
    const itemName = (form.querySelector<HTMLInputElement>('[name="listItemName"]')?.value ?? "").trim();
    const maxRaw = form.querySelector<HTMLInputElement>('[name="listMaxPrice"]')?.value ?? "";
    const qtyRaw = form.querySelector<HTMLInputElement>('[name="listQuantity"]')?.value ?? "1";
    return { itemName, maxRaw, qtyRaw };
  }

  function appendFromForm(form: HTMLFormElement) {
    const { itemName, maxRaw, qtyRaw } = readAddFields(form);
    const max = Number(maxRaw);
    const qty = Number(qtyRaw);
    if (!itemName) return setError("Name the item the way the seller lists it.");
    if (!Number.isFinite(max) || max <= 0) return setError("Set a max price above $0.");
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return setError("Quantity must be a whole number from 1 to 99.");
    if (rows.length >= 30) return setError("The list holds 30 items.");
    setError(null);
    setRows((prev) => [...prev, { name: itemName, maxPrice: String(max), quantity: String(qty) }]);
    setAddFormKey((k) => k + 1);
  }

  function addRow(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    appendFromForm(e.currentTarget);
  }

  function draftFromFormEl(form?: HTMLFormElement | null): DraftRow | null {
    if (!form) return null;
    const { itemName, maxRaw, qtyRaw } = readAddFields(form);
    const max = Number(maxRaw);
    const qty = Number(qtyRaw);
    if (!itemName || !Number.isFinite(max) || max <= 0) return null;
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    const key = normalizeItemName(itemName);
    if (rows.some((r) => normalizeItemName(r.name) === key)) return null;
    return { name: itemName, maxPrice: String(max), quantity: String(qty) };
  }

  function draftFromForm(): DraftRow | null {
    if (typeof document === "undefined") return null;
    const form = document.querySelector<HTMLFormElement>('[data-testid="shopping-list-card"] form');
    return draftFromFormEl(form);
  }

  async function save() {
    const extra = draftFromForm();
    const workRows = extra ? [...rows, extra] : rows;
    if (extra) {
      setRows(workRows);
      setAddFormKey((k) => k + 1);
    }
    const items: ShoppingListItem[] = [];
    for (const row of workRows) {
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
    <Card data-testid="shopping-list-card">
      <CardTitle aside={<Badge tone={signed ? "green" : "amber"} data-testid="shopping-list-badge">{signed ? "signed" : "not saved"}</Badge>}>Shopping list</CardTitle>
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

      <form key={addFormKey} onSubmit={addRow} className="mt-3 space-y-2">
        <label className="block">
          <span className="text-xs font-medium">Item</span>
          <input
            name="listItemName"
            defaultValue=""
            list="melit-list-catalog"
            aria-label="Shopping list item name"
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
              name="listMaxPrice"
              defaultValue=""
              inputMode="decimal"
              aria-label="Shopping list max price in dollars"
              placeholder="120"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Quantity</span>
            <input
              name="listQuantity"
              defaultValue="1"
              inputMode="numeric"
              aria-label="Shopping list quantity"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm tabular-nums outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={(e) => {
            const form = e.currentTarget.closest("form");
            if (form) appendFromForm(form);
          }}
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50"
        >
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
        disabled={saving || (!dirty && !draftFromForm())}
        className="mt-3 w-full rounded-xl bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? "Saving…" : draftFromForm() && !dirty ? "Add item and save list" : "Save list"}
      </button>
      <p className="mt-2 text-xs text-neutral-500">Reset demo clears the ledger, which also restores quantities. It does not change this list.</p>
    </Card>
  );
}
