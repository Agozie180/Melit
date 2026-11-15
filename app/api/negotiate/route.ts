import { z } from "zod";
import { runShopping } from "@/lib/negotiation/run";
import { getReasoningAdapter } from "@/lib/adapters/reasoning";
import { ndjsonResponse } from "@/lib/server/stream";

export const maxDuration = 120;

const BodySchema = z.object({
  request: z.object({
    query: z.string().trim().min(1).max(200),
    maxPriceCents: z.number().int().positive().max(100_000_00),
    priority: z.enum(["save", "fast"]),
  }),
  ledger: z.unknown(),
});

export async function POST(req: Request) {
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: "Invalid request: give an item, a max price and a priority." }, { status: 400 });
  }
  return ndjsonResponse(runShopping(body.data.request, body.data.ledger, getReasoningAdapter()));
}
