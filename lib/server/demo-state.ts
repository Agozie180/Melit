// SERVER-ONLY. Authoritative shopping list and purchase ledger per demo session (cookie melit_sid).

import type { LedgerEntry } from "../types";
import type { SignedShoppingList } from "../shopping/list";
import { LedgerSchema, verifyLedger } from "./ledger";
import { verifyShoppingList } from "./shopping-list";
import { kvDel, kvGet, kvSet } from "./kv";

export type DemoState = {
  ledger: LedgerEntry[];
  list: SignedShoppingList | null;
};

const TTL_SEC = 90 * 24 * 60 * 60;

function storageKey(sessionId: string): string {
  return `melit:demo:${sessionId}`;
}

const EMPTY: DemoState = { ledger: [], list: null };

export async function loadDemoState(sessionId: string): Promise<DemoState> {
  if (!sessionId) return { ...EMPTY };
  const raw = await kvGet(storageKey(sessionId));
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as Partial<DemoState>;
    const ledgerCheck = verifyLedger(parsed.ledger ?? []);
    const ledger = ledgerCheck.ok ? ledgerCheck.entries : [];
    let list: SignedShoppingList | null = null;
    if (parsed.list) {
      const listCheck = verifyShoppingList(parsed.list);
      if (listCheck.ok) list = { items: listCheck.items, sig: (parsed.list as SignedShoppingList).sig };
    }
    return { ledger, list };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveDemoState(sessionId: string, state: DemoState): Promise<void> {
  if (!sessionId) return;
  const ledgerCheck = verifyLedger(state.ledger);
  const ledger = ledgerCheck.ok ? ledgerCheck.entries : [];
  let list = state.list;
  if (list) {
    const listCheck = verifyShoppingList(list);
    if (!listCheck.ok) list = null;
    else list = { items: listCheck.items, sig: list.sig };
  }
  const payload: DemoState = { ledger, list };
  LedgerSchema.parse(ledger);
  await kvSet(storageKey(sessionId), JSON.stringify(payload), TTL_SEC);
}

export async function setSignedList(sessionId: string, list: SignedShoppingList): Promise<void> {
  const state = await loadDemoState(sessionId);
  state.list = list;
  await saveDemoState(sessionId, state);
}

export async function appendLedgerEntry(sessionId: string, entry: LedgerEntry): Promise<void> {
  const state = await loadDemoState(sessionId);
  state.ledger = [...state.ledger, entry];
  await saveDemoState(sessionId, state);
}

export async function resetLedger(sessionId: string): Promise<void> {
  const state = await loadDemoState(sessionId);
  state.ledger = [];
  await saveDemoState(sessionId, state);
}

export async function wipeDemoSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  await kvDel(storageKey(sessionId));
}