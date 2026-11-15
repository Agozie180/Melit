import { z } from "zod";
import { runOverspend } from "@/lib/negotiation/run";
import { ndjsonResponse } from "@/lib/server/stream";
import { loadDemoState } from "@/lib/server/demo-state";
import { purchaseHooks } from "@/lib/server/purchase-scope";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";
import { financialScopeFromRequest } from "@/lib/server/request-session";

const BodySchema = z.object({
  ledger: z.array(z.unknown()).max(500).default([]),
  list: z.unknown().optional(),
});

export async function POST(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "overspend");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request: send the ledger as an array." }, { status: 400 });
  const scopeId = financialScopeFromRequest(req);
  const stored = scopeId ? await loadDemoState(scopeId) : { ledger: [], list: null, ledgerIntegrity: "ok" as const, pending: [], version: 0 };
  const ledger = scopeId ? stored.ledger : body.data.ledger;
  const list = scopeId ? (stored.list ?? body.data.list) : body.data.list;
  const hooks = scopeId ? purchaseHooks(scopeId, list) : {};
  return withRemaining(ndjsonResponse(runOverspend(ledger, undefined, list, hooks)), remaining);
}