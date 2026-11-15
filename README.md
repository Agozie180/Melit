# Melit

**A shopping agent with a budget, a negotiator's brain, and a savings vault.**

Melit is for people who don't know how to haggle or how to save. You give it a weekly budget ($300). It negotiates the price before it buys, buys only when the deal is good and the budget allows it, and moves what it saved into a visible Savings Vault. It can never spend more than $300 in any rolling 7-day window, and that rule lives in server code, not in a prompt.

Built for **SERV Hackathon Edition 02, Kite track**: "agents with a verifiable identity and spending limits you control, so they can shop, book and pay on your behalf, safely."

## The problem

Most people pay the list price. They don't negotiate because it's awkward, and they don't save because the money leaks out a little at a time. Shopping agents could fix both, but handing an AI your card is scary. You need an agent that bargains hard, explains every decision, and physically can't blow your budget.

## What Melit does

1. **Verified agent identity.** A Melit Agent ID card shows the agent's identifier, spending limit and status. In this build it is labelled *Simulated (Kite Passport-ready)*.
2. **Negotiates before it buys.** Each round, SERV Reasoning decides whether to offer, accept or walk away, and returns the reasoning steps, which are shown in the UI.
3. **Buys only good deals.** The deal must be at or under your max price and pass the Spend Guard.
4. **Saves the difference.** `saved = list price - paid price` goes into the Savings Vault.
5. **Hard weekly cap.** The Spend Guard blocks any payment that would push the last 7 days over $300, with a plain-English reason.

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
lib/
  market/catalog.ts         4 mock sellers, 11 items, hidden floor prices (server-only)
  market/seller.ts          Deterministic seller rules (no LLM): accept at floor, shrinking counters, walk after 4 rounds
  negotiation/negotiator.ts SERV prompt + JSON schema, zod validation, fallback heuristic, guardrails
  negotiation/run.ts        Negotiate -> deal check -> Spend Guard -> payment -> signed ledger entry
  guard/spend-guard.ts      The pure Spend Guard function
  server/ledger.ts          Ledger verification (HMAC) + authorizeSpend()
  adapters/reasoning.ts     ReasoningAdapter  -> SERV Reasoning
  adapters/identity.ts      IdentityAdapter   -> simulated, Kite Passport-ready
  adapters/payments.ts      PaymentAdapter    -> simulated, x402/Kite-ready
tests/                      vitest: spend guard, ledger tampering, sellers, negotiator, end to end
```

The three integrations sit behind adapter interfaces (`reasoning`, `identity`, `payments`) so a real Kite Passport or x402 implementation can be swapped in without touching the negotiation or guard logic.

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

## What's simulated vs real

| Part | Status |
| --- | --- |
| SERV Reasoning negotiation decisions | **Real** when `OPENSERV_API_KEY` is set. Rounds that use the fallback are labelled. |
| Spend Guard and ledger signing | **Real**, enforced in server code, unit tested. |
| Sellers and marketplace | **Mock**: four labelled test sellers with deterministic rules. |
| Agent identity (Kite Passport) | **Simulated**, shown as "Simulated (Kite Passport-ready)". Kite Passport needs the `kpass` CLI, a user passkey and a funded USDC wallet to approve a spending session, which doesn't fit a stateless demo. |
| Payments (x402 on Kite) | **Simulated**. Receipts are `sim_…` ids, with no transaction hash and no money moved. Real x402 needs a seller endpoint that returns HTTP 402, an EIP-3009 signature and a facilitator. The mock sellers have no wallets. |

The UI never shows a simulated identity or payment as real.

## Revenue model

Melit keeps **15% of the money it saves you**; you keep **85%**. If Melit doesn't save you anything, it earns nothing. The Savings Vault shows the split live.

Why this works: the incentive is aligned (Melit only wins when you do), there's no subscription to justify, and the fee scales with purchase volume. Later options: merchant-side lead fees for sellers that accept agent negotiation, and a premium tier with higher caps and multi-seller comparison.

## Setup

```bash
git clone <this repo> melit && cd melit
npm install
cp .env.example .env.local     # then set OPENSERV_API_KEY (from https://console.openserv.ai/)
npm run dev                    # http://localhost:3000
npm test                       # Spend Guard + negotiation tests
```

Without a key the app still runs, but every round is labelled **Fallback heuristic** and a banner says SERV isn't configured.

### Deploy to Vercel

1. Push this repo to GitHub and import it in Vercel (framework preset: Next.js).
2. Add the environment variable `OPENSERV_API_KEY`. Nothing else is required.
3. Deploy. The negotiation route streams its response and allows up to 120 s per request.

Optional env vars: `SERV_MODEL` (default `gpt-5.4-mini`) and `MELIT_LEDGER_SECRET` (defaults to a value derived from the API key).

## Roadmap

- `KitePassportIdentityAdapter`: read the agent's Passport and the user-approved spending session, and show "Verified".
- `KiteX402PaymentAdapter`: pay x402 endpoints through the approved session (USDC.e on Kite mainnet, pieUSD on testnet).
- A server-side ledger, so the weekly cap survives a cleared browser.
- Real merchant integrations and multi-seller comparison.

## License

[MIT](LICENSE)
