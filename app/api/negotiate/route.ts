import { z } from "zod";
import { runShopping } from "@/lib/negotiation/run";
import { getReasoningAdapter } from "@/lib/adapters/reasoning";
import { ndjsonResponse } from "@/lib/server/stream";
import { parseProfile } from "@/lib/learning/profile";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";

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
  const { limited, remaining } = checkRateLimit(req, "negotiate");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request: give an item, a max price and a priority." }, { status: 400 });
  }
  const { request, ledger, list, profile, reviews } = body.data;
  return withRemaining(
    ndjsonResponse(
      runShopping(request, ledger, getReasoningAdapter(), undefined, { profile: parseProfile(profile), reviews }, list),
    ),
    remaining,
  );
}
