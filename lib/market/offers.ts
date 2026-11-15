// SERVER-ONLY. Tempting offers the mock sellers push on top of the item Melit asked about.
// Prices are discounts off the public list price. The hidden floor is never used here.

import { formatUsd } from "../money";
import { CATALOG, getSeller, type CatalogItem } from "./catalog";

export interface SellerPush {
  id: string;
  kind: "bundle" | "flash";
  itemName: string;
  sellerId: string;
  sellerName: string;
  priceCents: number;
  pitch: string;
}

function roundDollars(cents: number): number {
  return Math.max(100, Math.round(cents / 100) * 100);
}

/**
 * At most one extra offer. Bundle Barn always bundles a sibling. The bluffer and the
 * flexible seller always attach a flash deal. The firm seller only upsells when you are
 * already buying the knife, so most of that shop is quiet.
 */
export function sellerPushes(item: CatalogItem): SellerPush[] {
  const seller = getSeller(item.sellerId);
  const extra = CATALOG.find((candidate) => candidate.sellerId === item.sellerId && candidate.id !== item.id);
  if (!extra) return [];

  if (seller.personality === "firm") {
    if (item.id !== "knife") return [];
    const priceCents = roundDollars(extra.listPriceCents * 0.85);
    return [
      {
        id: `bundle:${item.id}:${extra.id}`,
        kind: "bundle",
        itemName: extra.name,
        sellerId: seller.id,
        sellerName: seller.name,
        priceCents,
        pitch: `Add the ${extra.name} for ${formatUsd(priceCents)}. I don't discount twice.`,
      },
    ];
  }

  if (seller.personality === "bundler") {
    const priceCents = roundDollars(extra.listPriceCents * 0.55);
    return [
      {
        id: `bundle:${item.id}:${extra.id}`,
        kind: "bundle",
        itemName: extra.name,
        sellerId: seller.id,
        sellerName: seller.name,
        priceCents,
        pitch: `Bundle the ${extra.name} in for ${formatUsd(priceCents)}, usually ${formatUsd(extra.listPriceCents)}. Two is better than one.`,
      },
    ];
  }

  const priceCents = roundDollars(extra.listPriceCents * 0.6);
  const bluff = seller.personality === "bluffer";
  return [
    {
      id: `flash:${item.id}:${extra.id}`,
      kind: "flash",
      itemName: extra.name,
      sellerId: seller.id,
      sellerName: seller.name,
      priceCents,
      pitch: bluff
        ? `Flash deal, and this is my last price: the ${extra.name} for ${formatUsd(priceCents)}. Absolutely final.`
        : `Today only: the ${extra.name} for ${formatUsd(priceCents)}, usually ${formatUsd(extra.listPriceCents)}.`,
    },
  ];
}
