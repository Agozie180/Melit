// Mock seller x402 checkout on KiteAI testnet. Kite Passport (Rail 1) pays this endpoint via
// `kpass session execute --method GET --url <this>?order=<token>`. It answers 402 with x402 v2
// payment requirements (exact scheme, pieUSD, eip155:2368) and settles through the Pieverse
// facilitator, following gokite-ai/kite-x402-services and BrKDDD/kite-x402-hono.
// The seller is a labelled mock; only the payment leg is real (testnet).

import { NextResponse, type NextRequest } from "next/server";
import { withX402, x402ResourceServer } from "@x402/next";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { centsToTestnetUnits, formatTestnetAmount, KITE_TESTNET } from "@/lib/kite/config";
import { verifyOrder } from "@/lib/payments/order-token";
import { mockSellerPayTo } from "@/lib/payments/testnet-rail";
import { SELLERS } from "@/lib/market/catalog";

const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://facilitator.pieverse.io/v2";

const resourceServer = new x402ResourceServer(new HTTPFacilitatorClient({ url: FACILITATOR_URL })).register(
  KITE_TESTNET.caip2,
  new ExactEvmScheme(),
);

function orderFrom(url: string) {
  return verifyOrder(new URL(url).searchParams.get("order"));
}

const paidHandler = withX402(
  async (req: NextRequest) => {
    const order = orderFrom(req.url)!;
    return NextResponse.json({
      ok: true,
      seller: `${order.sellerId} (mock seller)`,
      orderId: order.orderId,
      item: order.itemName,
      paidUsdEquivalent: order.priceCents / 100,
      paidOnTestnet: `${formatTestnetAmount(centsToTestnetUnits(order.priceCents))} ${KITE_TESTNET.asset.symbol}`,
    });
  },
  {
    accepts: {
      scheme: "exact",
      network: KITE_TESTNET.caip2,
      maxTimeoutSeconds: 120,
      payTo: (ctx) => {
        const order = orderFrom(ctx.adapter.getUrl());
        return mockSellerPayTo(order?.sellerId ?? "") ?? "";
      },
      price: (ctx) => {
        const order = orderFrom(ctx.adapter.getUrl());
        return {
          asset: KITE_TESTNET.asset.address,
          amount: centsToTestnetUnits(order?.priceCents ?? 0).toString(),
          extra: { name: KITE_TESTNET.asset.eip712Name, version: KITE_TESTNET.asset.eip712Version },
        };
      },
    },
    description: "Melit mock seller checkout (KiteAI testnet, pieUSD)",
    mimeType: "application/json",
  },
  resourceServer,
);

export async function GET(req: NextRequest, ctx: RouteContext<"/api/sellers/[sellerId]/checkout">) {
  const { sellerId } = await ctx.params;
  if (!SELLERS.some((s) => s.id === sellerId)) {
    return NextResponse.json({ error: "Unknown mock seller" }, { status: 404 });
  }
  const order = orderFrom(req.url);
  if (!order || order.sellerId !== sellerId) {
    return NextResponse.json({ error: "Missing, expired or invalid Melit order token" }, { status: 400 });
  }
  if (!mockSellerPayTo(sellerId)) {
    return NextResponse.json({ error: "This mock seller has no testnet wallet configured (MOCK_SELLER_PAYTO)" }, { status: 503 });
  }
  return paidHandler(req);
}
