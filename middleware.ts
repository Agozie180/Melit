import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "melit_sid";
const MAX_AGE = 90 * 24 * 60 * 60;

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get(COOKIE)?.value) {
    res.cookies.set(COOKIE, crypto.randomUUID(), {
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