# Melit — 90-second demo

The script a presenter reads. It leads with the refusal, because that is the moment a judge cannot fake by watching a happy path.

Use https://melit.vercel.app/ (or a deploy of this branch). That URL includes the shopping list and Spend Guard as of 15 Nov 2026. Say what is simulated out loud. Do not promise a KiteScan link, a Passport checkmark, or a Reppo score unless that thing is on the screen.

## Setup, before the clock

- Fresh browser. Empty ledger. Do not pre-save a list.
- If the banner says the API key is missing, every round will be **Fallback heuristic**. Say that in act 3.
- If the agent card says **Testnet wallet, not Passport-verified**, that is the truth of the public deploy. `kpass` does not run on Vercel.
- If payments read **simulated, no money moves**, no chain transaction will appear.

## Act 1 — The refusal (0:00–0:20)

Do not add anything. Press **Wireless Earbuds**, then **Negotiate and buy**.

The feed refuses: there is no approved shopping list. No negotiation round starts. No payment rail is called.

> Melit haggles, then the server decides whether it may pay. The list is empty, so I ask for the earbuds anyway. It declines. It does not negotiate, and it does not pay.

## Act 2 — The owner signs the list (0:20–0:40)

Add Wireless Earbuds, max $120, quantity 1. Press **Save list**. The badge turns **signed**. The row says **waiting**.

> I set the max at a hundred and twenty dollars, quantity one, and I save. The server signs that list. That signature is the approval. The row is waiting.

## Act 3 — One purchase, and a push that stays declined (0:40–1:05)

Press **Negotiate and buy** on the earbuds. Open one trail and read the badge.

- **SERV Reasoning** means that round called SERV.
- **Fallback heuristic** means it did not. Say so. Do not say every move is a SERV call.

A Bluetooth Speaker flash deal should log `declined: not on your list`, with **Add to list?**. Do not press **Approve and save**. The speaker stays off the list.

The earbuds row should turn **bought** and show the dollars saved. The vault splits that saving 85/15. That split is list price minus paid price. It is not a charge. Open a transaction link only if the receipt has one.

> It can negotiate now. This badge says whether SERV actually answered. The seller pushes a speaker that is not on the list. Melit logs the decline and does not pay. I do not approve it. The vault line is arithmetic, not a fee collected.

## Act 4 — The second block (1:05–1:30)

Press **Try to overspend**.

With only the earbuds on the list, and money still left in the week, the block you see is the list: the chair is not approved. Say that. Do not call it the weekly cap.

To put the $300 sentence on screen: add Espresso Machine Pro, max $349, quantity 1, save, and press **Try to overspend** again. The guard should block $349.00 as over the $300 week. The card says no payment was attempted.

> That one is not on the list, so the list stops it. To show the week: I approve the espresso at three hundred and forty-nine, which is over the cap. The guard blocks it, and no payment is attempted.

Stop. Do not wait on camera for a Reppo verdict. If a score is already on screen, read it. If it is not, do not invent one.

## Lines that are not in this script

- "Every move is a SERV Reasoning call."
- "This payment is real pieUSD" unless the receipt on screen is a testnet receipt with a hash.
- "Reppo scored this purchase" unless the verdict is visible.
- "Melit earns 15%." The vault shows 15% of the saving. Nothing is collected.

## Appendix — older screen recording (not in the repo)

A 1:55 local capture used to live in the repo as `demo.mp4`. It is removed from GitHub to keep the clone small. It is not this 90-second script. Prefer [demo.md](./demo.md) + https://melit.vercel.app or your X demo link.

What that file actually contains:

| Shot in the file | In | Out | What the picture is |
| --- | --- | --- | --- |
| Introduction | 0:00 | 0:13 | Name, weekly budget, shopping list |
| Empty list | 0:13 | 0:24 | Earbuds declined before a list exists |
| Signed list | 0:24 | 0:32 | Earbuds at $129 and running shoes, quantity 2, badge **signed** |
| Negotiate, refuse the extra | 0:32 | 0:49 | Speaker flash deal, then **Approve and save** puts it on the list |
| Guard, payment, bought | 0:49 | 1:03 | A testnet receipt and the vault |
| It learns | 1:03 | 1:12 | Thumbs down, "you paid too much" |
| Shoes | 1:12 | 1:25 | Running shoes, a rain-jacket push left declined |
| Weekly cap | 1:25 | 1:34 | **Try to overspend** on a second pair of shoes |
| Reppo verdict | 1:34 | 1:44 | A verdict card. The wait is not in the cut |
| Close | 1:44 | 1:55 | Closing card |

Two spoken lines in that file are stronger than the code guarantees:

- Around 0:32 the narration says every move is a SERV Reasoning call. The badge on screen is the check. **Fallback heuristic** means that round did not call SERV.
- Around 1:25 the narration treats the overspend block as the weekly cap on a second pair of shoes. That is what that recording shows. `runOverspend` can instead block an off-list chair when remaining budget still covers every on-list price. Act 4 of this script says which one you are looking at.
