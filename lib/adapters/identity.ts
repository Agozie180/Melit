// SERVER-ONLY. Agent identity adapter.
//
// Kite Passport (docs.gokite.ai/passport) issues the real thing: the user installs the
// `kpass` CLI, creates a Passport with a passkey, funds a USDC wallet and approves a spending
// session (budget, per-transaction limit, time window). That flow needs a human passkey
// ceremony and a funded wallet, so it cannot run inside a stateless demo with only
// OPENSERV_API_KEY. Melit therefore ships a clearly simulated identity with the same shape.
// TODO(kite): implement KitePassportIdentityAdapter backed by a real approved session.

import { createHash } from "node:crypto";
import { WEEKLY_CAP_CENTS } from "../money";

export interface AgentIdentity {
  agentId: string;
  displayName: string;
  provider: string;
  verified: boolean;
  status: "simulated" | "active";
  statusLabel: string;
  spendingLimitCents: number;
  limitWindow: string;
  enforcedBy: string;
}

export interface IdentityAdapter {
  getIdentity(): AgentIdentity;
}

export class SimulatedKiteIdentityAdapter implements IdentityAdapter {
  getIdentity(): AgentIdentity {
    const seed = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "local";
    const short = createHash("sha256").update(`melit-agent:${seed}`).digest("hex").slice(0, 12);
    return {
      agentId: `melit-agent-${short}`,
      displayName: "Melit Shopping Agent",
      provider: "Kite Passport-ready",
      verified: false,
      status: "simulated",
      statusLabel: "Simulated identity (Kite Passport-ready)",
      spendingLimitCents: WEEKLY_CAP_CENTS,
      limitWindow: "rolling 7 days",
      enforcedBy: "Melit Spend Guard (server code)",
    };
  }
}

export function getIdentityAdapter(): IdentityAdapter {
  return new SimulatedKiteIdentityAdapter();
}
