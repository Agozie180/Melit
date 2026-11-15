import { connection } from "next/server";
import { getAgentIdentity } from "@/lib/adapters/identity";
import { getReasoningAdapter } from "@/lib/adapters/reasoning";
import { getReppoClient } from "@/lib/adapters/reppo";
import { publicCatalog } from "@/lib/market/catalog";
import { MELIT_FEE_RATE, WEEKLY_CAP_CENTS } from "@/lib/money";
import { configuredRails, paymentMode } from "@/lib/payments";
import { KITE_TESTNET, testnetScale } from "@/lib/kite/config";

export async function GET() {
  // Env-dependent status must be read per request, not baked in at build time.
  await connection();
  const reasoner = getReasoningAdapter();
  const mode = paymentMode();
  return Response.json({
    identity: await getAgentIdentity(),
    payments: {
      mode,
      rails: configuredRails(mode).map((r) => r.id),
      network: KITE_TESTNET.name,
      chainId: KITE_TESTNET.chainId,
      asset: KITE_TESTNET.asset.symbol,
      testnetScale: testnetScale(),
    },
    reasoning: { provider: reasoner.provider, model: reasoner.model, configured: reasoner.configured },
    reppo: { configured: getReppoClient().configured, taskType: "action" },
    capCents: WEEKLY_CAP_CENTS,
    feeRate: MELIT_FEE_RATE,
    catalog: publicCatalog(),
  });
}
