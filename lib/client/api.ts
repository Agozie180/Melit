import type { FeedEvent, LedgerEntry, PaymentRailId, PublicItem } from "../types";
import type { AgentIdentity } from "../adapters/identity";
import { melitFetch } from "./budget";

export interface AgentInfo {
  identity: AgentIdentity;
  payments: {
    mode: "testnet" | "recorded" | "simulated";
    rails: PaymentRailId[];
    network: string;
    chainId: number;
    asset: string;
    testnetScale: number;
  };
  reasoning: { provider: string; model: string; configured: boolean };
  reppo: { configured: boolean; taskType: string };
  capCents: number;
  feeRate: number;
  catalog: PublicItem[];
}

const LEDGER_KEY = "melit.ledger.v2";
const EMPTY: LedgerEntry[] = [];
const listeners = new Set<() => void>();
let cache: { raw: string | null; parsed: LedgerEntry[] } | undefined;

/** localStorage-backed ledger, shaped for useSyncExternalStore. */
export const ledgerStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => e.key === LEDGER_KEY && listener();
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },
  getSnapshot(): LedgerEntry[] {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (cache && cache.raw === raw) return cache.parsed;
    let parsed: LedgerEntry[] = EMPTY;
    try {
      const value = raw ? JSON.parse(raw) : [];
      parsed = Array.isArray(value) ? value : EMPTY;
    } catch {
      parsed = EMPTY;
    }
    cache = { raw, parsed };
    return parsed;
  },
  getServerSnapshot(): LedgerEntry[] {
    return EMPTY;
  },
  replace(entries: LedgerEntry[]) {
    const encoded = JSON.stringify(entries);
    localStorage.setItem(LEDGER_KEY, encoded);
    cache = { raw: encoded, parsed: entries };
    listeners.forEach((l) => l());
  },
  append(entry: LedgerEntry) {
    ledgerStore.replace([...ledgerStore.getSnapshot(), entry]);
  },
  clear() {
    localStorage.removeItem(LEDGER_KEY);
    cache = { raw: null, parsed: EMPTY };
    listeners.forEach((l) => l());
  },
};

export type FinancialState = {
  ledger: LedgerEntry[];
  list: import("../shopping/list").SignedShoppingList | null;
  persistent: boolean;
  ledgerLocked?: boolean;
  ledgerInvalidReason?: string | null;
};

/** Loads the server-held ledger and signed list (authoritative for Spend Guard). */
export async function syncFinancialState(): Promise<FinancialState> {
  const res = await melitFetch("/api/state", { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load financial state (HTTP ${res.status})`);
  const data = (await res.json()) as FinancialState;
  ledgerStore.replace(Array.isArray(data.ledger) ? data.ledger : []);
  if (data.list) {
    const { listStore } = await import("./shopping-list");
    listStore.replace(data.list);
  }
  return data;
}

export async function resetDemoLedger(): Promise<void> {
  await melitFetch("/api/state", { method: "DELETE" });
  ledgerStore.clear();
}

const CLOCK_TICK_MS = 30_000;

/** Coarse clock for the rolling window. Entries newer than the tick still count (they're "future"). */
export const clockStore = {
  subscribe(listener: () => void) {
    const t = setInterval(listener, CLOCK_TICK_MS);
    return () => clearInterval(t);
  },
  getSnapshot(): number {
    return Math.floor(Date.now() / CLOCK_TICK_MS) * CLOCK_TICK_MS;
  },
  getServerSnapshot(): number {
    return 0;
  },
};

export async function fetchAgentInfo(): Promise<AgentInfo> {
  const res = await melitFetch("/api/agent", { cache: "no-store" });
  if (!res.ok) throw new Error(`Couldn't load agent info (HTTP ${res.status})`);
  return res.json();
}

/** POSTs and calls onEvent for each NDJSON line as it arrives. */
export async function streamEvents(url: string, body: unknown, onEvent: (e: FeedEvent) => void): Promise<void> {
  const res = await melitFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? `Request failed (HTTP ${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as FeedEvent);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as FeedEvent);
}
