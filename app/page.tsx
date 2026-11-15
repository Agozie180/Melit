"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { FeedEvent, ShoppingRequest } from "@/lib/types";
import { spentInWindow } from "@/lib/guard/spend-guard";
import { WEEKLY_CAP_CENTS } from "@/lib/money";
import { clockStore, fetchAgentInfo, ledgerStore, streamEvents, type AgentInfo } from "@/lib/client/api";
import { AgentCard } from "./components/AgentCard";
import { BudgetGauge } from "./components/BudgetGauge";
import { VaultCard } from "./components/VaultCard";
import { RequestForm } from "./components/RequestForm";
import { NegotiationFeed, type FeedRun } from "./components/NegotiationFeed";
import { LedgerTable } from "./components/LedgerTable";

export default function Dashboard() {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const ledger = useSyncExternalStore(ledgerStore.subscribe, ledgerStore.getSnapshot, ledgerStore.getServerSnapshot);
  const [runs, setRuns] = useState<FeedRun[]>([]);
  const [busy, setBusy] = useState(false);
  const now = useSyncExternalStore(clockStore.subscribe, clockStore.getSnapshot, clockStore.getServerSnapshot);

  useEffect(() => {
    fetchAgentInfo().then(setInfo, (e: Error) => setInfoError(e.message));
  }, []);

  const capCents = info?.capCents ?? WEEKLY_CAP_CENTS;
  const spentCents = spentInWindow(ledger, now);
  const savedCents = ledger.reduce((sum, e) => sum + Math.max(0, e.savedCents), 0);

  const run = useCallback(
    async (kind: FeedRun["kind"], url: string, body: Record<string, unknown>) => {
      if (busy) return;
      setBusy(true);
      const id = crypto.randomUUID();
      setRuns((prev) => [{ id, kind, events: [], running: true }, ...prev]);
      const push = (e: FeedEvent) => {
        if (e.type === "purchased") {
          ledgerStore.append(e.entry);
        }
        if (e.type === "done") return;
        setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, events: [...r.events, e] } : r)));
      };
      try {
        await streamEvents(url, { ...body, ledger: ledgerStore.getSnapshot() }, push);
      } catch (err) {
        push({ type: "error", message: `${(err as Error).message}. Nothing was bought.` });
      } finally {
        setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, running: false } : r)));
        setBusy(false);
      }
    },
    [busy],
  );

  const shop = (request: ShoppingRequest) => run("shop", "/api/negotiate", { request });
  const overspend = () => run("overspend", "/api/overspend", {});
  const reset = () => {
    ledgerStore.clear();
    setRuns([]);
  };

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Melit<span className="text-emerald-600">.</span>
          </h1>
          <p className="mt-1 max-w-md text-sm text-neutral-600">
            A shopping agent with a budget, a negotiator&apos;s brain and a savings vault. It haggles before it buys and can never spend more
            than $300 in any 7 days.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Kite track demo · mock sellers · simulated identity and payments · decisions by SERV Reasoning
          </p>
        </div>
        <AgentCard info={info} />
      </header>

      {infoError && (
        <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">Couldn&apos;t reach the Melit server: {infoError}</p>
      )}
      {info && !info.reasoning.configured && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          OPENSERV_API_KEY isn&apos;t set on the server, so every round will use the fallback heuristic and be labelled as such.
        </p>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <BudgetGauge spentCents={spentCents} capCents={capCents} />
          <VaultCard savedCents={savedCents} purchases={ledger.length} />
          <RequestForm catalog={info?.catalog ?? []} busy={busy} onSubmit={shop} />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={overspend}
              disabled={busy}
              className="rounded-xl border border-red-300 bg-white px-3 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              Try to overspend
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-50"
            >
              Reset demo
            </button>
          </div>
        </div>
        <div className="space-y-4">
          <NegotiationFeed runs={runs} />
          <LedgerTable ledger={ledger} />
        </div>
      </div>

      <footer className="mt-8 text-center text-xs text-neutral-500">
        Melit keeps 15% of what it saves you; you keep 85%. Sellers, identity and payments in this demo are simulated. No real money moves.
      </footer>
    </main>
  );
}
