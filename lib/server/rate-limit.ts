// SERVER-ONLY. Fixed-window request limits for endpoints that spend SERV credits, Reppo credits
// or testnet funds. State is per serverless instance (no shared store), so this bounds what one
// client can burn per instance; the Vercel Firewall rule on /api/* is the cross-instance layer.

export interface LimitRule {
  /** Max requests per client IP in the window. */
  perClient: number;
  /** Max requests across all clients in the window (per instance). */
  global: number;
  windowMs: number;
}

export const LIMITS = {
  // Each negotiation is up to 4 SERV calls plus one payment.
  negotiate: [
    { perClient: 6, global: 60, windowMs: 60_000 },
    { perClient: 40, global: 400, windowMs: 60 * 60_000 },
  ],
  feedback: [
    { perClient: 10, global: 100, windowMs: 60_000 },
    { perClient: 60, global: 600, windowMs: 60 * 60_000 },
  ],
  overspend: [{ perClient: 20, global: 300, windowMs: 60_000 }],
} satisfies Record<string, LimitRule[]>;

type Bucket = { start: number; count: number };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

function hit(key: string, limit: number, windowMs: number, now: number): { ok: boolean; retryAfterMs: number } {
  let b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
      if (buckets.size >= MAX_KEYS) buckets.clear();
    }
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  if (b.count >= limit) return { ok: false, retryAfterMs: b.start + windowMs - now };
  b.count++;
  return { ok: true, retryAfterMs: 0 };
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Returns a 429 Response when the request is over any limit, otherwise null (and counts it). */
export function rateLimit(req: Request, name: keyof typeof LIMITS, now = Date.now()): Response | null {
  const ip = clientIp(req);
  for (const rule of LIMITS[name]) {
    for (const [scope, limit] of [[`ip:${ip}`, rule.perClient], ["global", rule.global]] as const) {
      const r = hit(`${name}:${rule.windowMs}:${scope}`, limit, rule.windowMs, now);
      if (!r.ok) {
        const seconds = Math.max(1, Math.ceil(r.retryAfterMs / 1000));
        const who = scope === "global" ? "This demo is getting a lot of traffic" : "You're going a bit fast";
        return Response.json(
          { error: `${who}. Please try again in ${seconds}s.`, retryable: true },
          { status: 429, headers: { "Retry-After": String(seconds) } },
        );
      }
    }
  }
  return null;
}

export function resetRateLimits() {
  buckets.clear();
}
