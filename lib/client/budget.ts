const BUDGET_KEY = "melit.budget.v1";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Stable scope for server-held ledger and list (survives a fresh melit_sid cookie when localStorage remains). */
export function budgetId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(BUDGET_KEY);
  if (!id || !UUID.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem(BUDGET_KEY, id);
  }
  return id;
}

export function melitHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const id = budgetId();
  if (id) headers.set("X-Melit-Budget", id);
  return headers;
}

export function melitFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    credentials: init?.credentials ?? "include",
    headers: melitHeaders(init?.headers),
  });
}