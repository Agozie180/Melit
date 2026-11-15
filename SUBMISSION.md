# Melit: SERV Hackathon 02 submission

**Main track:** Kite. **Secondary:** Reppo.

**Repo:** https://github.com/Agozie180/Melit (must be **public** before submit) · **Judge's sheet:** [README.md](./README.md)

**Also:** [JUDGING.md](./JUDGING.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [AUDIT.md](./AUDIT.md), [demo.md](./demo.md) (90 s script). Optional longer cut: `demo.mp4`.

**Live demo:** https://melit.vercel.app/

## Write-up (~150 words)

Melit is a shopping agent that **negotiates first** and **pays only if server code allows it**. Each negotiation round calls **SERV Reasoning** (`melit-negotiator-v3`, strict JSON schema). The UI labels **SERV Reasoning** or **Fallback heuristic** so judges see when the model did not answer. Feedback after purchase can call SERV (`melit-learner-v1`).

Two **independent** checks run before any payment rail: (1) a **signed shopping list**—what it may buy, max price, quantity; (2) a **$300 rolling 7-day Spend Guard** on the signed ledger held **server-side** per session (KV/Upstash on Vercel). Tampering with names, prices, or signatures fails closed. Off-list seller pushes are declined until the owner approves and saves.

**Simulated / honest limits:** sellers are mocks in `lib/market/catalog.ts`; savings vault 85/15 is **list price minus paid price**, not money collected. Payments are **KiteAI testnet pieUSD** when the wallet can pay, otherwise **Simulated**. Production runs **Rail 1** (`kite-passport-sandbox`) when Vercel secrets are set; the agent card shows Passport only when live `kpass` confirms it, and may still read **testnet wallet** otherwise. Reppo runs only with `REPPO_API_KEY`; verdicts are async and may not appear in a short demo.

## 2-minute demo script

Use [demo.md](./demo.md) for the 90-second path (empty list refusal first). This outline adds one feedback beat.

1. **0:00** — No list saved → negotiate earbuds → **refusal** (no pay).
2. **0:20** — Add Wireless Earbuds, max **$120**, qty **1**, **Save** → badge **signed**.
3. **0:40** — **Negotiate and buy** → read trail badge (**SERV** or **Fallback**). Decline Bluetooth Speaker push (**not on your list**). Vault split is arithmetic only.
4. **1:15** — Thumbs down + “paid too much” → read **What Melit learned**.
5. **1:35** — **Try to overspend** → explain list block vs weekly cap (add Espresso max $349 if you need the **$300 week** sentence).
6. **1:50** — **Reset demo** clears ledger, not the list.

Say aloud: mock sellers, simulated payments if shown, and whether the agent card shows Passport or testnet wallet.

## X post draft

> Melit haggles with mock sellers, then two server checks run before pay: a **signed shopping list** (what) and a **$300 / 7-day Spend Guard** (how much). Each round calls @openservai SERV Reasoning and shows the trail—or **Fallback heuristic** when SERV did not answer.
>
> Payments: KiteAI **testnet** pieUSD when possible (Passport Rail 1 on the live deploy when configured), else **Simulated**. The card says Passport only when kpass confirms it. Vault 85/15 is savings math, not a real fee.
>
> #SERVHackathon
> https://github.com/Agozie180/Melit · https://melit.vercel.app/