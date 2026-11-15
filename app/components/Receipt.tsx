import type { PaymentRailId, PaymentReceipt, RailAttempt } from "@/lib/types";
import { RAIL_LABEL } from "@/lib/payments/types";
import { Badge } from "./ui";

const RAIL_TONE: Record<PaymentRailId, "green" | "violet" | "neutral" | "amber"> = {
  "kite-passport-sandbox": "green",
  "direct-testnet": "violet",
  recorded: "neutral",
  simulated: "amber",
};

export function RailBadge({ rail }: { rail: PaymentRailId }) {
  return <Badge tone={RAIL_TONE[rail]}>{RAIL_LABEL[rail]}</Badge>;
}

export function TxLink({ txHash, explorerUrl }: { txHash: string | null; explorerUrl: string | null }) {
  if (!txHash) return null;
  const short = `${txHash.slice(0, 10)}…${txHash.slice(-6)}`;
  return explorerUrl ? (
    <a href={explorerUrl} target="_blank" rel="noreferrer" className="font-mono underline decoration-dotted">
      {short}
    </a>
  ) : (
    <span className="font-mono">{short}</span>
  );
}

export function AttemptTrail({ attempts }: { attempts: RailAttempt[] }) {
  if (attempts.length < 2 && attempts.every((a) => a.ok)) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs">
      {attempts.map((a, i) => (
        <li key={i}>
          {a.ok ? "✓" : "✗"} {RAIL_LABEL[a.rail]}
          {a.error ? `: ${a.error}` : ""}
        </li>
      ))}
    </ul>
  );
}

export function ReceiptDetails({ receipt }: { receipt: PaymentReceipt }) {
  return (
    <div className="mt-1 space-y-1 text-xs text-emerald-900/80">
      <p className="flex flex-wrap items-center gap-1.5">
        Spend Guard approved, paid via <RailBadge rail={receipt.rail} />
        {receipt.testnetAmount && (
          <span>
            {receipt.testnetAmount} {receipt.asset} on {receipt.network}
          </span>
        )}
        <TxLink txHash={receipt.txHash} explorerUrl={receipt.explorerUrl} />
      </p>
      {receipt.note && <p>{receipt.note}</p>}
      <AttemptTrail attempts={receipt.attempts} />
    </div>
  );
}
