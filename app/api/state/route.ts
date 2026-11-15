import { loadDemoState, resetLedger } from "@/lib/server/demo-state";
import { persistentStoreReady } from "@/lib/server/kv";
import { checkRateLimit, withRemaining } from "@/lib/server/rate-limit";
import { financialScopeFromRequest } from "@/lib/server/request-session";

/** Returns the server-held ledger and signed shopping list for this browser scope. */
export async function GET(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "shopping-list");
  if (limited) return limited;
  const scopeId = financialScopeFromRequest(req);
  const state = await loadDemoState(scopeId);
  return withRemaining(
    Response.json({
      ledger: state.ledger,
      list: state.list,
      persistent: persistentStoreReady(),
      sessionReady: Boolean(scopeId),
      ledgerLocked: state.ledgerIntegrity !== "ok",
      ledgerInvalidReason: state.ledgerInvalidReason ?? null,
    }),
    remaining,
  );
}

/** Clears the server ledger for this scope (Reset demo). The signed list is kept. */
export async function DELETE(req: Request) {
  const { limited, remaining } = await checkRateLimit(req, "shopping-list");
  if (limited) return limited;
  const scopeId = financialScopeFromRequest(req);
  if (scopeId) await resetLedger(scopeId);
  return withRemaining(Response.json({ ok: true }), remaining);
}