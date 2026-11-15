import { z } from "zod";
import { ReppoError, getReppoClient } from "@/lib/adapters/reppo";
import { buildReppoInput } from "@/lib/learning/reppo-input";
import { verifyDealSummary } from "@/lib/server/deal-summary";
import { checkRateLimit, clientIp, withRemaining } from "@/lib/server/rate-limit";

export const maxDuration = 30;

const MAX_SUMMARY_AGE_MS = 60 * 60 * 1000;
const MIN_GAP_PER_CLIENT_MS = 20_000;

// Best-effort, per-instance guard against burning Reppo credits; each deal is judged once.
const submittedDeals = new Map<string, string>();
const lastSubmitByClient = new Map<string, number>();

const BodySchema = z.object({ summary: z.unknown() });

/** Submit one finished purchase to Reppo for evaluation. Returns as soon as Reppo has queued it. */
export async function POST(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "reppo");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const check = verifyDealSummary(body.data.summary);
  if (!check.ok) return Response.json({ error: check.reason, retryable: false }, { status: 400 });
  const summary = check.summary;
  if (summary.outcome !== "purchased") {
    return Response.json({ error: "Only completed purchases are sent to Reppo.", retryable: false }, { status: 400 });
  }
  if (Date.now() - summary.at > MAX_SUMMARY_AGE_MS) {
    return Response.json({ error: "This negotiation is too old to submit.", retryable: false }, { status: 400 });
  }
  const existing = submittedDeals.get(summary.dealId);
  if (existing) return withRemaining(Response.json({ evalId: existing, status: "QUEUED", duplicate: true }), remaining);

  const client = getReppoClient();
  if (!client.configured) {
    return Response.json({ error: "Reppo is not configured on this deployment (REPPO_API_KEY).", retryable: false }, { status: 503 });
  }
  const key = clientIp(req);
  const last = lastSubmitByClient.get(key) ?? 0;
  if (Date.now() - last < MIN_GAP_PER_CLIENT_MS) {
    return Response.json({ error: "One Reppo submission at a time; try again shortly.", retryable: true }, { status: 429 });
  }

  try {
    const evaluation = await client.submit("action", buildReppoInput(summary));
    lastSubmitByClient.set(key, Date.now());
    submittedDeals.set(summary.dealId, evaluation.id);
    return withRemaining(Response.json({ evalId: evaluation.id, status: evaluation.status }, { status: 201 }), remaining);
  } catch (err) {
    const e = err as ReppoError;
    return Response.json({ error: e.message, retryable: e.retryable ?? true }, { status: e.status === 0 ? 503 : 502 });
  }
}
