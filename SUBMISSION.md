# Melit: SERV Hackathon 02 submission

**Main track:** Kite. **Secondary:** Reppo.

**Repo:** https://github.com/Agozie180/Melit · **Judge's sheet:** [README.md](./README.md) (thesis, what is used, what is measured, limitations)

**Also:** [JUDGING.md](./JUDGING.md) (the brief, quoted), [ARCHITECTURE.md](./ARCHITECTURE.md) (the blueprint), [AUDIT.md](./AUDIT.md) (findings), [demo.md](./demo.md) (the 90-second script).

**Demo:** https://melit.vercel.app (shopping list + signed allowlist on the live deploy).

## Write-up

Melit haggles, then buys only what you allowed. Each move calls SERV Reasoning (`melit-negotiator-v3`) and shows the trail. **SERV was verified in sandbox this morning** (including with Opus 5.5). **The free OpenServ token is exhausted now**, so many live rounds show **Fallback heuristic** until quota returns — that badge means the call did not complete, not that SERV is mocked. If the JSON is invalid, the round is labelled fallback too. The model cannot raise the limits.

Two checks run in server code before any payment. The shopping list is what it can buy: name, max price, and quantity, stored in the browser and HMAC-signed on save. The Spend Guard is how much: it recomputes the signed ledger over 7 days and blocks anything over $300. Renaming a purchase, raising a max, or breaking a signature freezes spending. Off-list bundles log `declined: not on your list` until you approve them.

Sellers are mocks. A testnet key pays real pieUSD on KiteAI testnet (chain 2368, $1 = 0.001 pieUSD); a dry wallet is labelled Simulated. The card is that wallet, not Passport, because `kpass` cannot run on Vercel. The 85/15 vault split is list price minus paid price, not a card charge. Reppo runs only with `REPPO_API_KEY`.

## 2-minute demo script

The 90-second version starts with the empty-list refusal and is the one to read if time is short: [demo.md](./demo.md). This longer pass adds the feedback beat. Use a deploy of this branch. Say what is simulated out loud.

**0:00.** "Melit haggles, then two server checks run before any payment: a shopping list, and a $300 week."

**0:15.** Add Wireless Earbuds at $120, quantity 1. Save. "The server signed that list. The badge says waiting." Point at the agent card. If it says **Testnet wallet, not Passport-verified**, say so. If payments read **simulated, no money moves**, say no chain transaction will appear.

**0:35.** Negotiate and buy the earbuds, priority Save more. Open one trail. If the badge says **SERV Reasoning**, that round called SERV. If it says **Fallback heuristic**, SERV was not used for that round. The seller's flash deal on the Bluetooth Speaker should read `declined: not on your list`, with **Add to list?** Nothing is added until **Approve and save**. The earbuds row should say bought and the dollars saved. The vault splits that saving 85/15. Open a transaction link only if the receipt has one.

**1:15.** Thumbs down, note "you paid too much", Send. Read **What Melit learned**. If the line says fallback rule, SERV did not write it.

**1:35.** Try to overspend. With only the earbuds on the list, the block is the list: the chair is not approved. Say that. To show the weekly cap, add Espresso Machine Pro with max $349, save, and press Try to overspend again. The guard should block $349.00 as over the $300 week, and the card says no payment was attempted.

**1:50.** Reset demo clears the ledger and restores quantity. It does not clear the list.

## X post draft

> Melit haggles, then checks two limits in server code before it pays: a shopping list you signed (what it can buy) and a $300 rolling week (how much).
>
> Each move asks @openservai SERV Reasoning and shows the trail. If SERV fails, the round is labelled Fallback heuristic. Off-list bundles are declined until you approve them.
>
> Sellers are mocks. Payments are KiteAI testnet pieUSD when the wallet can pay, otherwise labelled Simulated. The agent card is a testnet wallet, not a Passport identity. Savings shown in the vault are list price minus paid price, split 85/15. That is not a card charge.
>
> #SERVHackathon
> https://github.com/Agozie180/Melit
