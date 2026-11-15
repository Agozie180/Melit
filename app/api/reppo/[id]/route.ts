import { ReppoError, getReppoClient } from "@/lib/adapters/reppo";

/** Current state of one Reppo evaluation, straight from Reppo. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const evaluation = await getReppoClient().get(id);
    return Response.json({ evalId: evaluation.id, status: evaluation.status, verdict: evaluation.verdict, error: evaluation.error });
  } catch (err) {
    const e = err as ReppoError;
    return Response.json({ error: e.message, retryable: e.retryable ?? true }, { status: e.status === 404 ? 404 : e.status === 0 ? 503 : 502 });
  }
}
