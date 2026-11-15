import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getReasoningAdapter } from "@/lib/adapters/reasoning";
import { ReppoError, getReppoClient } from "@/lib/adapters/reppo";
import { proposeOwnerUpdate, proposeReppoUpdate } from "@/lib/learning/feedback";
import { applyBoundedUpdate, parseProfile } from "@/lib/learning/profile";
import { buildReppoInput } from "@/lib/learning/reppo-input";
import type { FeedbackResponse, LearningEvent } from "@/lib/learning/types";
import { verifyDealSummary } from "@/lib/server/deal-summary";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";

export const maxDuration = 60;

const BodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("owner"),
    summary: z.unknown(),
    profile: z.unknown(),
    rating: z.enum(["up", "down"]),
    note: z.string().max(500).default(""),
  }),
  z.object({
    kind: z.literal("reppo"),
    summary: z.unknown(),
    profile: z.unknown(),
    evalId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  }),
]);

export async function POST(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "feedback");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid feedback request." }, { status: 400 });
  const summaryCheck = verifyDealSummary(body.data.summary);
  if (!summaryCheck.ok) return Response.json({ error: summaryCheck.reason }, { status: 400 });
  const summary = summaryCheck.summary;
  const profile = parseProfile(body.data.profile);
  const reasoner = getReasoningAdapter();

  if (body.data.kind === "owner") {
    const proposal = await proposeOwnerUpdate(reasoner, { summary, profile, rating: body.data.rating, note: body.data.note });
    const applied = applyBoundedUpdate(profile, proposal.update, "owner");
    const event: LearningEvent = {
      id: `learn_${randomUUID()}`,
      at: Date.now(),
      source: "owner",
      dealId: summary.dealId,
      learned: proposal.learned,
      changes: applied.changes,
      capped: applied.capped,
      method: proposal.method,
      fallbackReason: proposal.fallbackReason,
      profileVersion: applied.profile.version,
    };
    return withRemaining(Response.json({ profile: applied.profile, event, update: proposal.update } satisfies FeedbackResponse), remaining);
  }

  // Never trust a client-supplied verdict: fetch it from Reppo and check it is about this deal.
  let evaluation;
  try {
    evaluation = await getReppoClient().get(body.data.evalId);
  } catch (err) {
    const e = err as ReppoError;
    return Response.json({ error: e.message, retryable: e.retryable ?? true }, { status: 502 });
  }
  if (evaluation.status !== "COMPLETED" || !evaluation.verdict) {
    return Response.json({ error: `Reppo evaluation is ${evaluation.status}, not COMPLETED.`, retryable: evaluation.status !== "FAILED" }, { status: 409 });
  }
  const expectedInput = buildReppoInput(summary);
  if (evaluation.input === null || evaluation.input !== expectedInput) {
    return Response.json({ error: "That Reppo evaluation is not about this negotiation.", retryable: false }, { status: 400 });
  }

  const proposal = await proposeReppoUpdate(reasoner, { summary, profile, verdict: evaluation.verdict });
  const applied = applyBoundedUpdate(profile, proposal.update, "reppo");
  const event: LearningEvent = {
    id: `learn_${randomUUID()}`,
    at: Date.now(),
    source: "reppo",
    dealId: summary.dealId,
    learned: proposal.learned,
    changes: applied.changes,
    capped: applied.capped,
    method: proposal.method,
    fallbackReason: proposal.fallbackReason,
    profileVersion: applied.profile.version,
  };
  return withRemaining(Response.json({ profile: applied.profile, event, update: proposal.update, verdict: evaluation.verdict } satisfies FeedbackResponse), remaining);
}
