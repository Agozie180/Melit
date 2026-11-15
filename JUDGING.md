# Judging sheet — SERV Hackathon Edition 02

Planning doc for Law 1 of the hackathon playbook: read the brief like a judge. Quotes below are copied from https://www.openserv.ai/hackathon-2 as fetched on 15 Nov 2026. Where the page does not publish a number or a weighting, this file says so. It does not invent one.

## The circuit

This is a judged developer-program hackathon. The deliverable the page asks for is a public repo, a demo link or video, a short write-up, and an X post. Judges score a rubric. They are not scoring GitHub stars.

Mode for Melit: one deep flagship, not a scaffold re-skinned across chains.

## Criteria, copied verbatim

The page's only scoring sentence:

> Judged on creativity, user readiness and revenue potential.

No weights are published. No point scale is published. Do not treat the three axes as equal, and do not invent a split.

The build-period line on the same page:

> Build on SERV Reasoning. Real data, real decisions, auditable steps.

## Prize pool, copied verbatim

The page shows:

> TOTAL_PRIZE_POOL, $5,000
>
> awarded across tracks · breakdown announced at kickoff
>
> track_winner × 2, TBA
>
> best_overall_build, TBA
>
> special_mention, TBA

Per-track dollar amounts were still TBA on 15 Nov 2026. The README names the $5,000 total and does not name a Kite or Reppo purse.

## Tracks, copied verbatim

> Every track needs to use SERV Reasoning. Pick a partner stack, or bring your own idea to the Open Track.

| Track | Page text | Melit's decision |
| --- | --- | --- |
| Dolphin | "Build agents on decentralized open-source models." | Not entered. Melit does not call Dolphin. |
| Kite | "Build agents with a verifiable identity and spending limits you control, so it can shop, book, and pay on your behalf, safely." | Main track. The spending limit is the thing this build can defend in code. |
| Reppo | "Build reliable agents that turn real-time feedback into measurable improvements." | Secondary. The loop exists. A live verdict was not observed in the 15 Nov 2026 audit. |
| Open | "Bring your own idea and build it on SERV Reasoning. Any domain, any stack." | Not a separate entry. The form asks "which track you entered" in the singular, and the page says "Pick your lane." |

The two features this entry protects if time runs short:

1. The signed shopping list and the $300 check, both before any payment.
2. A SERV Reasoning call on each negotiation round, labelled **Fallback heuristic** when the call does not happen.

## Submission form, copied verbatim

> What do I need to submit?
>
> Submit a public code repository, a demo link or video, and a short write-up explaining what your project does, how it uses SERV Reasoning, and which track you entered. SERV Reasoning must be part of your build.

> Do I need to post my project on X?
>
> Yes. Share your submission on X by the deadline and include a link to your post in the submission form.

> When are submissions due?
>
> Submit by November 15, 2026 at 23:59 UTC.

## What did you build?

Melit negotiates with mock sellers, then pays only when server code allows it. The write-up that answers the form is [SUBMISSION.md](./SUBMISSION.md). The mechanism is [ARCHITECTURE.md](./ARCHITECTURE.md).

## How it uses SERV Reasoning

Each negotiation round calls `ServReasoningAdapter.completeJson` in `lib/adapters/reasoning.ts`, which POSTs to `https://inference-api.openserv.ai/v1/chat/completions` with prompt `melit-negotiator-v3`. Owner-feedback updates use a second prompt, `melit-learner-v1`, in `lib/learning/feedback.ts`. If the key is missing, the call throws, or zod rejects the JSON, that round is labelled **Fallback heuristic** and a fixed rule decides. The model does not authorize payment.

## Which track

Kite, with Reppo as the second sponsor primitive in the same build. Dolphin is out.

## How the three axes land, without a fake score

The page does not say how many points each axis is worth. This is the evidence a judge can check, and the gap on that axis.

**Creativity.** Two controls with different jobs: a signed allowlist (what it can buy) and a rolling $300 week (how much). Off-list seller pushes are declined until the owner presses **Approve and save**. The sellers are four scripts in `lib/market/catalog.ts`. That is a specific mechanism, not a general chatbot, and it is not a real shop.

**User readiness.** The app has an empty list, a loading line (`payments: checking…` until `/api/agent` returns), a blocked card, and a layout that fits a ~390px phone width without horizontal overflow (checked 15 Nov 2026). A judge can run it with no API key. https://melit.vercel.app/ serves the shopping list; negotiation rounds show **SERV Reasoning** or **Fallback heuristic** per round. The card is still a testnet wallet, `verified: false`.

**Revenue potential.** The vault shows 85% of (list price − paid price) as the owner's share and 15% as Melit's fee. `splitSavings` in `lib/money.ts` is that arithmetic. No shopper and no merchant is charged. The fee is not collected on chain.

## What this doc refuses to claim

- A weighting between the three criteria.
- A dollar amount for the Kite track or the Reppo track.
- That Reppo has returned a live verdict during your demo unless the UI shows one.
- That Reppo has returned a score for a purchase on that URL. The live `/api/agent` response reported `reppo.configured: true`. A verdict body was not fetched.
