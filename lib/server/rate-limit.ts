// SERVER-ONLY. Fixed-window request limits for endpoints that spend SERV credits, Reppo credits
// or testnet funds. With Upstash / Vercel KV the counters are shared across serverless instances.

import { kvIncrWindow } from "./kv";

export interface LimitRule {
  /** Max requests per client IP in the window. */
  perClient: number;
  /** Max requests across all clients in the window (per window bucket). */
  global: number;
  windowMs: number;
}

export const LIMITS = {
  negotiate: [
    { perClient: 6, global: 60, windowMs: 60_000 },
    { perClient: 40, global: 400, windowMs: 60 * 60_000 },
  ],
  feedback: [
    { perClient: 10, global: 100, windowMs: 60_000 },
    { perClient: 60, global: 600, windowMs: 60 * 60_000 },
  ],
  overspend: [{ perClient: 20, global: 300, windowMs: 60_000 }],
  "shopping-list": [{ perClient: 30, global: 300, windowMs: 60_000 }],
  reppo: [
    { perClient: 12, global: 120, windowMs: 60_000 },
    { perClient: 60, global: 600, windowMs: 60 * 60_000 },
  ],
} satisfies Record<string, LimitRule[]>;

type Bucket = { start: number; count: number };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

function hitMemory(key: string, limit: number, windowMs: number, now: number): { ok: boolean; retryAfterMs: number; remaining: number } {
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  if (b.count >= limit) return { ok: false, retryAfterMs: b.start + windowMs - now, remaining: 0 };
  b.count++;
  return { ok: true, retryAfterMs: 0, remaining: limit - b.count };
}

async function hit(key: string, limit: number, windowMs: number, now: number): Promise<{ ok: boolean; retryAfterMs: number; remaining: number }> {
  const shared = await kvIncrWindow(key, windowMs, now);
  if (shared >= 0) {
    const windowStart = Math.floor(now / windowMs) * windowMs;
  const remaining = Math.max(0, limit - shared);
    if (shared > limit) return { ok: false, retryAfterMs: windowStart + windowMs - now, remaining: 0 };
    return { ok: true, retryAfterMs: 0, remaining };
  }
  return hitMemory(key, limit, windowMs, now);
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function limitedResponse(scope: string, retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const who = scope === "global" ? "This demo is getting a lot of traffic" : "You're going a bit fast";
  return Response.json(
    { error: `${who}. Please try again in ${seconds}s.`, retryable: true },
    { status: 429, headers: { "Retry-After": String(seconds), "X-RateLimit-Remaining": "0" } },
  );
}

/** Returns a 429 Response when the request is over any limit, otherwise null (and counts it). */
export async function rateLimit(req: Request, name: keyof typeof LIMITS, now = Date.now()): Promise<Response | null> {
  return (await checkRateLimit(req, name, now)).limited;
}

/** Like rateLimit, plus the smallest per-client allowance left, for an X-RateLimit-Remaining header. */
export async function checkRateLimit(
  req: Request,
  name: keyof typeof LIMITS,
  now = Date.now(),
): Promise<{ limited: Response | null; remaining: number }> {
  const ip = clientIp(req);
  let remaining = Infinity;
  for (const rule of LIMITS[name]) {
    for (const [scope, limit] of [[`ip:${ip}`, rule.perClient], ["global", rule.global]] as const) {
      const r = await hit(`${name}:${rule.windowMs}:${scope}`, limit, rule.windowMs, now);
      if (scope !== "global") remaining = Math.min(remaining, r.remaining);
      if (!r.ok) return { limited: limitedResponse(scope, r.retryAfterMs), remaining: 0 };
    }
  }
  return { limited: null, remaining: Number.isFinite(remaining) ? remaining : 0 };
}

export function withRemaining(res: Response, remaining: number): Response {
  res.headers.set("X-RateLimit-Remaining", String(remaining));
  return res;
}

export function resetRateLimits() {
  buckets.clear();
}