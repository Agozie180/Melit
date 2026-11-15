import { z } from "zod";
import { ReppoError, getReppoClient } from "@/lib/adapters/reppo";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";

const IdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,120}$/);

/** Current state of one Reppo evaluation, straight from Reppo. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { limited, remaining } = checkRateLimit(req, "reppo");
  if (limited) return limited;
  const { id } = await ctx.params;
  if (!IdSchema.safeParse(id).success) {
    return Response.json({ error: "Invalid evaluation id." }, { status: 400 });
  }
  try {
    const evaluation = await getReppoClient().get(id);
    return withRemaining(
      Response.json({ evalId: evaluation.id, status: evaluation.status, verdict: evaluation.verdict, error: evaluation.error }),
      remaining,
    );
  } catch (err) {
    const e = err as ReppoError;
    return Response.json({ error: e.message, retryable: e.retryable ?? true }, { status: e.status === 404 ? 404 : e.status === 0 ? 503 : 502 });
  }
}
