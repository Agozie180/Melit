import { z } from "zod";
import { runOverspend } from "@/lib/negotiation/run";
import { ndjsonResponse } from "@/lib/server/stream";
import { appendLedgerEntry, loadDemoState } from "@/lib/server/demo-state";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";
import { sessionIdFromRequest } from "@/lib/server/request-session";

const BodySchema = z.object({
  ledger: z.array(z.unknown()).max(500).default([]),
  list: z.unknown().optional(),
});

export async function POST(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "overspend");
  if (limited) return limited;
  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request: send the ledger as an array." }, { status: 400 });
  const sid = sessionIdFromRequest(req);
  const stored = sid ? await loadDemoState(sid) : { ledger: [], list: null };
  const ledger = stored.ledger.length > 0 ? stored.ledger : body.data.ledger;
  const list = stored.list ?? body.data.list;
  return withRemaining(
    ndjsonResponse(
      runOverspend(ledger, undefined, list, {
        onLedgerAppend: sid ? (entry) => appendLedgerEntry(sid, entry) : undefined,
      }),
    ),
    remaining,
  );
}
