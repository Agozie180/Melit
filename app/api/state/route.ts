import { loadDemoState, resetLedger } from "@/lib/server/demo-state";
import { persistentStoreReady } from "@/lib/server/kv";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";
import { sessionIdFromRequest } from "@/lib/server/request-session";

/** Returns the server-held ledger and signed shopping list for this browser session. */
export async function GET(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "shopping-list");
  if (limited) return limited;
  const sid = sessionIdFromRequest(req);
  const state = await loadDemoState(sid);
  return withRemaining(
    Response.json({
      ledger: state.ledger,
      list: state.list,
      persistent: persistentStoreReady(),
      sessionReady: Boolean(sid),
    }),
    remaining,
  );
}

/** Clears the server ledger for this session (Reset demo). The signed list is kept. */
export async function DELETE(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "shopping-list");
  if (limited) return limited;
  const sid = sessionIdFromRequest(req);
  if (sid) await resetLedger(sid);
  return withRemaining(Response.json({ ok: true }), remaining);
}