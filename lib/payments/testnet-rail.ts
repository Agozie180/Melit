// SERVER-ONLY. Rail 2: a direct pieUSD (or faucet USDT) payment on KiteAI testnet from
// AGENT_PRIVATE_KEY. The key must be a throwaway testnet key, kept in .env.local / Vercel env,
// never committed.
//
// Preferred path is gasless: the agent signs an EIP-3009 transferWithAuthorization for pieUSD
// (x402 "exact" scheme) and the Pieverse x402 facilitator submits it, paying the KITE gas.
// Fallback path: a plain ERC-20 transfer, which needs KITE for gas.

import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentRequirements } from "@x402/core/types";
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { WEEKLY_CAP_CENTS } from "../money";
import { centsToTestnetUnits, explorerTxUrl, formatTestnetAmount, KITE_TESTNET, RAIL2_TOKENS, type TestnetToken } from "../kite/config";
import { RailError, type PaymentOrder, type PaymentRail, type PaymentReceipt } from "./types";

export const kiteTestnet = defineChain({
  id: KITE_TESTNET.chainId,
  name: KITE_TESTNET.name,
  nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
  rpcUrls: { default: { http: [KITE_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "KiteScan", url: KITE_TESTNET.explorerUrl } },
  testnet: true,
});

export const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://facilitator.pieverse.io/v2";

export function mockSellerPayTo(sellerId: string): `0x${string}` | undefined {
  const specific = process.env[`MOCK_SELLER_PAYTO_${sellerId.toUpperCase()}`];
  const value = specific || process.env.MOCK_SELLER_PAYTO;
  return value && isAddress(value) ? value : undefined;
}

function parseKey(raw: string | undefined): Hex | undefined {
  if (!raw) return undefined;
  const key = (raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`) as Hex;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? key : undefined;
}

export function agentTestnetAddress(): `0x${string}` | undefined {
  const key = parseKey(process.env.AGENT_PRIVATE_KEY);
  return key ? privateKeyToAccount(key).address : undefined;
}

type PublicClient = ReturnType<typeof createPublicClient>;
type Settled = { txHash: Hex; token: TestnetToken; note?: string };

export class DirectTestnetRail implements PaymentRail {
  readonly id = "direct-testnet" as const;

  async pay(order: PaymentOrder): Promise<Omit<PaymentReceipt, "attempts">> {
    const key = parseKey(process.env.AGENT_PRIVATE_KEY);
    if (!key) throw new RailError("AGENT_PRIVATE_KEY is not set (or not a 32-byte hex key).");
    const account = privateKeyToAccount(key);
    const configuredPayee = mockSellerPayTo(order.sellerId);
    const payee = configuredPayee ?? account.address;

    const transport = http(process.env.KITE_TESTNET_RPC_URL || KITE_TESTNET.rpcUrl, { timeout: 20_000 });
    const publicClient = createPublicClient({ chain: kiteTestnet, transport });
    const chainId = await publicClient.getChainId().catch((e: Error) => {
      throw new RailError(`Kite testnet RPC unreachable: ${e.message}`);
    });
    if (chainId !== KITE_TESTNET.chainId) {
      throw new RailError(`RPC reports chain ${chainId}, expected KiteAI testnet ${KITE_TESTNET.chainId}. Not sending.`);
    }

    const amount = centsToTestnetUnits(order.priceCents);
    const [balances, gas] = await Promise.all([
      Promise.all(
        RAIL2_TOKENS.map((token) =>
          publicClient
            .readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })
            .then((balance) => ({ token, balance }))
            .catch(() => ({ token, balance: 0n })),
        ),
      ),
      publicClient.getBalance({ address: account.address }),
    ]);

    const pie = balances.find((b) => b.token.symbol === KITE_TESTNET.asset.symbol);
    let settled: Settled;
    if (pie && pie.balance >= amount) {
      settled = await settleGasless(account, publicClient, payee, amount, order);
    } else {
      const funded = balances.find((b) => b.balance >= amount);
      if (!funded) {
        const held = balances.map((b) => `${formatTestnetAmount(b.balance)} ${b.token.symbol}`).join(", ");
        throw new RailError(
          `Agent wallet ${account.address} holds ${held}; needs ${formatTestnetAmount(amount)} of one of them. Top up at ${KITE_TESTNET.faucetUrl}.`,
        );
      }
      if (gas === 0n) {
        throw new RailError(
          `Agent wallet ${account.address} has ${funded.token.symbol} but no KITE for gas. Top up at ${KITE_TESTNET.faucetUrl}.`,
        );
      }
      settled = await plainTransfer(account, publicClient, transport, funded.token, payee, amount);
    }

    const notes = [settled.note, configuredPayee ? undefined : "No mock seller wallet configured (MOCK_SELLER_PAYTO), so the agent paid its own address."];
    return {
      receiptId: `tx_${settled.txHash.slice(2, 14)}`,
      rail: this.id,
      amountCents: order.priceCents,
      testnetAmount: formatTestnetAmount(amount),
      asset: settled.token.symbol,
      payee,
      network: KITE_TESTNET.caip2,
      txHash: settled.txHash,
      explorerUrl: explorerTxUrl(settled.txHash),
      settledAt: Date.now(),
      note: notes.filter(Boolean).join(" ") || undefined,
    };
  }
}

async function settleGasless(
  account: PrivateKeyAccount,
  publicClient: PublicClient,
  payee: `0x${string}`,
  amount: bigint,
  order: PaymentOrder,
): Promise<Settled> {
  const asset = KITE_TESTNET.asset;
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: KITE_TESTNET.caip2,
    asset: asset.address,
    amount: amount.toString(),
    payTo: payee,
    maxTimeoutSeconds: 120,
    extra: { name: asset.eip712Name, version: asset.eip712Version },
  };
  // The x402 client's own spend control is a further cap: never sign more than the weekly cap.
  const client = x402Client.fromConfig({
    schemes: [],
    spendControls: {
      allowedAssets: [
        { network: KITE_TESTNET.caip2, asset: asset.address, maxAmountPerPayment: centsToTestnetUnits(WEEKLY_CAP_CENTS).toString() },
      ],
    },
  });
  registerExactEvmScheme(client, { signer: toClientEvmSigner(account, publicClient as never) });

  let payload;
  try {
    payload = await client.createPaymentPayload({
      x402Version: 2,
      resource: {
        url: `https://melit.mock/sellers/${order.sellerId}/orders/${order.orderId}`,
        description: `Melit mock seller order: ${order.itemName}`,
        mimeType: "application/json",
      },
      accepts: [requirements],
    });
  } catch (e) {
    throw new RailError(`Could not sign the pieUSD authorization: ${(e as Error).message}`);
  }

  const facilitator = new HTTPFacilitatorClient({ url: X402_FACILITATOR_URL });
  const verified = await facilitator.verify(payload, requirements).catch((e: Error) => {
    throw new RailError(`x402 facilitator verify failed: ${e.message}`);
  });
  if (!verified.isValid) {
    throw new RailError(`x402 facilitator rejected the authorization: ${verified.invalidReason ?? "invalid"} ${verified.invalidMessage ?? ""}`.trim());
  }

  // From here the signed authorization may be submitted, so nothing past this point falls back.
  const result = await facilitator.settle(payload, requirements).catch((e: Error) => {
    throw new RailError(`x402 settlement outcome unknown (${e.message}); not retrying to avoid paying twice.`, false);
  });
  if (!result.success || !result.transaction) {
    throw new RailError(`x402 settlement failed: ${result.errorReason ?? "unknown"} ${result.errorMessage ?? ""}`.trim(), false);
  }
  const txHash = result.transaction as Hex;
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 }).catch(() => null);
  if (!receipt) throw new RailError(`Settlement ${txHash} was submitted but not confirmed in time; not retrying.`, false);
  if (receipt.status !== "success") throw new RailError(`Settlement ${txHash} reverted on chain.`, false);

  return {
    txHash,
    token: RAIL2_TOKENS[0],
    note: "Gasless: the agent signed an EIP-3009 pieUSD authorization and the Pieverse x402 facilitator submitted it on KiteAI testnet.",
  };
}

async function plainTransfer(
  account: PrivateKeyAccount,
  publicClient: PublicClient,
  transport: ReturnType<typeof http>,
  token: TestnetToken,
  payee: `0x${string}`,
  amount: bigint,
): Promise<Settled> {
  const wallet = createWalletClient({ account, chain: kiteTestnet, transport });
  let txHash: Hex;
  try {
    txHash = await wallet.writeContract({ address: token.address, abi: erc20Abi, functionName: "transfer", args: [payee, amount] });
  } catch (e) {
    throw new RailError(`Testnet transfer was not sent: ${(e as Error).message.split("\n")[0]}`);
  }

  // Once a hash exists the transfer may land, so failures past this point must not fall back.
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 }).catch(() => null);
  if (!receipt) throw new RailError(`Testnet transfer ${txHash} was sent but not confirmed in time; not retrying.`, false);
  if (receipt.status !== "success") throw new RailError(`Testnet transfer ${txHash} reverted.`, false);
  return { txHash, token };
}
