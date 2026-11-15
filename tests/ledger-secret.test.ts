import { afterEach, describe, expect, it } from "vitest";
import { LedgerSecretError, ledgerSecret } from "../lib/server/ledger";

describe("ledgerSecret", () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it("uses MELIT_LEDGER_SECRET when set", () => {
    process.env.MELIT_LEDGER_SECRET = "explicit";
    delete process.env.OPENSERV_API_KEY;
    delete process.env.SERV_API_KEY;
    delete process.env.VERCEL;
    expect(ledgerSecret()).toBe("explicit");
  });

  it("derives from OPENSERV_API_KEY in dev", () => {
    delete process.env.MELIT_LEDGER_SECRET;
    process.env.OPENSERV_API_KEY = "sk-test";
    delete process.env.VERCEL;
    expect(ledgerSecret()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("falls back to insecure secret only outside Vercel", () => {
    delete process.env.MELIT_LEDGER_SECRET;
    delete process.env.OPENSERV_API_KEY;
    delete process.env.SERV_API_KEY;
    delete process.env.VERCEL;
    expect(ledgerSecret()).toBe("melit-dev-insecure-ledger-secret");
  });

  it("throws on Vercel without configured secret", () => {
    delete process.env.MELIT_LEDGER_SECRET;
    delete process.env.OPENSERV_API_KEY;
    delete process.env.SERV_API_KEY;
    process.env.VERCEL = "1";
    expect(() => ledgerSecret()).toThrow(LedgerSecretError);
  });
});