import { z } from "zod";
import { runOverspend } from "@/lib/negotiation/run";
import { ndjsonResponse } from "@/lib/server/stream";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";

const BodySchema = z.object({ ledger: z.array(z.unknown()).max(500).default([]) });

export async function POST(req: Request) {
  const { limited, remaining } = checkRateLimit(req, "overspend");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request: send the ledger as an array." }, { status: 400 });
  return withRemaining(ndjsonResponse(runOverspend(body.data.ledger)), remaining);
}
