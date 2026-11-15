#!/usr/bin/env node
// Prints KITE (gas), pieUSD and faucet USDT balances on KiteAI testnet.
//   npm run testnet:balance -- 0xYourAddress

import { createPublicClient, erc20Abi, formatEther, http, isAddress } from "viem";

const address = process.argv[2];
if (!address || !isAddress(address)) {
  console.error("Usage: npm run testnet:balance -- <0x address>");
  process.exit(1);
}

const client = createPublicClient({ transport: http(process.env.KITE_TESTNET_RPC_URL || "https://rpc-testnet.gokite.ai/") });
const tokens = [
  ["pieUSD", "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A"],
  ["USDT", "0x0fF5393387ad2f9f691FD6Fd28e07E3969e27e63"],
];

console.log(`KiteAI testnet balances for ${address}`);
console.log(`  KITE    ${formatEther(await client.getBalance({ address }))}`);
for (const [symbol, token] of tokens) {
  const balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  console.log(`  ${symbol.padEnd(7)} ${formatEther(balance)}`);
}
console.log(`  https://testnet.kitescan.ai/address/${address}`);
