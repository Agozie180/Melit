"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FeedEvent, ShoppingRequest } from "@/lib/types";
import { spentInWindow } from "@/lib/guard/spend-guard";
import { WEEKLY_CAP_CENTS } from "@/lib/money";
import { clockStore, fetchAgentInfo, ledgerStore, resetDemoLedger, streamEvents, syncFinancialState, type AgentInfo } from "@/lib/client/api";
import { AgentCard } from "./components/AgentCard";
import { BudgetGauge } from "./components/BudgetGauge";
import { VaultCard } from "./components/VaultCard";
import { RequestForm } from "./components/RequestForm";
import { NegotiationFeed, type FeedRun } from "./components/NegotiationFeed";
import { ShoppingListCard } from "./components/ShoppingListCard";
import { DeclinedOffers } from "./components/DeclinedOffers";
import { LedgerTable } from "./components/LedgerTable";
import { StrategyCard } from "./components/StrategyCard";
import { ReputationCard } from "./components/ReputationCard";
import { DealFeedback } from "./components/DealFeedback";
import { ReppoTrackCard } from "./components/ReppoTrackCard";
import { MetricsCard } from "./components/MetricsCard";
import { LearningLog } from "./components/LearningLog";
import {
  dealsStore,
  learningLogStore,
  profileStore,
  recordDeal,
  recordSellerReview,
  reppoJobsStore,
  resetLearning,
  reviewsStore,
  sendOwnerFeedback,
} from "@/lib/client/learning";
import { useReppoQueue } from "@/lib/client/useReppoQueue";
import { declinedStore, listStore, saveShoppingList } from "@/lib/client/shopping-list";
import { normalizeItemName, type ShoppingListItem } from "@/lib/shopping/list";
import type { SellerReview } from "@/lib/learning/types";

export default function Dashboard() {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const ledger = useSyncExternalStore(ledgerStore.subscribe, ledgerStore.getSnapshot, ledgerStore.getServerSnapshot);
  const shoppingList = useSyncExternalStore(listStore.subscribe, listStore.getSnapshot, listStore.getServerSnapshot);
  const declined = useSyncExternalStore(declinedStore.subscribe, declinedStore.getSnapshot, declinedStore.getServerSnapshot);
  const profile = useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot, profileStore.getServerSnapshot);
  const deals = useSyncExternalStore(dealsStore.subscribe, dealsStore.getSnapshot, dealsStore.getServerSnapshot);
  const reviews = useSyncExternalStore(reviewsStore.subscribe, reviewsStore.getSnapshot, reviewsStore.getServerSnapshot);
  const learningLog = useSyncExternalStore(learningLogStore.subscribe, learningLogStore.getSnapshot, learningLogStore.getServerSnapshot);
  const reppoJobs = useSyncExternalStore(reppoJobsStore.subscribe, reppoJobsStore.getSnapshot, reppoJobsStore.getServerSnapshot);
  const reppoConfigured = Boolean(info?.reppo?.configured);
  useReppoQueue(reppoConfigured);
  const [runs, setRuns] = useState<FeedRun[]>([]);
  const [busy, setBusy] = useState(false);
  const negotiateInFlight = useRef(false);
  const now = useSyncExternalStore(clockStore.subscribe, clockStore.getSnapshot, clockStore.getServerSnapshot);

  useEffect(() => {
    fetchAgentInfo().then(setInfo, (e: Error) => setInfoError(e.message));
    syncFinancialState().catch(() => {
      /* first visit may 429; state syncs on next save or purchase */
    });
  }, []);

  const capCents = info?.capCents ?? WEEKLY_CAP_CENTS;
  const paymentsLabel = !info
    ? infoError
      ? "status unavailable"
      : "checking…"
    : info.payments.mode === "testnet"
      ? `real KiteAI testnet pieUSD (scaled $1 = ${info.payments.testnetScale} pieUSD)`
      : info.payments.mode === "recorded"
        ? "recorded testnet receipts, no new payments"
        : "simulated, no money moves";
  const sellers = Array.from(new Map((info?.catalog ?? []).map((i) => [i.sellerId, { id: i.sellerId, name: i.sellerName }])).values());
  const spentCents = spentInWindow(ledger, now);
  const savedCents = ledger.reduce((sum, e) => sum + Math.max(0, e.savedCents), 0);

  const run = useCallback(
    async (kind: FeedRun["kind"], url: string, body: Record<string, unknown>) => {
      if (negotiateInFlight.current) return;
      negotiateInFlight.current = true;
      setBusy(true);
      const id = crypto.randomUUID();
      setRuns((prev) => [{ id, kind, events: [], running: true }, ...prev]);
      let review: SellerReview | null = null;
      const push = (e: FeedEvent) => {
        if (e.type === "purchased") {
          ledgerStore.append(e.entry);
          void syncFinancialState().catch(() => undefined);
        }
        if (e.type === "declined-offer") {
          declinedStore.add(e.offer);
        }
        if (e.type === "seller-review") {
          review = e.review;
          recordSellerReview(e.review);
        }
        if (e.type === "summary") {
          recordDeal(e.summary, review);
          return;
        }
        if (e.type === "done") return;
        setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, events: [...r.events, e] } : r)));
      };
      try {
        await streamEvents(
          url,
          {
            ...body,
            ledger: ledgerStore.getSnapshot(),
            list: listStore.getSnapshot(),
            profile: profileStore.getSnapshot(),
            reviews: reviewsStore.getSnapshot(),
          },
          push,
        );
      } catch (err) {
        push({ type: "error", message: `${(err as Error).message.replace(/\.$/, "")}. Nothing was bought.` });
      } finally {
        setRuns((prev) => prev.map((r) => (r.id === id ? { ...r, running: false } : r)));
        negotiateInFlight.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const shop = (request: ShoppingRequest) => run("shop", "/api/negotiate", { request });
  const overspend = () => run("overspend", "/api/overspend", {});
  const reset = () => {
    void resetDemoLedger();
    declinedStore.clear();
    setRuns([]);
  };

  const approveAdd = useCallback(async (item: ShoppingListItem) => {
    const current = listStore.getSnapshot()?.items ?? [];
    const key = normalizeItemName(item.name);
    const next = [...current.filter((row) => normalizeItemName(row.name) !== key), item];
    await saveShoppingList(next);
  }, []);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Melit<span className="text-emerald-600">.</span>
          </h1>
          <p className="mt-1 max-w-md text-sm text-neutral-600">
            A shopping agent with a budget, a negotiator&apos;s brain and a savings vault. It haggles before it buys. The shopping list decides what it can buy, and the server holds your signed ledger and blocks any payment that would take the rolling 7-day total over $300.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Kite + Reppo tracks · Mock sellers · payments: {paymentsLabel} · decisions by SERV Reasoning ·{" "}
            {info ? (reppoConfigured ? "purchases judged by Reppo" : "Reppo judge not configured") : infoError ? "Reppo status unavailable" : "checking Reppo…"}
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
        <div className="min-w-0 space-y-4">
          <BudgetGauge spentCents={spentCents} capCents={capCents} />
          <VaultCard savedCents={savedCents} purchases={ledger.length} />
          <ShoppingListCard
            key={shoppingList?.sig ?? "unsigned"}
            signed={shoppingList}
            ledger={ledger}
            catalog={info?.catalog ?? []}
            onSave={async (items) => {
              await saveShoppingList(items);
            }}
          />
          <RequestForm
            catalog={info?.catalog ?? []}
            list={shoppingList?.items ?? []}
            ledger={ledger}
            busy={busy}
            onSubmit={shop}
            defaultPriority={profile.priority === "speed" ? "fast" : "save"}
          />
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
          <StrategyCard
            profile={profile}
            lastEvent={learningLog.at(-1) ?? null}
            onReset={resetLearning}
            disabled={busy}
          />
          <ReputationCard reviews={reviews} sellers={sellers} />
        </div>
        <div className="min-w-0 space-y-4">
          <NegotiationFeed runs={runs} signed={shoppingList} onApprove={approveAdd} />
          <DeclinedOffers offers={declined} signed={shoppingList} onApprove={approveAdd} onClear={declinedStore.clear} />
          <ReppoTrackCard jobs={reppoJobs} deals={deals} reppoConfigured={reppoConfigured} />
          <DealFeedback deals={deals} jobs={reppoJobs} log={learningLog} reppoConfigured={reppoConfigured} onFeedback={sendOwnerFeedback} />
          <MetricsCard deals={deals} jobs={reppoJobs} />
          <LearningLog log={learningLog} />
          <LedgerTable ledger={ledger} />
        </div>
      </div>

      <footer className="mt-8 text-center text-xs text-neutral-500">
        Melit keeps 15% of what it saves you; you keep 85%. Sellers are mocks. Testnet payments use free test tokens (pieUSD or faucet USDT on KiteAI
        testnet, scaled down); simulated and recorded receipts move no money and are labelled as such.
      </footer>
    </main>
  );
}
