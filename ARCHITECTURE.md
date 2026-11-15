# ARCHITECTURE.md

An implementation blueprint for the implementer.

This is the spec for the system that is in the repo. Change the code only if the invariant still holds, and add the test that fails when it does not.

## Thesis

The model may suggest a price. The server will not pay unless the item is on the signed shopping list, quantity is left, the price is within that item's max, and the last 7 days plus this price is at most $300.

## The load-bearing principle

**The model never authorizes a payment.** SERV Reasoning, and the fallback heuristic, only produce a decision. `authorizePurchase` in `lib/server/shopping-list.ts` is the only function that may return `allowed: true`. `purchase` in `lib/negotiation/run.ts` calls `deps.pay` only after that result is allowed, and it returns before the call when the result is not.

This is load-bearing because the seller's text is inside the prompt. A sentence such as "ignore your list" can change what the model recommends. It cannot change the branch that calls the rail.

## Core data model

Money is integer cents. `WEEKLY_CAP_CENTS` is `30000`. `WINDOW_MS` is 7 days. Both live in `lib/money.ts`.

**Shopping list row** (`lib/shopping/list.ts`): `{ name, maxPrice, quantity }`. `maxPrice` is integer cents. The signed object is `{ items, sig }`. The client does not send a remaining-quantity field that the server trusts.

**Ledger entry** (`lib/types.ts`, verified by `LedgerEntrySchema`): id, item id, item name, seller name, list price, paid cents, saved cents, timestamp, receipt id, rail, tx hash, explorer URL, testnet amount, sig. The HMAC canonical string is version `v3` and includes the item name and the seller name (`lib/server/ledger.ts`).

**Decision** (`lib/negotiation/negotiator.ts`): `action` of offer, accept, or walk; `offerPrice` in dollars; `reasoning` strings; `confidence`. Zod parses it. Code then clamps it.

**Guard result:** `allowed`, a human-readable `reason`, spent in the window, remaining, attempted, cap.

## Invariants

1. A purchase of an item whose normalized name is not on the verified list is blocked. Normalization lowercases and strips punctuation (`normalizeItemName`).
2. Quantity remaining is `quantity` minus the count of verified ledger rows with that name. The 7-day window does not refill quantity.
3. `attemptedCents` must be a positive integer. Zero, negative, NaN, and fractional cents are blocked. `dollarsToCents` rounds with `Math.round`.
4. `spentInWindow + attempted > 30000` is blocked. An entry still counts while `now - timestamp < WINDOW_MS`. At exactly 7 days it drops out. A future timestamp still counts.
5. A negative `paidCents` in the window sum is treated as 0. It cannot refund budget.
6. A ledger or list whose HMAC does not match is a hard stop. Spending is frozen. Extra fields such as `remaining`, `allowed`, or `weeklySpent` are stripped by zod.
7. Rewriting `itemName` or `sellerName` on a signed entry breaks the v3 signature. The regression test is "rejects a signed ledger entry whose item name was rewritten" in `tests/shopping-list.test.ts`.
8. Off-list seller pushes are yielded as `declined-offer` with the log prefix `declined: not on your list`. They are not a second call to `purchase`.
9. The catalog object sent to the client and to the model is `toPublicItem`. It has no `floorPriceCents`.
10. One learning update can move aggressiveness by at most 0.15 (owner), 0.10 (Reppo), or 0.05 (market), and the walk-away threshold by at most 0.05, 0.04, or 0.02. Aggressiveness stays in `[0, 1]`. Walk-away stays in `[0.85, 1.3]` of the market reference (`lib/learning/profile.ts`).

## Platform constraints, checked rather than assumed

Design with these. Do not route around them.

| Constraint | What was checked | Consequence in the code |
| --- | --- | --- |
| SERV Reasoning is an OpenAI-compatible chat completion | `lib/adapters/reasoning.ts` posts to `https://inference-api.openserv.ai/v1/chat/completions` with `reasoning_effort: "low"` and a strict JSON schema | No vendor SDK. A timeout is 25 seconds. Failure becomes a labelled fallback. |
| Vercel cannot run `kpass` | The live `/api/agent` response on 15 Nov 2026 had `status: "testnet-wallet"` and rails `direct-testnet` and `simulated`. Passport was not in the rail list. | `kpassEnabled()` is `MELIT_KPASS === "1"`. Leave it unset on Vercel. |
| Kite payments in this repo are testnet only | `lib/kite/config.ts` sets chain 2368, RPC `https://rpc-testnet.gokite.ai/`, explorer `https://testnet.kitescan.ai`, pieUSD `0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A`. The file says there is no mainnet configuration. | Do not add a mainnet key path. |
| The public demo has no database | The ledger and the list are in `localStorage` and are sent back with each request | The server recomputes totals from signed rows. A deleted browser ledger is a new week. That is disclosed, not prevented. |
| Passport sandbox rejects non-allowlisted merchants | README records `sandbox_merchant_not_allowlisted` from a local `kpass` attempt. That refusal is not a row in `data/recorded-receipts.json`. | Rail 2 is the path that can settle on the public deploy. Rail 1 is local only. |
| Default testnet scale | `testnetScale()` defaults to `0.01` and clamps to `(0, 1]`. The live site on 15 Nov 2026 reported `testnetScale: 0.001`. | A $300 week is 3 pieUSD at 0.01 and 0.3 pieUSD at 0.001. Say which scale the deploy uses. Do not say the on-chain amount is $300. |

## Priority order

Cut from the bottom. P0 is the entry. P1 is still open and is listed in [AUDIT.md](./AUDIT.md).

| Priority | What | Status in this repo |
| --- | --- | --- |
| P0 | List check, $300 check, HMAC on the rows the check reads, payment only after `allowed` | Built. Tests in `tests/spend-guard.test.ts`, `tests/shopping-list.test.ts`, `tests/payments.test.ts`. |
| P0 | SERV call for each negotiation round, with a labelled fallback | Built. `decide` in `lib/negotiation/negotiator.ts`. |
| P1 | The public URL serves this build, including the shopping list | Open on 15 Nov 2026. https://melit.vercel.app did not. |
| P1 | A rate limit that holds across serverless instances, including Reppo | Open. Counters are in-process (`lib/server/rate-limit.ts`). |
| P1 | Refuse the dev HMAC secret when `VERCEL` is set and no key is present | Open. `ledgerSecret()` falls back to a string in source. |
| P2 | A server-side ledger so clearing the browser does not reset the week | Not built. Named as a known limitation. |
| P2 | `applyGuardrails` treats a missing `shoppingList` as off-list | Not built. The payment gate still checks the signed list. The negotiator treats `shoppingList === undefined` as on-list so older callers keep working. |

## Non-goals

Do not build these in this hackathon entry.

- A real merchant, a card charge, or a mainnet payment.
- A Dolphin model integration.
- A Passport-verified identity on Vercel. The CLI cannot run there.
- Collecting the 15% fee. The vault only splits list price minus paid price.
- Hiding the fallback. A round that did not call SERV says **Fallback heuristic** and the reason.
- A client-supplied "remaining quantity" or "weekly spent" field that the server trusts.

## Day-0 probes

These were resolved against the live platform before treating a claim as true.

- `GET https://melit.vercel.app/api/agent` on 15 Nov 2026 returned reasoning configured (`gpt-5.4-mini`), Reppo configured, payment mode `testnet`, chain 2368, scale `0.001`, identity `0x14433179E3450A5a4D5A7e0a6E81627e4e6421a8`, `verified: false`.
- The same day's HTML for `/` contained no "Shopping list".
- The catalog JSON from that endpoint had no floor field.
- `https://testnet.kitescan.ai/tx/0x64f1e93057bc9357f6f044ccaa6b736a8dfd67d53e1c3a9cf8aa156d6d2b83de` returned a transaction page. The success details are rendered by the explorer's client. On-chain success was not read out of that HTML.
- Local `npm test` on 15 Nov 2026 reported 87 passing tests. A fresh `npm ci` on an empty machine was not run.

## Demo and submission

The 90-second script that leads with the refusal is [demo.md](./demo.md). The judging quotes and the track decision are [JUDGING.md](./JUDGING.md). The findings and the tests that pin the fixes are [AUDIT.md](./AUDIT.md).

## Submission checklist

Filled from the playbook's pre-submission list. A box is checked only where this repo actually meets it.

**The thing**

- [x] One thesis, enforced in `authorizePurchase`, with tests.
- [x] The list and the $300 cap are the two features the demo shows.
- [x] `npm test` runs. The UI runs with no API key and labels the fallback.
- [ ] Every qualifying track is entered. Kite is the lane. Reppo is described as secondary. Dolphin is correctly excluded. Whether the form accepts two tracks is not something this repo can check.

**Verifiability**

- [x] A hosted URL exists, and recorded testnet hashes exist in `data/recorded-receipts.json`.
- [ ] That hosted URL is this commit. On 15 Nov 2026 it was not.
- [x] The quantified spend claims in the README name the test command.
- [ ] No published npm package. Melit is an app, not a library. Nothing to claim here.

**Presentation**

- [x] README has the thesis, the links, the used/not-used table, the measured table, and the limitations.
- [x] [demo.md](./demo.md) is a 90-second script that starts with the refusal.
- [ ] `demo.mp4` is a 1:55 cut. It does not follow that 90-second order. Do not tell a judge they are the same film.

**Honesty**

- [x] Limitations are in the README and in [AUDIT.md](./AUDIT.md).
- [x] Simulated receipts are labelled. The 15% line is described as arithmetic.
- [ ] The open findings in the audit are still open. Do not describe them as fixed.

**Hygiene**

- [x] `.env*` is gitignored except `.env.example`. A history scan on 15 Nov 2026 found no committed API key or private key.
- [ ] `AGENTS.md` is still in the tree. Next.js rewrites it if it is removed. It is a framework file, not a secret.

**Compounding**

- [ ] The GitHub repo description is not set from this file. A win index on the profile is not this repo's job.
- [ ] The X post is drafted in [SUBMISSION.md](./SUBMISSION.md). Posting it, and putting the link in the form, is a manual step. Deadline: 15 Nov 2026, 23:59 UTC.
