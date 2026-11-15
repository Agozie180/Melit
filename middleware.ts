import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { BUDGET_COOKIE, BUDGET_UUID_RE, SESSION_COOKIE } from "@/lib/server/request-session";

const MAX_AGE = 90 * 24 * 60 * 60;

function setScopeCookies(res: NextResponse, budgetId: string, sessionId?: string) {
  res.cookies.set(BUDGET_COOKIE, budgetId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  if (sessionId) {
    res.cookies.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    });
  }
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const headerBudget = req.headers.get("x-melit-budget")?.trim() ?? "";
  const cookieBudget = req.cookies.get(BUDGET_COOKIE)?.value ?? "";
  const cookieSession = req.cookies.get(SESSION_COOKIE)?.value ?? "";

  let budgetId = BUDGET_UUID_RE.test(headerBudget) ? headerBudget : BUDGET_UUID_RE.test(cookieBudget) ? cookieBudget : "";
  if (!budgetId) budgetId = crypto.randomUUID();

  if (headerBudget && BUDGET_UUID_RE.test(headerBudget) && headerBudget !== cookieBudget) {
    setScopeCookies(res, headerBudget, cookieSession || undefined);
    return res;
  }
  if (!BUDGET_UUID_RE.test(cookieBudget)) {
    setScopeCookies(res, budgetId, cookieSession || crypto.randomUUID());
    return res;
  }
  if (!cookieSession) {
    res.cookies.set(SESSION_COOKIE, crypto.randomUUID(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    });
  }
  return res;
}

export const config = {
  matcher: ["/api/:path*", "/"],
};