import { beforeEach, describe, expect, it } from "vitest";
import { LIMITS, rateLimit, resetRateLimits } from "../lib/server/rate-limit";

const req = (ip: string) => new Request("http://x/api/negotiate", { method: "POST", headers: { "x-real-ip": ip } });

describe("rate limits on credit-spending endpoints", () => {
  beforeEach(() => resetRateLimits());

  it("caps negotiations per client and answers 429 with Retry-After", async () => {
    const perMinute = LIMITS.negotiate[0].perClient;
    for (let i = 0; i < perMinute; i++) expect(rateLimit(req("1.1.1.1"), "negotiate", 1_000)).toBeNull();
    const blocked = rateLimit(req("1.1.1.1"), "negotiate", 1_000);
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await blocked!.json()).error).toMatch(/try again/);
    expect(rateLimit(req("2.2.2.2"), "negotiate", 1_000)).toBeNull();
    expect(rateLimit(req("1.1.1.1"), "negotiate", 61_000)).toBeNull();
  });

  it("caps everyone together with a global limit", () => {
    let blocked = 0;
    for (let i = 0; i < LIMITS.negotiate[0].global + 10; i++) if (rateLimit(req(`10.0.0.${i}`), "negotiate", 5_000)) blocked++;
    expect(blocked).toBe(10);
  });

  it("enforces the hourly limit too", () => {
    let ok = 0;
    for (let minute = 0; minute < 60; minute++) {
      for (let i = 0; i < 6; i++) if (!rateLimit(req("3.3.3.3"), "negotiate", minute * 60_000 + i)) ok++;
    }
    expect(ok).toBe(LIMITS.negotiate[1].perClient);
  });
});
