import { describe, expect, it } from "vitest";
import { buildMelitCheckoutDelegation } from "../lib/kite/session-delegation";

describe("Passport session delegation for Melit checkout", () => {
  it("scopes GET /api/sellers/* on the public deploy host", () => {
    const raw = buildMelitCheckoutDelegation({
      sellerBaseUrl: "https://melit.vercel.app",
      taskSummary: "Buy from Melit mock sellers",
      maxAmountPerTxUsd: "0.9",
      maxTotalAmountUsd: "3",
    });
    const d = JSON.parse(raw) as {
      execution_constraints: { x402: { scope_mode: string; allowed_endpoints: { host: string; path_prefix: string }[] } };
    };
    expect(d.execution_constraints.x402.scope_mode).toBe("scoped");
    expect(d.execution_constraints.x402.allowed_endpoints[0].host).toBe("melit.vercel.app");
    expect(d.execution_constraints.x402.allowed_endpoints[0].path_prefix).toBe("/api/sellers/");
  });
});