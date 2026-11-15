// SERVER-ONLY. Demo scope: melit_budget cookie (+ X-Melit-Budget header) and melit_sid for legacy tests.

const SESSION_COOKIE = "melit_sid";
const BUDGET_COOKIE = "melit_budget";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readCookie(req: Request, name: string): string {
  const cookie = req.headers.get("cookie");
  const match = cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function sessionIdFromRequest(req: Request): string {
  const fromCookie = readCookie(req, SESSION_COOKIE);
  if (fromCookie) return fromCookie;
  const test = req.headers.get("x-melit-session");
  return test?.trim() ?? "";
}

export function budgetIdFromRequest(req: Request): string {
  const header = req.headers.get("x-melit-budget")?.trim() ?? "";
  if (UUID.test(header)) return header;
  const fromCookie = readCookie(req, BUDGET_COOKIE);
  if (UUID.test(fromCookie)) return fromCookie;
  return "";
}

/** Authoritative storage key for ledger + signed list. Prefer budget scope over session id alone. */
export function financialScopeFromRequest(req: Request): string {
  return budgetIdFromRequest(req) || sessionIdFromRequest(req);
}

export { BUDGET_COOKIE, SESSION_COOKIE, UUID as BUDGET_UUID_RE };