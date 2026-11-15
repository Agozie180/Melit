# Melit: SERV Hackathon 02 submission

**Main track:** Kite (agents with a verifiable identity and spending limits you control). **Secondary:** Reppo (agents that turn feedback into measurable improvements).

**Live demo:** https://melit.vercel.app · **Repo:** https://github.com/Agozie180/Melit

## Write-up (~150 words)

Melit is a shopping agent that haggles before it buys. Every move (offer, accept or walk away) is a **SERV Reasoning** call, shown as a reasoning trail. Mock sellers sometimes push bundles and flash deals. Melit declines anything off your list, logs why, and waits for your approval before adding it.

Two controls live in server code, not in the prompt. The shopping list decides **what** Melit can buy: only those items, within each max price and remaining quantity. The Spend Guard decides **how much** it can spend: it recomputes the rolling 7-day total from an HMAC-signed ledger and blocks anything over $300. A tampered list or ledger cannot talk the server into paying. Approved purchases are real KiteAI testnet pieUSD payments, linked on KiteScan. Savings go to a vault: 85% to you, 15% to Melit.

Melit also learns. Thumbs, seller reviews and Reppo verdicts update a capped strategy on every SERV call. A dashboard compares savings, close rate and approval before and after feedback.

## 2-minute demo script (all on https://melit.vercel.app)

**0:00 Hook (10 s).** "Most people pay the sticker price. Melit haggles for you, saves the difference, and checks two limits in code before every payment: what it can buy, and how much it can spend."

**0:10 Setup (20 s).** Point at the shopping list: "This is what it can buy. I'll add Wireless Earbuds, max $120, quantity 1, and save. The server signs that list." Point at the budget gauge: "This is how much it can spend, $300 over 7 days." Point at the Agent ID card: "KiteAI testnet wallet, not Passport-verified. Payments are real pieUSD on chain 2368 at 1:1000 scale."

**0:30 Purchase 1 (30 s).** Tap *Wireless Earbuds* (*Save more*), then **Negotiate and buy**. "Each round is a SERV Reasoning call." Open a reasoning trail. "The seller counters, Melit raises a little, and the deal closes." On the green card: "The Spend Guard approved the exact amount before any payment ran." Point at **Declined offers**: "The seller pushed a flash deal. Melit logged declined: not on your list. Add to list asks me to approve it. The model cannot override that." Click the tx hash to open KiteScan. "The saving went to the vault, split 85/15." The earbuds row now reads bought, with the dollars saved.

**0:55 Learning (25 s).** Under **Deals & feedback**, click 👎 and type "you paid too much". "SERV turns my note into a small, capped strategy change." Point at **What Melit learned** and the aggressiveness bar. Point at the seller's star review and the **Reppo: pending** badge. "Reppo's evaluator panel is judging this purchase in the background. Nothing waits for it."

**1:20 Purchase 2 (15 s).** Buy *Running Shoes* from the bluffing seller. "The updated strategy is now part of every SERV prompt; watch the reasoning for it." If the Reppo verdict has arrived, open it: score, route and evaluator models, then "Learned from Reppo verdict" in the learning log.

**1:35 Key moment (15 s).** Press **Try to overspend**. "Melit tries to buy something that doesn't fit what's left this week." The red card reads "Blocked by Spend Guard… No payment was attempted."

**1:50 Close (10 s).** "Melit only earns when it saves you money. Built on SERV Reasoning, paying on KiteAI testnet, judged by Reppo." Show **Is Melit getting better?**

## X post draft

> Meet Melit: a shopping agent that haggles before it buys and puts the savings in a vault.
>
> Every negotiation move is a @openservai SERV Reasoning call with the reasoning shown. A shopping list decides what it can buy, and a $300/week Spend Guard decides how much, both in server code before each real @GoKiteAI testnet payment. It also learns from your feedback, seller reviews and Reppo verdicts.
>
> #SERVHackathon
> https://melit.vercel.app · https://github.com/Agozie180/Melit

## Notes for judges (what is and isn't live)

- **Sellers are mocks.** Their x402 checkout endpoint and the testnet payments are real.
- **Identity on the live site** is the agent's KiteAI testnet wallet. It is not Passport-verified.
- **Kite Passport sandbox** was tested from a local server against Kite's staging backend: the agent was registered and a 3 pieUSD / 7-day session was approved. Paying a mock seller through it is refused with `sandbox_merchant_not_allowlisted`, a refusal recorded in `data/recorded-receipts.json`. The deployed site can't run `kpass`, so it pays on Rail 2 only.
- **The two controls** are checked in server code against signed records held in your browser. The shopping list is what Melit can buy. The $300 cap is how much it can spend. Saving the list is your approval. Reset demo clears the ledger (and restores quantities) but not the list. See the README's "Known limitation".
