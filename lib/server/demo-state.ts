// SERVER-ONLY. Authoritative shopping list and purchase ledger per financial scope (budget cookie / header).

import type { LedgerEntry } from "../types";
import type { SignedShoppingList } from "../shopping/list";
import type { PaymentOrder } from "../payments/types";
import { LedgerSchema, verifyLedger } from "./ledger";
import { authorizePurchase, verifyShoppingList } from "./shopping-list";
import { kvDel, kvGet, kvSet, withScopeLock } from "./kv";

export class PurchaseBlockedError extends Error {
  readonly name = "PurchaseBlockedError";
  constructor(message: string) {
    super(message);
  }
}

export type LedgerPending = {
  orderId: string;
  itemName: string;
  paidCents: number;
  timestamp: number;
};

export type DemoState = {
  version: number;
  ledger: LedgerEntry[];
  list: SignedShoppingList | null;
  ledgerIntegrity: "ok" | "invalid";
  ledgerInvalidReason?: string;
  pending: LedgerPending[];
};

const TTL_SEC = 90 * 24 * 60 * 60;

const EMPTY: DemoState = {
  version: 0,
  ledger: [],
  list: null,
  ledgerIntegrity: "ok",
  pending: [],
};

function storageKey(scopeId: string): string {
  return `melit:demo:${scopeId}`;
}

function pendingAsGuardRows(pending: readonly LedgerPending[]) {
  return pending.map((p) => ({
    paidCents: p.paidCents,
    timestamp: p.timestamp,
    itemName: p.itemName,
  }));
}

/** Ledger + in-flight reservations for Spend Guard (quantity and weekly cap). */
export function effectiveLedgerForGuard(state: DemoState): LedgerEntry[] {
  const pending = pendingAsGuardRows(state.pending);
  return [...state.ledger, ...(pending as unknown as LedgerEntry[])];
}

function parseStored(raw: string | null): DemoState {
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    const ledgerRaw = parsed.ledger ?? [];
    const ledgerCheck = verifyLedger(ledgerRaw);
    const listRaw = parsed.list;
    let list: SignedShoppingList | null = null;
    if (listRaw) {
      const listCheck = verifyShoppingList(listRaw);
      if (listCheck.ok) list = { items: listCheck.items, sig: (listRaw as SignedShoppingList).sig };
    }
    const pending = Array.isArray(parsed.pending)
      ? parsed.pending
          .filter(
            (p): p is LedgerPending =>
              Boolean(p && typeof p === "object" && typeof (p as LedgerPending).orderId === "string"),
          )
          .slice(0, 20)
      : [];

    if (!ledgerCheck.ok) {
      const shape = LedgerSchema.safeParse(ledgerRaw);
      return {
        version: typeof parsed.version === "number" ? parsed.version : 0,
        ledger: shape.success ? shape.data : Array.isArray(ledgerRaw) ? (ledgerRaw as LedgerEntry[]) : [],
        list,
        ledgerIntegrity: "invalid",
        ledgerInvalidReason: ledgerCheck.reason,
        pending,
      };
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : 0,
      ledger: ledgerCheck.entries,
      list,
      ledgerIntegrity: "ok",
      pending,
    };
  } catch {
    return { ...EMPTY, ledgerIntegrity: "invalid", ledgerInvalidReason: "Stored financial state is unreadable, so spending is frozen until you reset the demo." };
  }
}

async function readState(scopeId: string): Promise<DemoState> {
  if (!scopeId) return { ...EMPTY };
  return parseStored(await kvGet(storageKey(scopeId)));
}

async function writeState(scopeId: string, state: DemoState): Promise<void> {
  if (!scopeId) return;
  const payload: DemoState = {
    ...state,
    version: state.version + 1,
    pending: state.pending ?? [],
  };
  if (payload.ledgerIntegrity === "ok") {
    LedgerSchema.parse(payload.ledger);
    const check = verifyLedger(payload.ledger);
    if (!check.ok) throw new Error("refusing to persist ledger that failed verification");
  }
  await kvSet(storageKey(scopeId), JSON.stringify(payload), TTL_SEC);
}

export async function loadDemoState(scopeId: string): Promise<DemoState> {
  return readState(scopeId);
}

export async function saveDemoState(scopeId: string, state: DemoState): Promise<void> {
  await writeState(scopeId, state);
}

export async function setSignedList(scopeId: string, list: SignedShoppingList): Promise<void> {
  const state = await readState(scopeId);
  state.list = list;
  const listCheck = verifyShoppingList(list);
  if (!listCheck.ok) throw new Error(listCheck.reason);
  await writeState(scopeId, state);
}

/** @deprecated Prefer finalizePendingPurchase via purchase hooks. */
export async function appendLedgerEntry(scopeId: string, entry: LedgerEntry): Promise<void> {
  await withScopeLock(scopeId, async () => {
    const state = await readState(scopeId);
    if (state.ledgerIntegrity !== "ok") {
      throw new PurchaseBlockedError(state.ledgerInvalidReason ?? "Ledger is locked.");
    }
    state.ledger = [...state.ledger, entry];
    await writeState(scopeId, state);
  });
}

export async function resetLedger(scopeId: string): Promise<void> {
  const state = await readState(scopeId);
  state.ledger = [];
  state.ledgerIntegrity = "ok";
  state.ledgerInvalidReason = undefined;
  state.pending = [];
  await writeState(scopeId, state);
}

export async function wipeDemoSession(scopeId: string): Promise<void> {
  if (!scopeId) return;
  await kvDel(storageKey(scopeId));
}

export async function reservePendingPurchase(scopeId: string, order: PaymentOrder, rawList: unknown): Promise<void> {
  await withScopeLock(scopeId, async () => {
    const state = await readState(scopeId);
    if (state.ledgerIntegrity !== "ok") {
      throw new PurchaseBlockedError(state.ledgerInvalidReason ?? "Ledger is locked.");
    }
    const list = state.list ?? rawList;
    const guard = authorizePurchaseGuard(state, list, order.itemName, order.priceCents);
    if (!guard.allowed) throw new PurchaseBlockedError(guard.reason);
    if (state.pending.some((p) => p.orderId === order.orderId)) return;
    state.pending = [
      ...state.pending,
      { orderId: order.orderId, itemName: order.itemName, paidCents: order.priceCents, timestamp: Date.now() },
    ];
    await writeState(scopeId, state);
  });
}

export async function finalizePendingPurchase(scopeId: string, orderId: string, entry: LedgerEntry): Promise<void> {
  await withScopeLock(scopeId, async () => {
    const state = await readState(scopeId);
    if (state.ledgerIntegrity !== "ok") {
      throw new PurchaseBlockedError(state.ledgerInvalidReason ?? "Ledger is locked.");
    }
    if (!state.pending.some((p) => p.orderId === orderId)) {
      const guardList = state.list;
      const guard = authorizePurchaseGuard(state, guardList, entry.itemName, entry.paidCents);
      if (!guard.allowed) throw new PurchaseBlockedError(guard.reason);
    }
    state.pending = state.pending.filter((p) => p.orderId !== orderId);
    state.ledger = [...state.ledger, entry];
    await writeState(scopeId, state);
  });
}

export async function releasePendingPurchase(scopeId: string, orderId: string): Promise<void> {
  await withScopeLock(scopeId, async () => {
    const state = await readState(scopeId);
    state.pending = state.pending.filter((p) => p.orderId !== orderId);
    await writeState(scopeId, state);
  });
}

function authorizePurchaseGuard(state: DemoState, rawList: unknown, itemName: string, attemptedCents: number) {
  return authorizePurchase(effectiveLedgerForGuard(state), rawList, itemName, attemptedCents, Date.now());
}