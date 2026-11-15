import type { FeedEvent, NegotiationRound } from "@/lib/types";
import { formatUsd } from "@/lib/money";
import { Badge, Card, CardTitle } from "./ui";
import { AttemptTrail, ReceiptDetails } from "./Receipt";

export interface FeedRun {
  id: string;
  kind: "shop" | "overspend";
  events: FeedEvent[];
  running: boolean;
}

const PERSONALITY: Record<string, string> = {
  firm: "Firm seller",
  flexible: "Flexible seller",
  bluffer: "Bluffs about prices",
  bundler: "Likes bundles",
};

function RoundView({ round }: { round: NegotiationRound }) {
  const d = round.decision;
  const actionLabel =
    d.action === "offer" ? `Offers ${formatUsd(d.offerPriceCents)}` : d.action === "accept" ? `Accepts ${formatUsd(d.offerPriceCents)}` : "Walks away";
  return (
    <li className="feed-in rounded-xl border border-black/[0.06] bg-neutral-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs text-neutral-500">R{round.round}</span>
        <span className="text-neutral-500">Ask {formatUsd(round.askBeforeCents)}</span>
        <span aria-hidden>→</span>
        <span className="font-semibold">Melit {actionLabel.toLowerCase()}</span>
        <span className="ml-auto flex gap-1.5">
          {d.source === "serv" ? <Badge tone="violet">SERV Reasoning</Badge> : <Badge tone="amber">Fallback heuristic</Badge>}
          <Badge>{Math.round(d.confidence * 100)}% sure</Badge>
        </span>
      </div>

      <details className="group mt-2">
        <summary className="cursor-pointer select-none text-xs font-medium text-emerald-800 hover:underline">
          <span className="group-open:hidden">Show reasoning trail</span>
          <span className="hidden group-open:inline">Hide reasoning trail</span>
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          {d.reasoning.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {d.guardrails.length > 0 && (
          <div className="mt-2 rounded-lg bg-white p-2 text-xs text-neutral-600 ring-1 ring-black/5">
            <p className="font-semibold text-neutral-700">Code guardrails applied</p>
            <ul className="list-disc pl-4">
              {d.guardrails.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-2 text-xs text-neutral-500">
          {d.source === "serv" ? `Decided by SERV Reasoning (${d.model ?? "model"}), validated with zod.` : `Fallback because: ${d.fallbackReason ?? "unknown"}`}
        </p>
      </details>

      {round.seller && (
        <div className="mt-2 flex items-start gap-2 text-sm">
          <span className="mt-0.5 shrink-0 text-xs font-semibold uppercase text-neutral-500">Seller</span>
          <p className="rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 ring-1 ring-black/5">“{round.seller.message}”</p>
        </div>
      )}
    </li>
  );
}

function RunView({ run }: { run: FeedRun }) {
  const start = run.events.find((e) => e.type === "start");
  return (
    <article className="space-y-2 border-b border-black/[0.06] pb-4 last:border-0 last:pb-0">
      {start?.type === "start" && (
        <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="font-semibold">{run.kind === "overspend" ? `Overspend attempt: ${start.item.name}` : start.item.name}</h3>
          <span className="text-sm text-neutral-500">
            {start.item.sellerName} · {PERSONALITY[start.item.personality]}
          </span>
          <span className="w-full text-xs text-neutral-500">
            List {formatUsd(start.item.listPriceCents)} · market ref {formatUsd(start.item.marketReferenceCents)} · your max{" "}
            {formatUsd(start.request.maxPriceCents)} · {formatUsd(start.remainingCents)} left this week
          </span>
        </header>
      )}
      <ul className="space-y-2">
        {run.events.map((e, i) => {
          switch (e.type) {
            case "round":
              return <RoundView key={i} round={e.round} />;
            case "deal":
              return (
                <li key={i} className="feed-in text-sm font-medium text-emerald-800">
                  ✓ {e.message}
                </li>
              );
            case "no-deal":
              return (
                <li key={i} className="feed-in rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
                  {e.message}
                </li>
              );
            case "blocked":
              return (
                <li key={i} className="feed-in rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                  <p className="font-semibold">Spend Guard blocked a {formatUsd(e.priceCents)} payment</p>
                  <p className="mt-1">{e.guard.reason}</p>
                  <p className="mt-1 text-xs text-red-700/80">No payment was attempted. The guard runs on the server before every payment.</p>
                </li>
              );
            case "purchased":
              return (
                <li key={i} className="feed-in rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <p className="font-semibold text-emerald-900">
                    Bought for {formatUsd(e.entry.paidCents)}, saved {formatUsd(e.entry.savedCents)} → vault
                  </p>
                  <ReceiptDetails receipt={e.receipt} />
                </li>
              );
            case "payment-failed":
              return (
                <li key={i} className="feed-in rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="alert">
                  <p className="font-semibold">Payment of {formatUsd(e.priceCents)} didn&apos;t go through. Nothing was bought.</p>
                  <AttemptTrail attempts={e.attempts} />
                  {e.attempts.length === 0 && <p className="mt-1 text-xs">{e.message}</p>}
                </li>
              );
            case "error":
              return (
                <li key={i} className="feed-in rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
                  {e.message}
                </li>
              );
            default:
              return null;
          }
        })}
        {run.running && (
          <li className="flex items-center gap-2 text-sm text-neutral-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" /> Melit is thinking with SERV Reasoning…
          </li>
        )}
      </ul>
    </article>
  );
}

export function NegotiationFeed({ runs }: { runs: FeedRun[] }) {
  return (
    <Card>
      <CardTitle>Live negotiation feed</CardTitle>
      {runs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/10 p-6 text-center text-sm text-neutral-500">
          No negotiations yet. Pick an item from the mock market and press <span className="font-medium">Negotiate and buy</span>. Every
          round will show the seller&apos;s message, Melit&apos;s move and its reasoning.
        </div>
      ) : (
        <div className="space-y-4">
          {runs.map((run) => (
            <RunView key={run.id} run={run} />
          ))}
        </div>
      )}
    </Card>
  );
}
