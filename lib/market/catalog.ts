// SERVER-ONLY. This module holds hidden floor prices. Never import it from a client
// component, and never pass a raw CatalogItem to the client or the reasoning model:
// always go through toPublicItem().

import type { PublicItem, SellerPersonality } from "../types";

export interface Seller {
  id: string;
  name: string;
  personality: SellerPersonality;
  tagline: string;
}

export interface CatalogItem {
  id: string;
  sellerId: string;
  name: string;
  listPriceCents: number;
  marketReferenceCents: number;
  /** Hidden lowest price the seller will accept. */
  floorPriceCents: number;
  tags: string[];
}

export const SELLERS: Seller[] = [
  { id: "granite", name: "Granite & Co. (mock)", personality: "firm", tagline: "Quality costs what it costs." },
  { id: "breezy", name: "Breezy Bazaar (mock)", personality: "flexible", tagline: "Let's make a deal, friend." },
  { id: "larry", name: "Last-Price Larry's (mock)", personality: "bluffer", tagline: "Every price is my last price." },
  { id: "bundle", name: "Bundle Barn (mock)", personality: "bundler", tagline: "Two is better than one." },
];

export const CATALOG: CatalogItem[] = [
  { id: "knife", sellerId: "granite", name: "Pro Chef's Knife", listPriceCents: 8900, marketReferenceCents: 7900, floorPriceCents: 7200, tags: ["knife", "kitchen", "chef", "cooking"] },
  { id: "skillet", sellerId: "granite", name: "Cast Iron Skillet", listPriceCents: 5900, marketReferenceCents: 5200, floorPriceCents: 4700, tags: ["skillet", "pan", "kitchen", "cooking", "cast", "iron"] },
  { id: "espresso", sellerId: "granite", name: "Espresso Machine Pro", listPriceCents: 34900, marketReferenceCents: 32000, floorPriceCents: 30500, tags: ["espresso", "coffee", "machine", "kitchen"] },

  { id: "earbuds", sellerId: "breezy", name: "Wireless Earbuds", listPriceCents: 12900, marketReferenceCents: 11000, floorPriceCents: 8400, tags: ["earbuds", "headphones", "audio", "wireless", "music"] },
  { id: "speaker", sellerId: "breezy", name: "Bluetooth Speaker", listPriceCents: 7900, marketReferenceCents: 6500, floorPriceCents: 4900, tags: ["speaker", "bluetooth", "audio", "music"] },
  { id: "powerbank", sellerId: "breezy", name: "Phone Power Bank", listPriceCents: 4500, marketReferenceCents: 3800, floorPriceCents: 2900, tags: ["power", "bank", "charger", "battery", "phone"] },

  { id: "shoes", sellerId: "larry", name: "Running Shoes", listPriceCents: 14000, marketReferenceCents: 11800, floorPriceCents: 9600, tags: ["shoes", "running", "sneakers", "sport", "fitness"] },
  { id: "jacket", sellerId: "larry", name: "Rain Jacket", listPriceCents: 11000, marketReferenceCents: 9200, floorPriceCents: 7400, tags: ["jacket", "rain", "coat", "outdoor", "clothing"] },

  { id: "lamp", sellerId: "bundle", name: "LED Desk Lamp", listPriceCents: 4900, marketReferenceCents: 4200, floorPriceCents: 3400, tags: ["lamp", "desk", "light", "office"] },
  { id: "chair", sellerId: "bundle", name: "Ergonomic Office Chair", listPriceCents: 22900, marketReferenceCents: 19900, floorPriceCents: 17000, tags: ["chair", "office", "desk", "ergonomic"] },
  { id: "keyboard", sellerId: "bundle", name: "Mechanical Keyboard", listPriceCents: 11900, marketReferenceCents: 9900, floorPriceCents: 8200, tags: ["keyboard", "mechanical", "office", "computer", "typing"] },
];

export function getSeller(id: string): Seller {
  const seller = SELLERS.find((s) => s.id === id);
  if (!seller) throw new Error(`Unknown seller ${id}`);
  return seller;
}

export function getCatalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export function toPublicItem(item: CatalogItem): PublicItem {
  const seller = getSeller(item.sellerId);
  return {
    id: item.id,
    name: item.name,
    sellerId: seller.id,
    sellerName: seller.name,
    personality: seller.personality,
    listPriceCents: item.listPriceCents,
    marketReferenceCents: item.marketReferenceCents,
    tags: item.tags,
  };
}

export function publicCatalog(): PublicItem[] {
  return CATALOG.map(toPublicItem);
}

/** Simple keyword match. Ties go to the cheaper listing. */
export function findItem(query: string): CatalogItem | undefined {
  const byId = getCatalogItem(query.trim().toLowerCase());
  if (byId) return byId;
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best: { item: CatalogItem; score: number } | undefined;
  for (const item of CATALOG) {
    const haystack = [...item.tags, ...item.name.toLowerCase().split(/\s+/)];
    const score = words.reduce(
      (acc, w) => acc + (haystack.some((h) => h === w || h.startsWith(w) || w.startsWith(h)) ? 1 : 0),
      0,
    );
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && item.listPriceCents < best.item.listPriceCents)) {
      best = { item, score };
    }
  }
  return best?.item;
}
