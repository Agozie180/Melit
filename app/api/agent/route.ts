import { connection } from "next/server";
import { getIdentityAdapter } from "@/lib/adapters/identity";
import { getPaymentAdapter } from "@/lib/adapters/payments";
import { getReasoningAdapter } from "@/lib/adapters/reasoning";
import { publicCatalog } from "@/lib/market/catalog";
import { MELIT_FEE_RATE, WEEKLY_CAP_CENTS } from "@/lib/money";

export async function GET() {
  // Env-dependent status must be read per request, not baked in at build time.
  await connection();
  const reasoner = getReasoningAdapter();
  return Response.json({
    identity: getIdentityAdapter().getIdentity(),
    payments: { mode: getPaymentAdapter().mode },
    reasoning: { provider: reasoner.provider, model: reasoner.model, configured: reasoner.configured },
    capCents: WEEKLY_CAP_CENTS,
    feeRate: MELIT_FEE_RATE,
    catalog: publicCatalog(),
  });
}
