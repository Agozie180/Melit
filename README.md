# Melit

**A shopping agent with a budget, a negotiator's brain, and a savings vault.**

Melit is for people who don't know how to haggle or how to save. You give it a weekly budget ($300). It negotiates the price before it buys, buys only when the deal is good and the budget allows it, and moves what it saved into a visible Savings Vault. It can never spend more than $300 in any rolling 7-day window, and that rule lives in server code, not in a prompt.

Built for **SERV Hackathon Edition 02, Kite track**: "agents with a verifiable identity and spending limits you control, so they can shop, book and pay on your behalf, safely."

## The problem

Most people pay the list price. They don't negotiate because it's awkward, and they don't save because the money leaks out a little at a time. Shopping agents could fix both, but handing an AI your card is scary. You need an agent that bargains hard, explains every decision, and physically can't blow your budget.

## What Melit does

1. **Agent identity.** The Melit Agent ID card shows the agent's identifier, spending limit and status. It says **Passport sandbox** only when `kpass` confirms a registered sandbox agent at that moment. Otherwise it shows the agent's KiteAI testnet wallet ("not Passport-verified") or a labelled simulated ID.
2. **Negotiates before it buys.** Each round, SERV Reasoning decides whether to offer, accept or walk away, and returns the reasoning steps, which are shown in the UI.
3. **Buys only good deals.** The deal must be at or under your max price and pass the Spend Guard.
4. **Saves the difference.** `saved = list price - paid price` goes into the Savings Vault.
5. **Hard weekly cap.** The Spend Guard blocks any payment that would push the last 7 days over $300, with a plain-English reason.
6. **Pays on KiteAI testnet.** Approved purchases are paid in pieUSD on KiteAI testnet (chain 2368). It tries the Kite Passport sandbox first and falls back to a direct testnet transfer. Each ledger row records the rail that paid and links the transaction on KiteScan.

## How SERV Reasoning is used

SERV Reasoning is OpenServ's reasoning layer. It's wire-compatible with the OpenAI Chat Completions API, so Melit calls it with plain `fetch` (`lib/adapters/reasoning.ts`):

```
POST https://inference-api.openserv.ai/v1/chat/completions
Authorization: Bearer $OPENSERV_API_KEY
{
  "model": "gpt-5.4-mini",
  "reasoning_effort": "low",
  "messages": [{ "role": "system", ... }, { "role": "user", ... }],
  "response_format": { "type": "json_schema", "json_schema": { "strict": true, ... } }
}
```

- **Every negotiation decision** is a SERV call. The model receives the item, list price, market reference price, the current ask, the negotiation history, the remaining weekly budget, your max price and your priority ("save more" or "buy fast"). It never receives the seller's hidden floor price.
- It must return strict JSON: `{ "action": "offer" | "accept" | "walk", "offerPrice": number, "reasoning": string[], "confidence": number }`.
- Output is validated with **zod**. If the call fails, times out, refuses, or returns JSON that doesn't validate, a simple heuristic takes that round and the UI labels it **Fallback heuristic** together with the reason.
- Following SERV's "Day One" guidance, the model does the judgment and code does the arithmetic and hard limits. Ceilings and gaps are pre-computed in the prompt, and after the model decides, code guardrails clamp offers to your max price and remaining budget. Any adjustment is shown in the reasoning trail.

## Architecture

```
app/
  page.tsx                  Dashboard (client): agent card, budget gauge, vault, form, feed, ledger
  api/agent/route.ts        GET  identity, reasoning status, public catalog
  api/negotiate/route.ts    POST stream (NDJSON) of negotiation rounds, deal, guard result, receipt
  api/overspend/route.ts    POST demo: try to buy something that doesn't fit the weekly budget
  api/sellers/[sellerId]/checkout/route.ts
                            Mock seller x402 checkout (@x402/next, exact scheme, pieUSD on eip155:2368)
lib/
  market/catalog.ts         4 mock sellers, 11 items, hidden floor prices (server-only)
  market/seller.ts          Deterministic seller rules (no LLM): accept at floor, shrinking counters, walk after 4 rounds
  negotiation/negotiator.ts SERV prompt + JSON schema, zod validation, fallback heuristic, guardrails
  negotiation/run.ts        Negotiate -> deal check -> Spend Guard -> payment -> signed ledger entry
  guard/spend-guard.ts      The pure Spend Guard function
  server/ledger.ts          Ledger verification (HMAC) + authorizeSpend()
  adapters/reasoning.ts     ReasoningAdapter  -> SERV Reasoning
  adapters/identity.ts      Identity: Passport sandbox (confirmed via kpass) > testnet wallet > simulated
  kite/config.ts            KiteAI testnet constants (chain 2368, pieUSD, KiteScan) and the testnet scale
  payments/router.ts        Tries rails in order with explicit no-fallback cases
  payments/kpass-rail.ts    Rail 1: `kpass session execute` as a child process (argv array, no shell)
  payments/testnet-rail.ts  Rail 2: viem ERC-20 pieUSD transfer from AGENT_PRIVATE_KEY
  payments/offline-rails.ts Recorded-receipt replay and simulated receipts (both move no money)
  payments/order-token.ts   Signed orders: the seller checkout only charges Guard-approved orders
scripts/kite-setup.mjs      Guided `kpass` sandbox setup (login check, faucet, agent, 7-day session)
tests/                      vitest: spend guard, ledger tampering, sellers, negotiator, payment rails
```

Reasoning, identity and payments each sit behind an interface, so they can be swapped without touching the negotiation or guard logic.

**No database.** The ledger lives in the browser's localStorage and is sent with every request. The server never trusts a client total. It recomputes the weekly sum from the entries on every spend.

## How the Spend Guard works

`lib/guard/spend-guard.ts` is a pure function that runs before **every** payment, including the overspend demo, which deliberately bypasses Melit's own negotiation guardrails to show that the last line of defense still holds.

- Rule: `sum(purchases in the last 7 days) + this purchase <= $300.00`, or the payment is blocked with a human-readable reason.
- All money is integer cents, so "exactly $300.00" passes and "$300.01" is blocked.
- Rolling window: an entry counts while it is less than 7 days old.
- Future-dated entries still count, and negative or garbage amounts can only make the guard stricter.
- Before the guard runs, `lib/server/ledger.ts` verifies the ledger. Every entry is HMAC-signed by the server when a purchase is approved. If a client lowers an amount, back-dates a purchase or forges an entry, the signature breaks and spending is frozen. Extra fields like `weeklySpent: 0` are stripped and ignored.

Tests (`npm test`) cover exactly at the cap, one cent over, the window rolling forward, future-dated entries, invalid amounts, a client-supplied fake total, an edited amount, a back-dated entry, a forged signature and a malformed ledger.

**Known limitation (honest):** without server-side storage, a user can delete their own localStorage ledger and start a fresh week. That only "attacks" their own budget, and the Reset demo button does exactly this on purpose. A production version would persist the ledger server-side, or enforce the limit at the wallet level with a Kite Passport spending session.

## Payments on KiteAI testnet

Everything runs on **KiteAI testnet** (chain ID 2368, RPC `https://rpc-testnet.gokite.ai/`, explorer `https://testnet.kitescan.ai`) using free **pieUSD** test tokens. There is no mainnet configuration in the code. Amounts are scaled down so a faucet drip covers a whole week: by default $1.00 of price = 0.01 pieUSD, so the $300 weekly cap is 3 pieUSD on chain (`MELIT_TESTNET_SCALE`).

The order of checks for every purchase:

1. **Spend Guard first.** It must approve the exact amount, or nothing else runs (`lib/negotiation/run.ts`).
2. **Rail 1: Kite Passport sandbox.** The server runs `kpass sandbox status`, and refuses to continue unless kpass confirms sandbox mode. It then runs `kpass session execute --method GET --url <mock seller checkout> --idempotency-key <order id>` as a child process with an explicit argument list (no shell). The mock seller's checkout is a real x402 endpoint built with `@x402/next`: it answers HTTP 402 with exact-scheme pieUSD requirements on `eip155:2368` and settles through the Pieverse facilitator. It only charges orders signed by Melit after Guard approval. The approved Passport session (3 pieUSD over 7 days) is a **second** limit layer.
3. **Rail 2: direct testnet transfer.** If Rail 1 fails (not logged in, not sandbox, `host_not_in_executable_catalog`, unreachable seller, and so on), Melit sends an ERC-20 transfer from `AGENT_PRIVATE_KEY` with viem. It pays with pieUSD if the wallet holds enough, otherwise with the test USDT that https://faucet.gokite.ai hands out (`0x0fF5…7e63`); pieUSD itself can only be minted by its owner. Before sending, it confirms the RPC reports chain 2368 and that the wallet has KITE for gas, then waits for the receipt.
4. **Optional labelled fallback.** With `MELIT_SIMULATED_FALLBACK=1`, if every real rail fails (for example, the public demo wallet ran dry), Melit issues a receipt labelled **Simulated payment** that says no money moved and lists why each real rail failed.

Two deliberate exceptions to "fall back for any reason":

- If the Passport session refuses the payment (`session_total_exceeded`, `payment_cap_exceeded` and similar), Melit does **not** fall back. Routing around the session cap would defeat the second limit layer.
- If the Passport outcome is unknown (exit code 7, `payment_outcome_pending`), Melit does **not** fall back either, because the first payment may still land and falling back could pay twice.

If every rail fails, the purchase fails, the feed shows each rail's error, and no ledger entry is written.

Each ledger entry stores the rail that paid, the tx hash and a KiteScan link, and all of these are covered by the server's HMAC signature.

**Kite Passport status (Nov 15, 2026):** with a fresh Passport account in sandbox mode, `kpass agent register` aborts with `sandbox mode mismatch: server reported X-Kite-Mode="live" for a sandbox request`, and `kpass faucet drop` answers "disabled on production". kpass refuses to act rather than touch live data, so Rail 1 currently fails and Melit falls back to Rail 2. The Rail 1 error is shown in each receipt's attempt trail. Once Kite's backend serves sandbox mode, `npm run kite:setup` completes and Rail 1 pays first with no code change.

**Why a public seller URL:** with `kpass session execute`, the Passport *backend* calls the seller URL and settles the payment, so the mock seller checkout must be reachable from the internet (`SELLER_BASE_URL`, for example your Vercel deploy). A `localhost` seller can't be paid through Rail 1, so those payments use Rail 2.

**Demo video vs deployed site:** kpass needs a local terminal and a passkey, so record Passport payments from a local server. The deployed Vercel site can't run kpass, but it can run Rail 2. The live demo at https://melit.vercel.app uses a throwaway testnet wallet at `MELIT_TESTNET_SCALE=0.001`, so a $300 week costs 0.3 test tokens, and `MELIT_SIMULATED_FALLBACK=1` for when the wallet runs dry. With `MELIT_PAYMENT_MODE=recorded` it replays real receipts from `data/recorded-receipts.json` (written locally with `MELIT_RECORD_RECEIPTS=1`), labelled **Recorded receipt (replay)** with "No new payment was made".

## What's simulated vs real

| Part | Status |
| --- | --- |
| SERV Reasoning negotiation decisions | **Real** when `OPENSERV_API_KEY` is set. Rounds that use the fallback are labelled. |
| Spend Guard and ledger signing | **Real**, enforced in server code, unit tested. |
| Sellers and marketplace | **Mock sellers**: four labelled sellers with deterministic rules. Only their checkout endpoint is real x402. |
| Agent identity | **Kite Passport sandbox** only when kpass confirms it live. Otherwise **testnet wallet** (a real key, not Passport-verified) or **Simulated**. |
| Payments, Rail 1 | **Real testnet** payments through the Kite Passport sandbox when you've logged in, approved a session and set `SELLER_BASE_URL`. |
| Payments, Rail 2 | **Real testnet** pieUSD transfers when `AGENT_PRIVATE_KEY` holds testnet KITE (gas) and pieUSD. |
| Recorded / simulated receipts | **No money moves.** Shown as "Recorded receipt (replay)" or "Simulated payment". |

The UI never shows a simulated or recorded payment as a new real payment, and never claims Passport verification that kpass didn't confirm.

## Revenue model

Melit keeps **15% of the money it saves you**; you keep **85%**. If Melit doesn't save you anything, it earns nothing. The Savings Vault shows the split live.

Why this works: the incentive is aligned (Melit only wins when you do), there's no subscription to justify, and the fee scales with purchase volume. Later options: merchant-side lead fees for sellers that accept agent negotiation, and a premium tier with higher caps and multi-seller comparison.

## Setup

```bash
git clone https://github.com/Agozie180/Melit melit && cd melit
npm install
cp .env.example .env.local     # set OPENSERV_API_KEY (from https://console.openserv.ai/)
npm run dev                    # http://localhost:3000
npm test                       # Spend Guard, negotiation and payment-rail tests
```

Without a key the app still runs, but every round is labelled **Fallback heuristic** and a banner says SERV isn't configured. With no payment rail configured, payments are **simulated** and labelled that way.

### Testnet payments (local)

1. **Rail 2 (quickest).** Create a throwaway wallet that you'll only use on testnet. Claim KITE (gas) and test USDT for it at https://faucet.gokite.ai, then set `AGENT_PRIVATE_KEY` and `MOCK_SELLER_PAYTO` in `.env.local`. Check funding with `npm run testnet:balance -- <address>`.
2. **Rail 1 (Kite Passport sandbox).** Install the CLI (`curl -fsSL https://cli.gokite.ai/install.sh | bash`) and run `kpass login`. Then run `npm run kite:setup`, which switches on sandbox mode, requests faucet pieUSD, registers the agent and creates the 7-day "Melit weekly budget" session. Approve the printed URL with your passkey. Then set `MELIT_KPASS=1`, `KPASS_SESSION_ID` and `SELLER_BASE_URL` (a public deploy of this app).
3. Optionally set `MELIT_RECORD_RECEIPTS=1` to save real receipts to `data/recorded-receipts.json` for the deployed replay.

### Deploy to Vercel

1. Import the repo in Vercel (framework preset: Next.js).
2. Set `OPENSERV_API_KEY`. For live testnet payments also set `AGENT_PRIVATE_KEY` (throwaway testnet key, as a *sensitive* variable), `MOCK_SELLER_PAYTO`, `MELIT_PAYMENT_MODE=testnet`, `MELIT_TESTNET_SCALE=0.001`, `MELIT_SIMULATED_FALLBACK=1` and `SELLER_BASE_URL`. Without a key, Vercel defaults to `recorded` mode: it replays committed receipts, or issues labelled simulated receipts if there are none.
3. Deploy. The negotiation route streams its response and allows up to 120 s per request.

Never put a mainnet key or a funded personal wallet in any env var. `AGENT_PRIVATE_KEY` is for a throwaway testnet wallet only.

## Roadmap

- Get the mock seller listed in the Kite catalog so Rail 1 never hits `host_not_in_executable_catalog`.
- A server-side ledger, so the weekly cap survives a cleared browser.
- Real merchant integrations and multi-seller comparison.

## License

[MIT](LICENSE)
