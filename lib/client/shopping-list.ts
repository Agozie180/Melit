import type { DeclinedOffer } from "../types";
import { melitFetch } from "./budget";
import type { ShoppingListItem, SignedShoppingList } from "../shopping/list";

const LIST_KEY = "melit.list.v1";
const DECLINED_KEY = "melit.declined.v1";
const EMPTY: DeclinedOffer[] = [];

const listListeners = new Set<() => void>();
let listCache: { raw: string | null; parsed: SignedShoppingList | null } | undefined;

function readList(raw: string | null): SignedShoppingList | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SignedShoppingList>;
    if (!value || !Array.isArray(value.items) || typeof value.sig !== "string") return null;
    return { items: value.items, sig: value.sig };
  } catch {
    return null;
  }
}

/** The signed allowlist, shaped for useSyncExternalStore. Edits are not sent until the server re-signs them. */
export const listStore = {
  subscribe(listener: () => void) {
    listListeners.add(listener);
    const onStorage = (e: StorageEvent) => e.key === LIST_KEY && listener();
    window.addEventListener("storage", onStorage);
    return () => {
      listListeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): SignedShoppingList | null {
    const raw = localStorage.getItem(LIST_KEY);
    if (listCache && listCache.raw === raw) return listCache.parsed;
    const parsed = readList(raw);
    listCache = { raw, parsed };
    return parsed;
  },
  getServerSnapshot(): SignedShoppingList | null {
    return null;
  },
  replace(list: SignedShoppingList | null) {
    if (list) localStorage.setItem(LIST_KEY, JSON.stringify(list));
    else localStorage.removeItem(LIST_KEY);
    listCache = undefined;
    listListeners.forEach((listener) => listener());
  },
};

const declinedListeners = new Set<() => void>();
let declinedCache: { raw: string | null; parsed: DeclinedOffer[] } | undefined;

/** Off-list offers Melit already refused. Newest first, capped so the feed stays readable. */
export const declinedStore = {
  subscribe(listener: () => void) {
    declinedListeners.add(listener);
    const onStorage = (e: StorageEvent) => e.key === DECLINED_KEY && listener();
    window.addEventListener("storage", onStorage);
    return () => {
      declinedListeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): DeclinedOffer[] {
    const raw = localStorage.getItem(DECLINED_KEY);
    if (declinedCache && declinedCache.raw === raw) return declinedCache.parsed;
    let parsed = EMPTY;
    try {
      const value = raw ? JSON.parse(raw) : [];
      parsed = Array.isArray(value) ? value : EMPTY;
    } catch {
      parsed = EMPTY;
    }
    declinedCache = { raw, parsed };
    return parsed;
  },
  getServerSnapshot(): DeclinedOffer[] {
    return EMPTY;
  },
  add(offer: DeclinedOffer) {
    const next = [offer, ...declinedStore.getSnapshot().filter((row) => row.id !== offer.id)].slice(0, 40);
    localStorage.setItem(DECLINED_KEY, JSON.stringify(next));
    declinedListeners.forEach((listener) => listener());
  },
  clear() {
    localStorage.removeItem(DECLINED_KEY);
    declinedListeners.forEach((listener) => listener());
  },
};

export async function saveShoppingList(items: ShoppingListItem[]): Promise<SignedShoppingList> {
  const res = await melitFetch("/api/shopping-list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  const data = (await res.json().catch(() => null)) as (SignedShoppingList & { error?: string }) | null;
  if (!res.ok || !data?.sig || !Array.isArray(data.items)) {
    throw new Error(data?.error ?? `Couldn't save the shopping list (HTTP ${res.status}).`);
  }
  const signed = { items: data.items, sig: data.sig };
  listStore.replace(signed);
  return signed;
}
