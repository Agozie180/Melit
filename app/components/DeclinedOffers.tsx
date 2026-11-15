"use client";

import type { DeclinedOffer } from "@/lib/types";
import { formatUsd } from "@/lib/money";
import { findListItem, type ShoppingListItem, type SignedShoppingList } from "@/lib/shopping/list";
import { ApproveAdd } from "./ApproveAdd";
import { Badge, Card, CardTitle } from "./ui";

const KIND: Record<DeclinedOffer["kind"], string> = {
  bundle: "Bundle",
  flash: "Flash deal",
  request: "Your request",
};

export function DeclinedOffers({
  offers,
  signed,
  onApprove,
  onClear,
}: {
  offers: DeclinedOffer[];
  signed: SignedShoppingList | null;
  onApprove: (item: ShoppingListItem) => Promise<void>;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardTitle
        aside={
          offers.length > 0 ? (
            <button type="button" onClick={onClear} className="text-xs font-medium text-neutral-500 hover:text-neutral-800">
              Clear
            </button>
          ) : null
        }
      >
        Declined offers
      </CardTitle>
      {offers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-black/10 p-4 text-sm text-neutral-500">
          Sellers sometimes push bundles and flash deals. If one is not on your list, Melit declines it here and does not pay.
        </p>
      ) : (
        <ul className="space-y-3" aria-live="polite">
          {offers.map((offer) => {
            const onList = Boolean(signed && findListItem(signed.items, offer.itemName));
            return (
              <li key={offer.id} className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="amber">{KIND[offer.kind]}</Badge>
                  <span className="font-semibold">{offer.itemName}</span>
                  <span className="text-neutral-600">{formatUsd(offer.priceCents)}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">{offer.sellerName}</p>
                <p className="mt-2 text-neutral-800">{offer.pitch}</p>
                <p className="mt-2 font-medium text-amber-950">{offer.log}</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-neutral-700">
                  {offer.reasoning.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <div className="mt-2">
                  {onList ? (
                    <Badge tone="green">On your list</Badge>
                  ) : (
                    <ApproveAdd suggested={offer.suggested} onApprove={onApprove} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
