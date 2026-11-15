import { z } from "zod";
import { runShopping } from "@/lib/negotiation/run";
import { getReasoningAdapter } from "@/lib/adapters/reasoning";
import { ndjsonResponse } from "@/lib/server/stream";
import { parseProfile } from "@/lib/learning/profile";

export const maxDuration = 120;

const BodySchema = z.object({
  request: z.object({
    query: z.string().trim().min(1).max(200),
    maxPriceCents: z.number().int().positive().max(100_000_00),
    priority: z.enum(["save", "fast"]),
  }),
  ledger: z.unknown(),
  profile: z.unknown().optional(),
  reviews: z.unknown().optional(),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request: give an item, a max price and a priority." }, { status: 400 });
  }
  const { request, ledger, profile, reviews } = body.data;
  return ndjsonResponse(
    runShopping(request, ledger, getReasoningAdapter(), undefined, { profile: parseProfile(profile), reviews }),
  );
}
