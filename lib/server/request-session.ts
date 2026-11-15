// SERVER-ONLY. Reads the demo session id set by middleware (melit_sid cookie).

const COOKIE = "melit_sid";

export function sessionIdFromRequest(req: Request): string {
  const cookie = req.headers.get("cookie");
  const match = cookie?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (match?.[1]) return decodeURIComponent(match[1]);
  const test = req.headers.get("x-melit-session");
  return test?.trim() ?? "";
}