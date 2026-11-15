# Melit

**A shopping agent with a budget, a negotiator's brain, and a savings vault.**

Melit is for people who don't know how to haggle or how to save. You give it two controls, both enforced in server code before every payment. The **shopping list** decides **what** it can buy: only the items you added, at or under each item's max price, while quantity is left. The **$300 rolling weekly cap** decides **how much** it can spend. It negotiates the price before it buys, buys only when the deal is good and both controls allow it, and moves what it saved into a visible Savings Vault. (The list and the ledger are held in your browser and signed by the server, so clearing them starts over; see [Known limitation](#how-the-spend-guard-works).)

Built for **SERV Hackathon Edition 02**:

- **Kite track:** "agents with a verifiable identity and spending limits you control, so they can shop, book and pay on your behalf, safely."
- **Reppo track:** Melit learns from feedback. Its owner, the sellers and Reppo's external evaluator panel each feed back into a bounded negotiation strategy. See [Reppo track](#reppo-track-melit-learns-from-feedback).

## The problem

Most people pay the list price. They don't negotiate because it's awkward, and they don't save because the money leaks out a little at a time. Shopping agents could fix both, but handing an AI your card is scary. You need an agent that bargains hard, explains every decision, and has a hard budget check in code before every payment.

## What Melit does

1. **Agent identity.** The Melit Agent ID card shows the agent's identifier, spending limit and status. It says **Passport sandbox** only when `kpass` confirms a registered sandbox agent at that moment. Otherwise it shows the agent's KiteAI testnet wallet ("not Passport-verified") or a labelled simulated ID.
2. **Negotiates before it buys.** Each round, SERV Reasoning decides whether to offer, accept or walk away, and returns the reasoning steps, which are shown in the UI.
3. **Buys only good deals.** The deal must be at or under your max price and pass the Spend Guard.
4. **Saves the difference.** `saved = list price - paid price` goes into the Savings Vault.
5. **Shopping list (what it can buy).** You edit an allowlist of `{ name, maxPrice, quantity }`. A purchase is blocked unless that item is on the signed list, quantity is left, and the price is at or under `maxPrice`. Sellers sometimes push bundles and flash deals; Melit declines anything off the list and logs why. Adding it takes an explicit approval.
6. **Hard weekly cap (how much it can spend).** The same Spend Guard blocks any payment that would push the last 7 days over $300, with a plain-English reason.
7. **Pays on KiteAI testnet.** Approved purchases are paid in pieUSD on KiteAI testnet (chain 2368). It tries the Kite Passport sandbox first and falls back to a direct testnet transfer. Each ledger row records the rail that paid and links the transaction on KiteScan.
8. **Learns from feedback.** A strategy profile (aggressiveness, walk-away limit, priority, notes) is sent with every negotiation. You can rate each deal, sellers review Melit, and Reppo judges each purchase. Each source changes the strategy by a small, capped step.

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

- **Every negotiation decision** is a SERV call (prompt `melit-negotiator-v3`). The model receives the item, list price, market reference price, the current ask, the negotiation history, the remaining weekly budget, your max price, your priority ("save more" or "buy fast"), and the shopping list with each row's max price and quantity remaining. It also sees seller bundles and flash deals, and is told to refuse any that are not on the list. It never receives the seller's hidden floor price.
- It must return strict JSON: `{ "action": "offer" | "accept" | "walk", "offerPrice": number, "reasoning": string[], "confidence": number }`.
- Output is validated with **zod**. If the call fails, times out, refuses, or returns JSON that doesn't validate, a simple heuristic takes that round and the UI labels it **Fallback heuristic** together with the reason.
- Following SERV's "Day One" guidance, the model does the judgment and code does the arithmetic and hard limits. Ceilings and gaps are pre-computed in the prompt, and after the model decides, code guardrails clamp offers to the shopping-list maximum, your max price and the remaining budget, and walk away if the item is off the list or the quantity is used up. Any adjustment is shown in the reasoning trail. The payment itself is checked again by the Spend Guard, which does not trust the model's answer.

## Architecture

```
app/
  page.tsx                  Dashboard (client): agent card, budget gauge, vault, shopping list, form, feed, ledger
  api/agent/route.ts        GET  identity, reasoning status, public catalog
  api/negotiate/route.ts    POST stream (NDJSON) of negotiation rounds, deal, guard result, receipt
  api/overspend/route.ts    POST demo: try to buy something that doesn't fit the weekly budget
  api/shopping-list/route.ts
                            POST the owner's list; the response is the signed allowlist
  api/sellers/[sellerId]/checkout/route.ts
                            Mock seller x402 checkout (@x402/next, exact scheme, pieUSD on eip155:2368)
lib/
  market/catalog.ts         4 mock sellers, 11 items, hidden floor prices (server-only)
  market/seller.ts          Deterministic seller rules (no LLM): accept at floor, shrinking counters, walk after 4 rounds
  negotiation/negotiator.ts SERV prompt + JSON schema, zod validation, fallback heuristic, guardrails
  negotiation/run.ts        Negotiate -> deal check -> Spend Guard (list + cap) -> payment -> signed ledger entry
  guard/spend-guard.ts      The pure Spend Guard: shopping list, then the $300 cap
  shopping/list.ts          Allowlist rows, quantity remaining, declined-offer log line
  server/shopping-list.ts   List signing (HMAC) + authorizePurchase()
  server/ledger.ts          Ledger verification (HMAC) + authorizeSpend()
  market/offers.ts          Occasional mock-seller bundles and flash deals
  adapters/reasoning.ts     ReasoningAdapter  -> SERV Reasoning
  adapters/identity.ts      Identity: Passport sandbox (confirmed via kpass) > testnet wallet > simulated
  kite/config.ts            KiteAI testnet constants (chain 2368, pieUSD, KiteScan) and the testnet scale
  payments/router.ts        Tries rails in order with explicit no-fallback cases
  payments/kpass-rail.ts    Rail 1: `kpass session execute` as a child process (argv array, no shell)
  payments/testnet-rail.ts  Rail 2: viem ERC-20 pieUSD transfer from AGENT_PRIVATE_KEY
  payments/offline-rails.ts Recorded-receipt replay and simulated receipts (both move no money)
  payments/order-token.ts   Signed orders: the seller checkout only charges Guard-approved orders
  learning/profile.ts       Strategy profile + applyBoundedUpdate (hard ranges, per-source step caps)
  learning/feedback.ts      SERV turns owner notes / Reppo verdicts into strict-JSON updates (labelled fallback)
  learning/reputation.ts    Seller reputation -> willingness and floor premium
  learning/reppo-input.ts   Synthetic, scrubbed transcript submitted to Reppo
  learning/reppo-queue.ts   One-at-a-time Reppo job queue (pure reducer)
  learning/metrics.ts       Before/after-feedback metrics
  market/reviews.ts         Deterministic, signed seller reviews (server-only, uses the hidden floor)
  adapters/reppo.ts         Reppo Eval Router client (POST/GET /api/v1/agents/evals)
app/api/feedback/route.ts   POST owner feedback or "learn from this Reppo verdict"
app/api/reppo/route.ts      POST submit a signed purchase summary to Reppo; GET /api/reppo/[id] polls it
scripts/kite-setup.mjs      Guided `kpass` sandbox setup (login check, faucet, agent, 7-day session)
tests/                      vitest: spend guard, ledger tampering, sellers, negotiator, payment rails
```

Reasoning, identity and payments each sit behind an interface, so they can be swapped without touching the negotiation or guard logic.

**No database.** The ledger and the shopping list live in the browser's localStorage and are sent with every request. The server never trusts a client total, a client "remaining quantity", or an `allowed: true` flag. It verifies the signatures, then recomputes the weekly sum and the quantity left from the entries themselves.

## How the Spend Guard works

`lib/guard/spend-guard.ts` runs before **every** payment, including the overspend demo, which deliberately bypasses Melit's own negotiation guardrails to show that the last line of defense still holds. A purchase is allowed only when every rule below passes. The first failure is the reason shown in the UI.

**What it can buy (the shopping list).** You edit the list, then save it. `POST /api/shopping-list` checks the rows and HMAC-signs them. Each row is `{ name, maxPrice, quantity }` with `maxPrice` in integer cents.

- The item's name has to match a row (case and extra punctuation ignored).
- Quantity remaining is `quantity` minus matching purchases in the signed ledger. The 7-day window does not refill it. Raise the quantity and save again if you want another.
- The price has to be at or under that row's `maxPrice`.
- Mock sellers sometimes push a bundle or a flash deal (Bundle Barn always bundles a sibling item; the flexible seller and the bluffer attach a flash deal; the firm seller only upsells the skillet when you are buying the knife). If that item is not on the list, Melit declines it in code, logs `declined: not on your list` with the reasoning, and shows **Add to list?** The button does nothing until you approve the name, max price and quantity. The model is told about the push and cannot approve the payment.

**How much it can spend (the weekly cap).**

- Rule: `sum(purchases in the last 7 days) + this purchase <= $300.00`, or the payment is blocked with a human-readable reason.
- All money is integer cents, so "exactly $300.00" passes and "$300.01" is blocked.
- Rolling window: an entry counts while it is less than 7 days old.
- Future-dated entries still count, and negative or garbage amounts can only make the guard stricter.
- Before the guard runs, `lib/server/ledger.ts` verifies the ledger and `lib/server/shopping-list.ts` verifies the list. Every ledger entry is HMAC-signed by the server when a purchase is approved. The signature covers the item name and the seller name as well as the amount, the time, and the receipt, so renaming a purchase cannot restore quantity. The list is HMAC-signed when you save it. If a client lowers an amount, back-dates a purchase, renames an item, raises a max price, adds an item, or forges a signature, spending is frozen. Entries signed by an older build, whose signature did not cover the item name, no longer verify. Reset demo once if a browser already holds a ledger from that build. Extra fields like `weeklySpent: 0`, `remaining: 9` or `allowed: true` are stripped and ignored.

Tests (`npm test`) cover exactly at the cap, one cent over, the window rolling forward, future-dated entries, invalid amounts, a client-supplied fake total, an edited amount, a back-dated entry, a forged signature and a malformed ledger. They also cover an off-list purchase, a price over the list max, a used-up quantity, a listed item that still fails the weekly cap, and a tampered list (edited max, added item, or a `remaining` field) that cannot get past the server.

**Known limitation:** without server-side storage, a user can delete their own localStorage ledger and start a fresh week, which also restores shopping-list quantities. The Reset demo button does exactly this on purpose. It does not clear the shopping list. Saving a new list is the owner's approval, so anyone who can use the demo as you can also save a wider list. On the public demo, every visitor's purchases are paid from one shared testnet agent wallet, so both controls apply per browser, not per wallet. A production version would persist the list and the ledger server-side, or enforce the limit at the wallet level with a Kite Passport spending session.

**Abuse limits on the public demo.** `/api/negotiate` (up to 4 SERV calls and one testnet payment), `/api/feedback` (one SERV call), `/api/overspend` and `/api/reppo` are rate-limited per client IP and globally (`lib/server/rate-limit.ts`, e.g. 6 negotiations per minute and 40 per hour per IP). These counters live in each serverless instance, and Vercel spreads one client's requests over several instances (visible in the `X-RateLimit-Remaining` header), so on the deployment they bound abuse per instance rather than exactly. A Vercel Firewall rate-limit rule (12 POSTs per minute per IP to those routes) is also configured, but a 24-request burst test did not trigger it, so treat it as unverified. A shared counter (e.g. Upstash Redis) is the proper fix and is on the roadmap. The testnet wallet only holds faucet pieUSD, and each payment is capped by the x402 client's spend control.

## Payments on KiteAI testnet

Everything runs on **KiteAI testnet** (chain ID 2368, RPC `https://rpc-testnet.gokite.ai/`, explorer `https://testnet.kitescan.ai`) using free **pieUSD** test tokens. There is no mainnet configuration in the code. Amounts are scaled down so a faucet drip covers a whole week: by default $1.00 of price = 0.01 pieUSD, so the $300 weekly cap is 3 pieUSD on chain (`MELIT_TESTNET_SCALE`).

The order of checks for every purchase:

1. **Spend Guard first.** The signed shopping list and the $300 cap both have to approve the exact amount, or nothing else runs (`lib/negotiation/run.ts`).
2. **Rail 1: Kite Passport sandbox.** The server runs `kpass sandbox status`, and refuses to continue unless kpass confirms sandbox mode. It then runs `kpass session execute --method GET --url <mock seller checkout> --idempotency-key <order id>` as a child process with an explicit argument list (no shell). The mock seller's checkout is a real x402 endpoint built with `@x402/next`: it answers HTTP 402 with exact-scheme pieUSD requirements on `eip155:2368` and settles through the Pieverse facilitator. It only charges orders signed by Melit after Guard approval. The approved Passport session (3 pieUSD over 7 days) is a **second** limit layer.
3. **Rail 2: direct testnet transfer.** If Rail 1 fails for any reason other than the two exceptions below (not logged in, not sandbox, `host_not_in_executable_catalog`, `sandbox_merchant_not_allowlisted`, unreachable seller, and so on), Melit pays the mock seller straight from `AGENT_PRIVATE_KEY`. It confirms the RPC reports chain 2368, then:
   - **Gasless pieUSD (default).** The agent signs an EIP-3009 `transferWithAuthorization` for pieUSD with viem (the x402 "exact" scheme, `@x402/evm`). The Pieverse x402 facilitator verifies it, submits it on KiteAI testnet and pays the KITE gas. The x402 client's own spend control refuses to sign anything above the weekly cap, which is a third limit layer.
   - **Plain ERC-20 transfer.** Used when the wallet doesn't hold enough pieUSD but has faucet test USDT and KITE for gas.

   Either way Melit waits for the on-chain receipt before recording the purchase. Once a transaction may have been submitted, it never falls back, to avoid paying twice.
4. **Optional labelled fallback.** With `MELIT_SIMULATED_FALLBACK=1`, if every real rail fails (for example, the public demo wallet ran dry), Melit issues a receipt labelled **Simulated payment** that says no money moved and lists why each real rail failed.

Two deliberate exceptions to "fall back for any reason":

- If the Passport session refuses the payment (`session_total_exceeded`, `payment_cap_exceeded` and similar), Melit does **not** fall back. Routing around the session cap would defeat the second limit layer.
- If the Passport outcome is unknown (exit code 7, `payment_outcome_pending`), Melit does **not** fall back either, because the first payment may still land and falling back could pay twice.

If every rail fails, the purchase fails, the feed shows each rail's error, and no ledger entry is written.

Each ledger entry stores the rail that paid, the tx hash and a KiteScan link, and all of these are covered by the server's HMAC signature.

**Kite Passport status (tested Nov 15, 2026):**
- **Production backend** (`passport.prod.gokite.ai`): in sandbox mode, `kpass agent register` aborts with `sandbox mode mismatch: server reported X-Kite-Mode="live"`, and the faucet is "disabled on production".
- **Staging backend** (`KPASS_BASE_URL=https://passport.staging.gokite.ai`): sandbox works end to end. Melit's agent is registered, its faucet funded the wallets with pieUSD on chain 2368, and a "Melit weekly budget" session (3 pieUSD, 7 days) was approved with a passkey.
- **What still blocks Rail 1:** `kpass session execute` against the mock seller returns `payment_target_forbidden … reason="sandbox_merchant_not_allowlisted"`. Kite only lets sessions pay allowlisted merchants, and listing a seller requires account KYC. So today every purchase genuinely tries Rail 1, records Kite's refusal in the receipt's attempt trail, and settles through Rail 2.
- Once the seller host is allowlisted, Rail 1 pays first with no code change.

**Why a public seller URL:** with `kpass session execute`, the Passport *backend* calls the seller URL and settles the payment, so the mock seller checkout must be reachable from the internet (`SELLER_BASE_URL`, for example your Vercel deploy). A `localhost` seller can't be paid through Rail 1, so those payments use Rail 2.

**Demo video vs deployed site:** kpass needs a local terminal and a passkey, so the Rail 1 attempt only runs on a local server (`MELIT_KPASS=1`). The deployed site can't run kpass, so it uses Rail 2 only. The live demo at https://melit.vercel.app makes **real KiteAI testnet payments** from a throwaway wallet funded with faucet pieUSD, at `MELIT_TESTNET_SCALE=0.001` (a $300 week = 0.3 pieUSD). `MELIT_SIMULATED_FALLBACK=1` covers the case where that wallet runs dry, and those receipts are labelled Simulated. With `MELIT_PAYMENT_MODE=recorded` the site instead replays real receipts from `data/recorded-receipts.json` (written locally with `MELIT_RECORD_RECEIPTS=1`), labelled **Recorded receipt (replay)** with "No new payment was made".

## Reppo track: Melit learns from feedback

Melit gets better at negotiating from three kinds of feedback. All of them flow into one **strategy profile** (`lib/learning/profile.ts`):

| Setting | Range | What it does |
| --- | --- | --- |
| `aggressiveness` | 0 to 1 (default 0.5) | How far below the market reference Melit opens and how slowly it concedes |
| `walkAwayThreshold` | 0.85 to 1.30 × market (default 1.05) | The most Melit will pay. Enforced as a **code guardrail**, not just a prompt hint |
| `priority` | `save` / `speed` | Standing preference; also pre-selects the request form |
| `notes` | at most 6, ≤ 140 chars each | Lessons in the owner's words |

The profile is stored in localStorage, sent with every request, clamped by the server with zod, and injected into **every SERV negotiation call** (prompt `melit-negotiator-v3`) together with Melit's seller reputation and the shopping list. The fallback heuristic uses it too. It is shown in the **Melit's strategy** card.

**Bounded updates.** Every change goes through `applyBoundedUpdate`. Whatever proposes a change (SERV, a rule or a Reppo verdict), one update can move aggressiveness by at most ±0.15 (owner), ±0.10 (Reppo) or ±0.05 (market), and the walk-away limit by ±0.05 / ±0.04 / ±0.02. It can add at most one note and remove at most one. Results are always clamped to the hard ranges. A 2,000-step fuzz test checks this, including NaN and infinite deltas.

### 1. Owner feedback
After each negotiation, the **Deals & feedback** card asks for 👍 or 👎 and an optional note. `POST /api/feedback` sends the signed deal summary, the note and the current profile to **SERV Reasoning** (prompt `melit-learner-v1`). SERV returns strict JSON `{aggressivenessDelta, walkAwayThresholdDelta, priority, addNote, removeNoteIndex, learned}`, which is validated with zod and then bounded. The `learned` sentence is shown as **What Melit learned**. If SERV fails, a keyword rule proposes the update instead and it is labelled **Fallback rule** with the reason.

### 2. Market feedback (seller reviews)
After every negotiation, the mock seller rates Melit from 1 to 5 using **deterministic rules** (`lib/market/reviews.ts`, no LLM). The rating depends on Melit's lowest offer relative to the seller's hidden floor (generous / firm / aggressive / insulting), how many rounds it took and how it ended. The floor is never revealed: the review only carries a coarse pressure label. Reviews are HMAC-signed, and the server ignores unsigned or edited ones.
- **Reputation changes seller behaviour.** An average rating of 5 keeps sellers at normal willingness. Each star lost makes them concede 10% less per round (down to 60%). At 2.5★ or lower, they also hold out 3–5% above their usual floor. Sellers with no reviews of their own use the market-wide average ("sellers talk").
- **Melit learns from it.** An insulting lowball or a rating of 2 or less lowers aggressiveness by 0.05; a seller accepting with no pressure raises it by 0.03. The **Market reputation** card shows this.

### 3. Reppo Evaluation API (async judge)
After each **purchase**, Melit submits the negotiation to the [Reppo Eval Router](https://eval.reppo.xyz/agents.md):

```
POST https://eval.reppo.xyz/api/v1/agents/evals      Authorization: Bearer $REPPO_API_KEY
{ "taskType": "action", "input": "<what the user asked for + every round's offer, reasoning and seller reply + outcome>" }
-> 201 { "id": "...", "status": "QUEUED" }
GET  https://eval.reppo.xyz/api/v1/agents/evals/{id}
-> { "status": "QUEUED|PROCESSING|COMPLETED|FAILED", "result": { "score", "route": "ship|review|block", "decision", "confidence", "reason", "rubric_scores", "consensus" }, "trace": {...} }
```

- **Synthetic data only.** The input is built from mock-seller names, catalogue prices and Melit's reasoning. It never includes keys, wallet addresses, tx hashes or personal data, and it is scrubbed afterwards for anything that looks like a 0x address, long hex, email, URL or token (`lib/learning/reppo-input.ts`, tested).
- **Never blocks.** Jobs go into a browser-side queue (`melit.reppo.v1`). A background hook submits one at a time and polls every 10 s, and shows each job as **queued**, **pending**, **verdict** (score, route, confidence, rubric, each evaluator model's score) or **failed**. Purchases never wait for it. Transient errors back off exponentially; 401/402/400 fail the job.
- **Strategy updates don't wait for Reppo.** Owner and market feedback apply immediately. When a verdict arrives, `POST /api/feedback {kind: "reppo", evalId}` makes the server **re-fetch the verdict from Reppo itself**, check that the evaluated text is exactly this deal's transcript, and ask SERV for a bounded update. The update is recorded as **Learned from Reppo verdict**.
- **Abuse limits.** Only server-signed summaries of real purchases less than an hour old are accepted. Each deal is submitted at most once, and there is a per-client gap between submissions. A completed text evaluation costs 440 Reppo credits.

A real verdict for one of Melit's negotiations (earbuds bought for $88.55 against a $129 list price) came back in about 70 s: score **97**, route `review`, decision `accept`, confidence medium, rubric scope 100 / safety 100 / correctness 100 / reversibility 81. The evaluators were gpt-4o (100), deepseek-chat (100) and glm-5-2 (96).

**Docs note:** the endpoints on docs.reppo.ai (`/agents/eval-requests/*`) are outdated and currently return 404. Melit uses the live API described at https://eval.reppo.xyz/agents.md, verified with real requests.

### Dashboard
**Is Melit getting better?** compares deals run with the default strategy (profile version 0) against deals run after feedback changed it at least once:
- average % saved versus list price, and price paid versus the market reference;
- deals closed % (guard blocks and payment errors excluded);
- owner approval % (👍 out of rated deals);
- the average Reppo score over verdicts that were actually returned.

It only uses negotiations you ran in this browser. Nothing is pre-filled or seeded, so a fresh browser shows empty metrics until you start using it.

## What's simulated vs real

| Part | Status |
| --- | --- |
| Learning loop (profile, owner feedback, bounded updates) | **Real.** SERV proposes updates; code bounds them. Fallback updates are labelled. |
| Seller reviews and reputation | **Deterministic rules** from the mock sellers, signed by the server. |
| Reppo verdicts | **Real Reppo Eval Router evaluations** when `REPPO_API_KEY` is set. Only verdicts Reppo actually returned are shown. |
| SERV Reasoning negotiation decisions | **Real** when `OPENSERV_API_KEY` is set. Rounds that use the fallback are labelled. |
| Spend Guard, shopping list and ledger signing | **Real**, enforced in server code, unit tested. The list is what it can buy; the $300 cap is how much it can spend. |
| Sellers and marketplace | **Mock sellers**: four labelled sellers with deterministic rules. Only their checkout endpoint is real x402. |
| Agent identity | **Kite Passport sandbox** only when kpass confirms it live. Otherwise **testnet wallet** (a real key, not Passport-verified) or **Simulated**. |
| Payments, Rail 1 | **Real Kite Passport sandbox call** with an approved session, from a local server. Kite currently refuses non-allowlisted merchants, and the receipt shows that refusal. |
| Payments, Rail 2 | **Real testnet payments.** Gasless pieUSD via the x402 facilitator, or an ERC-20 transfer. Live on https://melit.vercel.app with KiteScan links. |
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
npm test                       # Spend Guard, shopping list, negotiation, payment-rail and learning-loop tests
```

Without a key the app still runs, but every round is labelled **Fallback heuristic** and a banner says SERV isn't configured. With no payment rail configured, payments are **simulated** and labelled that way.

### Testnet payments (local)

1. **Rail 2 (quickest).** Create a throwaway wallet that you'll only use on testnet and set `AGENT_PRIVATE_KEY` and `MOCK_SELLER_PAYTO` in `.env.local`. Fund it with pieUSD from the Kite Passport faucet (`npm run kite:setup -- --base-url https://passport.staging.gokite.ai --agent-wallet <address>`), which needs no gas thanks to the facilitator. Or claim KITE and test USDT at https://faucet.gokite.ai. Check funding with `npm run testnet:balance -- <address>`.
2. **Rail 1 (Kite Passport sandbox).** Install the CLI (`curl -fsSL https://cli.gokite.ai/install.sh | bash`) and sign in (`kpass login`, or `kpass login init --email` for an email code). Run `npm run kite:setup -- --base-url https://passport.staging.gokite.ai`, which switches on sandbox mode, requests faucet pieUSD, registers the agent and creates the 7-day "Melit weekly budget" session. Approve the printed URL with your passkey. Then set `MELIT_KPASS=1`, `KPASS_BASE_URL`, `KPASS_SESSION_ID`, `SELLER_BASE_URL` (a public deploy of this app) and the same `MELIT_ORDER_SECRET` locally and on that deploy.
3. Optionally set `MELIT_RECORD_RECEIPTS=1` to save real receipts to `data/recorded-receipts.json` for the deployed replay.

### Deploy to Vercel

1. Import the repo in Vercel (framework preset: Next.js).
2. Set `OPENSERV_API_KEY`. For live testnet payments also set `AGENT_PRIVATE_KEY` (throwaway testnet key, as a *sensitive* variable), `MOCK_SELLER_PAYTO`, `MELIT_PAYMENT_MODE=testnet`, `MELIT_TESTNET_SCALE=0.001`, `MELIT_SIMULATED_FALLBACK=1`, `SELLER_BASE_URL` and `MELIT_ORDER_SECRET`. For the Reppo judge, set `REPPO_API_KEY` (sensitive). Without a key, Vercel defaults to `recorded` mode: it replays committed receipts, or issues labelled simulated receipts if there are none.
3. Deploy. The negotiation route streams its response and allows up to 120 s per request.

Never put a mainnet key or a funded personal wallet in any env var. `AGENT_PRIVATE_KEY` is for a throwaway testnet wallet only.

## Roadmap

- Get the mock seller host allowlisted as a Kite sandbox merchant, so Rail 1 pays first instead of hitting `sandbox_merchant_not_allowlisted`.
- A server-side ledger and shopping list, so the weekly cap and the allowlist survive a cleared browser.
- A shared rate-limit store, so per-IP limits hold across serverless instances.
- Real merchant integrations and multi-seller comparison.

## License

[MIT](LICENSE)
