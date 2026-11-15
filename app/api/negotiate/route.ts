import { z } from "zod";
import { runShopping } from "@/lib/negotiation/run";
import { getReasoningAdapter } from "@/lib/adapters/reasoning";
import { ndjsonResponse } from "@/lib/server/stream";
import { parseProfile } from "@/lib/learning/profile";
import { appendLedgerEntry, loadDemoState } from "@/lib/server/demo-state";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";
import { sessionIdFromRequest } from "@/lib/server/request-session";

/** Passport session execute can take several minutes on x402 settle. */
export const maxDuration = 300;

const BodySchema = z.object({
  request: z.object({
    query: z.string().trim().min(1).max(200),
    maxPriceCents: z.number().int().positive().max(100_000_00),
    priority: z.enum(["save", "fast"]),
  }),
  ledger: z.array(z.unknown()).max(500).default([]),
  list: z.unknown().optional(),
  profile: z.unknown().optional(),
  reviews: z.unknown().optional(),
});

export async function POST(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "negotiate");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request: give an item, a max price and a priority." }, { status: 400 });
  }
  const { request, profile, reviews } = body.data;
  const sid = sessionIdFromRequest(req);
  const stored = sid ? await loadDemoState(sid) : { ledger: [], list: null };
  const ledger = stored.ledger.length > 0 ? stored.ledger : body.data.ledger;
  const list = stored.list ?? body.data.list;
  return withRemaining(
    ndjsonResponse(
      runShopping(request, ledger, getReasoningAdapter(), undefined, { profile: parseProfile(profile), reviews }, list, {
        onLedgerAppend: sid ? (entry) => appendLedgerEntry(sid, entry) : undefined,
      }),
    ),
    remaining,
  );
}
