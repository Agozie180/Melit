// SERVER-ONLY. Deal summaries are signed when a negotiation ends, so owner feedback and Reppo
// submissions can only be about negotiations this server actually ran.

import { z } from "zod";
import type { DealSummary } from "../learning/types";
import { signObject, verifyObject } from "./signing";

const DOMAIN = "deal-summary";

export function signDealSummary(summary: Omit<DealSummary, "sig">): DealSummary {
  return { ...summary, sig: signObject(DOMAIN, summary) };
}

const cents = z.number().int().min(0).max(100_000_000);

const SummarySchema = z.object({
  dealId: z.string().max(80),
  at: z.number().finite(),
  itemId: z.string().max(40),
  itemName: z.string().max(120),
  sellerId: z.string().max(40),
  sellerName: z.string().max(80),
  sellerStyle: z.string().max(20),
  listPriceCents: cents,
  marketReferenceCents: cents,
  maxPriceCents: cents,
  requestPriority: z.enum(["save", "fast"]),
  remainingBudgetCents: cents,
  rounds: z
    .array(
      z.object({
        round: z.number().int().min(1).max(10),
        askCents: cents,
        action: z.enum(["offer", "accept", "walk"]),
        offerCents: cents,
        source: z.enum(["serv", "fallback"]),
        reasoning: z.array(z.string().max(400)).max(8),
        sellerStatus: z.enum(["accept", "counter", "walk"]).nullable(),
        sellerPriceCents: cents.nullable(),
        sellerMessage: z.string().max(300).nullable(),
      }),
    )
    .max(10),
  outcome: z.enum(["purchased", "melit-walked", "seller-walked", "no-deal", "blocked", "payment-failed"]),
  paidCents: cents.nullable(),
  savedCents: z.number().int().nullable(),
  profile: z.object({
    aggressiveness: z.number(),
    walkAwayThreshold: z.number(),
    priority: z.enum(["save", "speed"]),
    notes: z.array(z.string().max(200)).max(20),
    version: z.number().int(),
  }),
  reputation: z.object({
    sellerId: z.string().nullable(),
    reviews: z.number().int(),
    avgRating: z.number().nullable(),
    willingness: z.number(),
    floorPremium: z.number(),
  }),
  sig: z.string().max(120),
});

export function verifyDealSummary(raw: unknown): { ok: true; summary: DealSummary } | { ok: false; reason: string } {
  const parsed = SummarySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "Deal summary is malformed." };
  const summary = parsed.data as DealSummary;
  if (!verifyObject(DOMAIN, summary)) return { ok: false, reason: "Deal summary signature is invalid." };
  return { ok: true, summary };
}
