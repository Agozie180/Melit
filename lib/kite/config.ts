// KiteAI testnet constants (docs.gokite.ai/kite-chain/1-getting-started/network-information,
// pieUSD from gokite-ai/kite-x402-services via BrKDDD/kite-x402-hono src/networks.ts).
// Melit only ever pays on testnet; there is no mainnet configuration in this codebase.

export const KITE_TESTNET = {
  chainId: 2368,
  caip2: "eip155:2368",
  name: "KiteAI Testnet",
  rpcUrl: "https://rpc-testnet.gokite.ai/",
  explorerUrl: "https://testnet.kitescan.ai",
  faucetUrl: "https://faucet.gokite.ai",
  asset: {
    symbol: "pieUSD",
    address: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A" as `0x${string}`,
    decimals: 18,
    eip712Name: "pieUSD",
    eip712Version: "1",
  },
} as const;

export const PIEUSD_DECIMALS = KITE_TESTNET.asset.decimals;

export function explorerTxUrl(txHash: string): string {
  return `${KITE_TESTNET.explorerUrl}/tx/${txHash}`;
}

/**
 * Prices in the demo are dollars; on testnet Melit pays a small, scaled-down amount so a
 * faucet drip covers a whole week. Default: $1.00 of price = 0.01 pieUSD, so the $300 weekly
 * cap is 3 pieUSD on chain. Override with MELIT_TESTNET_SCALE (e.g. "1" for 1:1).
 */
export function testnetScale(): number {
  const raw = Number(process.env.MELIT_TESTNET_SCALE ?? "0.01");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.01;
}

/** Integer cents -> pieUSD base units (18 decimals), computed with integer math. */
export function centsToTestnetUnits(cents: number, scale = testnetScale()): bigint {
  // scale is applied in millionths to keep everything integral.
  const scaleMicros = BigInt(Math.round(scale * 1_000_000));
  // cents / 100 dollars * scale * 10^18  ==  cents * scaleMicros * 10^(18-2-6)
  return BigInt(Math.round(cents)) * scaleMicros * 10n ** BigInt(PIEUSD_DECIMALS - 8);
}

export function formatTestnetAmount(units: bigint): string {
  const base = 10n ** BigInt(PIEUSD_DECIMALS);
  const whole = units / base;
  const frac = (units % base).toString().padStart(PIEUSD_DECIMALS, "0").replace(/0+$/, "").slice(0, 6);
  return frac ? `${whole}.${frac}` : `${whole}`;
}
