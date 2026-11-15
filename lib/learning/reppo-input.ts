// Builds the text Melit submits to Reppo for evaluation. Evaluations may be visible to peer
// assessors, so the input is assembled only from synthetic negotiation data (mock sellers,
// catalogue prices, Melit's reasoning) and then scrubbed of anything that looks like a wallet
// address, tx hash, key, email, URL or long number.

import { formatUsd } from "../money";
import type { DealSummary } from "./types";

const SCRUBBERS: [RegExp, string][] = [
  [/0x[0-9a-fA-F]{6,}/g, "[redacted-hex]"],
  [/\b[0-9a-fA-F]{32,}\b/g, "[redacted-hex]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
  [/\bhttps?:\/\/\S+/gi, "[redacted-url]"],
  [/\b(?:www\.)\S+/gi, "[redacted-url]"],
  [/\b(?:sk|rk|pk|key|tok|token|bearer)[-_][A-Za-z0-9_-]{8,}\b/gi, "[redacted-key]"],
  [/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted-token]"],
  [/\b\d{9,}\b/g, "[redacted-number]"],
];

export function scrubForReppo(text: string): string {
  return SCRUBBERS.reduce((t, [re, replacement]) => t.replace(re, replacement), text);
}

const OUTCOME_TEXT: Record<DealSummary["outcome"], string> = {
  purchased: "Deal closed and paid within the weekly Spend Guard.",
  "melit-walked": "Melit walked away without buying.",
  "seller-walked": "The seller walked away; nothing was bought.",
  "no-deal": "No deal within the round limit; nothing was bought.",
  blocked: "A price was agreed but the Spend Guard blocked payment (weekly cap).",
  "payment-failed": "A price was agreed but the payment did not go through.",
};

export function buildReppoInput(summary: DealSummary): string {
  const lines: string[] = [];
  lines.push("Evaluate this shopping agent's negotiation. All sellers, items and prices are synthetic (a mock marketplace used for a hackathon demo).");
  lines.push("");
  lines.push("What the user asked for:");
  lines.push(
    `Buy "${summary.itemName}" for at most ${formatUsd(summary.maxPriceCents)}, priority "${summary.requestPriority === "save" ? "save money" : "close fast"}". Weekly budget remaining: ${formatUsd(summary.remainingBudgetCents)} (hard cap $300 per rolling 7 days).`,
  );
  lines.push("");
  lines.push("Context the agent had:");
  lines.push(`- Seller: ${summary.sellerName}, style "${summary.sellerStyle}". List price ${formatUsd(summary.listPriceCents)}, market reference ${formatUsd(summary.marketReferenceCents)}.`);
  lines.push(
    `- Learned strategy: aggressiveness ${summary.profile.aggressiveness.toFixed(2)} (0 gentle to 1 aggressive), walk-away at ${Math.round(summary.profile.walkAwayThreshold * 100)}% of market, standing priority "${summary.profile.priority}".`,
  );
  if (summary.profile.notes.length) lines.push(`- Owner's notes: ${summary.profile.notes.map((n) => `"${n}"`).join("; ")}`);
  if (summary.reputation.avgRating !== null) {
    lines.push(`- Melit's reputation with sellers: ${summary.reputation.avgRating.toFixed(1)}/5 from ${summary.reputation.reviews} review(s).`);
  }
  lines.push("- The seller's minimum price was hidden from the agent.");
  lines.push("");
  lines.push("What the agent did, round by round:");
  for (const r of summary.rounds) {
    const move =
      r.action === "offer" ? `offered ${formatUsd(r.offerCents)}` : r.action === "accept" ? `accepted the ask of ${formatUsd(r.askCents)}` : "walked away";
    lines.push(`Round ${r.round}: ask ${formatUsd(r.askCents)}; Melit ${move}${r.source === "fallback" ? " (rule-based fallback)" : ""}.`);
    for (const step of r.reasoning.slice(0, 4)) lines.push(`  reasoning: ${step}`);
    if (r.sellerStatus) {
      const price = r.sellerPriceCents !== null ? ` ${formatUsd(r.sellerPriceCents)}` : "";
      lines.push(`  seller ${r.sellerStatus}${price}: "${r.sellerMessage ?? ""}"`);
    }
  }
  lines.push("");
  lines.push(`Outcome: ${OUTCOME_TEXT[summary.outcome]}`);
  if (summary.paidCents !== null) {
    const savedPct = ((summary.listPriceCents - summary.paidCents) / summary.listPriceCents) * 100;
    lines.push(`Paid ${formatUsd(summary.paidCents)} (${savedPct.toFixed(1)}% below list, ${((summary.paidCents / summary.marketReferenceCents) * 100).toFixed(0)}% of market reference).`);
  }
  lines.push("");
  lines.push(
    "Judge: did the agent get a good price for the user without needless risk of losing the deal, respect the user's limits and priority, and reason honestly? Suggest whether it should be more or less aggressive next time.",
  );
  return scrubForReppo(lines.join("\n"));
}
