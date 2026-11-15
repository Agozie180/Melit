import { describe, expect, it } from "vitest";
import { assertPassportHttpSettlement } from "../lib/kite/passport-settlement";
import { merchantAllowlistErrorCode } from "../lib/kite/sandbox-merchant";

describe("Passport settlement checks", () => {
  it("requires HTTP 2xx and a transaction reference", () => {
    const ok = assertPassportHttpSettlement({
      x402: { status_code: 200, payment_response: { reference: "0x" + "ab".repeat(32), success: true }, chain_id: 2368 },
    });
    expect(ok.txHash).toMatch(/^0x/);
  });

  it("rejects success=false on payment_response", () => {
    expect(() =>
      assertPassportHttpSettlement({
        x402: { status_code: 200, payment_response: { success: false, reference: "0x" + "ab".repeat(32) } },
      }),
    ).toThrow(/success=false/);
  });

  it("recognizes merchant allowlist error codes", () => {
    expect(merchantAllowlistErrorCode("sandbox_merchant_not_allowlisted")).toBe(true);
    expect(merchantAllowlistErrorCode("session_total_exceeded")).toBe(false);
  });
});