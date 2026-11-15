// SERVER-ONLY. Rail 2: a plain ERC-20 pieUSD transfer on KiteAI testnet from AGENT_PRIVATE_KEY.
// The key must be a throwaway testnet key, kept in .env.local / Vercel env, never committed.

import { createPublicClient, createWalletClient, defineChain, erc20Abi, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { centsToTestnetUnits, explorerTxUrl, formatTestnetAmount, KITE_TESTNET, RAIL2_TOKENS } from "../kite/config";
import { RailError, type PaymentOrder, type PaymentRail, type PaymentReceipt } from "./types";

export const kiteTestnet = defineChain({
  id: KITE_TESTNET.chainId,
  name: KITE_TESTNET.name,
  nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
  rpcUrls: { default: { http: [KITE_TESTNET.rpcUrl] } },
  blockExplorers: { default: { name: "KiteScan", url: KITE_TESTNET.explorerUrl } },
  testnet: true,
});

export function mockSellerPayTo(sellerId: string): `0x${string}` | undefined {
  const specific = process.env[`MOCK_SELLER_PAYTO_${sellerId.toUpperCase()}`];
  const value = specific || process.env.MOCK_SELLER_PAYTO;
  return value && isAddress(value) ? value : undefined;
}

function parseKey(raw: string | undefined): Hex | undefined {
  if (!raw) return undefined;
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
  return /^0x[0-9a-fA-F]{64}$/.test(key) ? key : undefined;
}

export function agentTestnetAddress(): `0x${string}` | undefined {
  const key = parseKey(process.env.AGENT_PRIVATE_KEY);
  return key ? privateKeyToAccount(key).address : undefined;
}

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
    const balances = await Promise.all(
      RAIL2_TOKENS.map((token) =>
        publicClient
          .readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })
          .then((balance) => ({ token, balance }))
          .catch(() => ({ token, balance: 0n })),
      ),
    );
    const funded = balances.find((b) => b.balance >= amount);
    if (!funded) {
      const held = balances.map((b) => `${formatTestnetAmount(b.balance)} ${b.token.symbol}`).join(", ");
      throw new RailError(
        `Agent wallet ${account.address} holds ${held}; needs ${formatTestnetAmount(amount)} of one of them. Top up at ${KITE_TESTNET.faucetUrl}.`,
      );
    }
    const token = funded.token;
    const gas = await publicClient.getBalance({ address: account.address });
    if (gas === 0n) {
      throw new RailError(`Agent wallet ${account.address} has no KITE for gas. Top up at ${KITE_TESTNET.faucetUrl}.`);
    }

    const wallet = createWalletClient({ account, chain: kiteTestnet, transport });
    let txHash: Hex;
    try {
      txHash = await wallet.writeContract({
        address: token.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [payee, amount],
      });
    } catch (e) {
      throw new RailError(`Testnet transfer was not sent: ${(e as Error).message.split("\n")[0]}`);
    }

    // Once a hash exists the transfer may land, so failures past this point must not fall back.
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 }).catch(() => null);
    if (!receipt) {
      throw new RailError(`Testnet transfer ${txHash} was sent but not confirmed in time; not retrying.`, false);
    }
    if (receipt.status !== "success") {
      throw new RailError(`Testnet transfer ${txHash} reverted.`, false);
    }

    return {
      receiptId: `tx_${txHash.slice(2, 14)}`,
      rail: this.id,
      amountCents: order.priceCents,
      testnetAmount: formatTestnetAmount(amount),
      asset: token.symbol,
      payee,
      network: KITE_TESTNET.caip2,
      txHash,
      explorerUrl: explorerTxUrl(txHash),
      settledAt: Date.now(),
      note: configuredPayee ? undefined : "No mock seller wallet configured (MOCK_SELLER_PAYTO), so the agent paid its own address.",
    };
  }
}
