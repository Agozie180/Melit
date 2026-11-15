# Melit: SERV Hackathon 02 submission

**Track:** Kite (agents with a verifiable identity and spending limits you control)

## Write-up (~150 words)

Melit is a shopping agent for people who hate haggling and struggle to save. You give it a weekly budget of $300. Before buying anything, Melit negotiates with the seller, and every move it makes (offer, accept or walk away) is decided by **SERV Reasoning**. SERV returns strict JSON with an action, a price, a confidence score and the reasoning steps, which Melit validates with zod and shows in the UI so every decision is auditable. If SERV fails, a labelled fallback takes over. When a deal closes, the difference from the list price goes into a Savings Vault. Melit keeps 15% of what it saves you and you keep 85%. The weekly cap is enforced by a unit-tested Spend Guard in server code. It recomputes the rolling 7-day total from an HMAC-signed ledger before every payment, so neither a prompt nor a tampered client can overspend. Identity and payments are Kite Passport/x402-ready adapters, clearly labelled as simulated in this demo.

## 2-minute demo script

**0:00 Hook (15 s).** "Most people pay the sticker price. Melit is a shopping agent that haggles for you, saves the difference, and can't overspend. Not 'shouldn't': can't."

**0:15 Setup (15 s).** Point at the header. "This is Melit's Agent ID card: a $300 limit over a rolling 7 days. Identity and payments are Kite Passport-ready but simulated here, and the UI says so. The budget gauge is at $0 of $300, and the vault is empty."

**0:30 Purchase 1 (30 s).** Tap *Wireless Earbuds* in the mock market (max $129, priority *Save more*), then **Negotiate and buy**. Narrate the feed: "Round 1: SERV Reasoning opens well below market. Expand the reasoning trail: it explains why. The flexible seller counters, Melit nudges up, and the deal closes." Point at the green card: "Spend Guard approved it, the payment is labelled simulated, and the savings went to the vault."

**1:00 Purchase 2 (20 s).** Pick *Running Shoes* from the bluffing seller, priority *Buy fast*. "This seller says 'my LAST price' every round. Watch SERV call the bluff." The vault grows and the 85/15 split updates.

**1:20 Purchase 3, optional (10 s).** *Ergonomic Office Chair*. The gauge climbs toward $300.

**1:30 Key moment (20 s).** Press **Try to overspend**. "Now I tell Melit to buy something that doesn't fit what's left this week, and it skips its own negotiation guardrails to do it." The red card appears: "Blocked by Spend Guard: this purchase would bring the last 7 days to $X, which is $Y over your $300 limit." "That's server code, not a prompt. It's unit tested at exactly $300, one cent over, the rolling window, and a client that edits its own ledger."

**1:50 Close (10 s).** "Melit only earns when it saves you money: 15% of the savings. Built on SERV Reasoning for the Kite track." Show the ledger table and Reset demo.

## X post draft

> Meet Melit: a shopping agent that haggles before it buys, drops the savings into a vault, and physically can't spend more than $300/week.
>
> Every negotiation move is decided by @openservai SERV Reasoning, with the reasoning shown. The weekly cap is enforced in code and unit tested.
>
> Kite track, #SERVHackathon
> [demo link] · [repo link]
