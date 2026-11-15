# Melit: SERV Hackathon 02 submission

**Main track:** Kite (agents with a verifiable identity and spending limits you control). **Secondary:** Reppo (agents that turn feedback into measurable improvements).

**Live demo:** https://melit.vercel.app · **Repo:** https://github.com/Agozie180/Melit

## Write-up (~150 words)

Melit is a shopping agent that haggles before it buys. Every move in a negotiation (offer, accept or walk away) is a **SERV Reasoning** call that returns strict JSON, which Melit validates with zod and shows as a reasoning trail. If SERV fails, a labelled fallback takes over. Sellers are labelled mocks with hidden floor prices.

Before every payment, a unit-tested server-side Spend Guard recomputes your rolling 7-day total from an HMAC-signed ledger and blocks anything over $300. Approved purchases are real KiteAI testnet pieUSD payments, at reduced scale and gasless through an x402 facilitator, each linked on KiteScan. The saving goes to a vault: 85% to you, 15% to Melit.

Melit also learns. Your thumbs up/down, seller reviews and Reppo verdicts on each purchase update a capped strategy that feeds every SERV call. A dashboard compares savings, close rate and approval before and after feedback.

## 2-minute demo script (all on https://melit.vercel.app)

**0:00 Hook (10 s).** "Most people pay the sticker price. Melit haggles for you, saves the difference, and checks a hard weekly budget in code before every payment."

**0:10 Setup (15 s).** Point at the Agent ID card: "This is the agent's KiteAI testnet wallet, labelled honestly as not Passport-verified. There's a $300 rolling 7-day limit, and payments are real pieUSD on chain 2368 at 1:1000 scale." Point at the empty budget gauge and vault.

**0:25 Purchase 1 (30 s).** Tap *Wireless Earbuds* (max $129, *Save more*), then **Negotiate and buy**. "Each round is a SERV Reasoning call." Open a reasoning trail. "The seller counters, Melit raises a little, and the deal closes." On the green card: "The Spend Guard approved the exact amount before any payment ran. The agent signed a gasless pieUSD authorization and the x402 facilitator settled it." Click the tx hash to open KiteScan. "The saving went to the vault, split 85/15."

**0:55 Learning (25 s).** Under **Deals & feedback**, click 👎 and type "you paid too much". "SERV turns my note into a small, capped strategy change." Point at **What Melit learned** and the aggressiveness bar. Point at the seller's star review and the **Reppo: pending** badge. "Reppo's evaluator panel is judging this purchase in the background. Nothing waits for it."

**1:20 Purchase 2 (15 s).** Buy *Running Shoes* from the bluffing seller. "The updated strategy is now part of every SERV prompt; watch the reasoning for it." If the Reppo verdict has arrived, open it: score, route and evaluator models, then "Learned from Reppo verdict" in the learning log.

**1:35 Key moment (15 s).** Press **Try to overspend**. "Melit tries to buy something that doesn't fit what's left this week." The red card reads "Blocked by Spend Guard… No payment was attempted."

**1:50 Close (10 s).** "Melit only earns when it saves you money. Built on SERV Reasoning, paying on KiteAI testnet, judged by Reppo." Show **Is Melit getting better?**

## X post draft

> Meet Melit: a shopping agent that haggles before it buys and puts the savings in a vault.
>
> Every negotiation move is a @openservai SERV Reasoning call with the reasoning shown. A $300/week Spend Guard runs in server code before each real @GoKiteAI testnet payment, and Melit learns from your feedback, seller reviews and Reppo verdicts.
>
> #SERVHackathon
> https://melit.vercel.app · https://github.com/Agozie180/Melit

## Notes for judges (what is and isn't live)

- **Sellers are mocks.** Their x402 checkout endpoint and the testnet payments are real.
- **Identity on the live site** is the agent's KiteAI testnet wallet. It is not Passport-verified.
- **Kite Passport sandbox** was tested from a local server against Kite's staging backend: the agent was registered and a 3 pieUSD / 7-day session was approved. Paying a mock seller through it is refused with `sandbox_merchant_not_allowlisted`, a refusal recorded in `data/recorded-receipts.json`. The deployed site can't run `kpass`, so it pays on Rail 2 only.
- **The $300 cap** is checked against a signed ledger held in your browser. Clearing it (Reset demo) starts a new week; see the README's "Known limitation".
