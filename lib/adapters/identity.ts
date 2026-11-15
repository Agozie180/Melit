// SERVER-ONLY. Agent identity adapter.
//
// Order of preference, each only if it can actually be confirmed:
// 1. Kite Passport sandbox: `kpass sandbox status` says sandbox and `kpass agent status`
//    succeeds. Checked live (cached for a minute), never assumed.
// 2. Testnet wallet: the address behind AGENT_PRIVATE_KEY. A real key on KiteAI testnet,
//    but not a Passport-verified identity, and labelled that way.
// 3. Simulated: an identifier with the same shape, labelled "Simulated".

import { createHash } from "node:crypto";
import { WEEKLY_CAP_CENTS } from "../money";
import { KITE_TESTNET } from "../kite/config";
import { execKpass, isSandboxStatus, type KpassRunner } from "../payments/kpass-rail";
import { kpassEnabled } from "../payments";
import { agentTestnetAddress } from "../payments/testnet-rail";

export interface AgentIdentity {
  agentId: string;
  displayName: string;
  provider: string;
  verified: boolean;
  status: "kite-passport-sandbox" | "testnet-wallet" | "simulated";
  statusLabel: string;
  spendingLimitCents: number;
  limitWindow: string;
  enforcedBy: string;
  explorerUrl: string | null;
  checkedAt: number;
}

function base(): Pick<AgentIdentity, "displayName" | "spendingLimitCents" | "limitWindow" | "enforcedBy" | "checkedAt"> {
  return {
    displayName: "Melit Shopping Agent",
    spendingLimitCents: WEEKLY_CAP_CENTS,
    limitWindow: "rolling 7 days",
    enforcedBy: "Melit Spend Guard (server code), then the Passport session cap when Passport pays",
    checkedAt: Date.now(),
  };
}

function pickString(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) if (typeof rec[k] === "string" && rec[k]) return rec[k] as string;
  if (rec.data && typeof rec.data === "object") return pickString(rec.data, keys);
  return undefined;
}

async function passportIdentity(run: KpassRunner): Promise<AgentIdentity | null> {
  const mode = await run(["sandbox", "status"]);
  if (mode.exitCode !== 0 || !isSandboxStatus(mode.json)) return null;
  const status = await run(["agent", "status"]);
  if (status.exitCode !== 0 || status.json?.status !== "success") return null;
  const agentId = pickString(status.json, ["agent_id", "agentId", "did", "id", "address"]);
  if (!agentId) return null;
  return {
    ...base(),
    agentId,
    provider: "Kite Passport (sandbox)",
    verified: true,
    status: "kite-passport-sandbox",
    statusLabel: "Kite Passport sandbox agent, confirmed by kpass",
    explorerUrl: null,
  };
}

let cache: { at: number; value: AgentIdentity } | undefined;

export async function getAgentIdentity(run: KpassRunner = execKpass): Promise<AgentIdentity> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  let value: AgentIdentity | null = null;

  if (kpassEnabled()) {
    value = await passportIdentity(run).catch(() => null);
  }
  if (!value) {
    const address = agentTestnetAddress();
    if (address) {
      value = {
        ...base(),
        agentId: address,
        provider: `KiteAI testnet wallet (chain ${KITE_TESTNET.chainId})`,
        verified: false,
        status: "testnet-wallet",
        statusLabel: "Testnet wallet, not Passport-verified",
        explorerUrl: `${KITE_TESTNET.explorerUrl}/address/${address}`,
      };
    }
  }
  if (!value) {
    const seed = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "local";
    const short = createHash("sha256").update(`melit-agent:${seed}`).digest("hex").slice(0, 12);
    value = {
      ...base(),
      agentId: `melit-agent-${short}`,
      provider: "Kite Passport-ready",
      verified: false,
      status: "simulated",
      statusLabel: "Simulated identity (Kite Passport-ready)",
      explorerUrl: null,
    };
  }
  cache = { at: Date.now(), value };
  return value;
}
