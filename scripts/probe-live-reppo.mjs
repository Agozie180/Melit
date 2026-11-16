#!/usr/bin/env node
/** Smoke Reppo on the hosted deploy (uses server REPPO_API_KEY). No secrets in this script. */
import { randomUUID } from "node:crypto";

const BASE = process.env.PROBE_URL ?? "https://melit.vercel.app";

async function main() {
  const budget = randomUUID();
  const headers = {
    "Content-Type": "application/json",
    "X-Melit-Budget": budget,
    Cookie: `melit_budget=${budget}`,
  };

  const listRes = await fetch(`${BASE}/api/shopping-list`, {
    method: "POST",
    headers,
    body: JSON.stringify({ items: [{ name: "Wireless Earbuds", maxPrice: 12000, quantity: 1 }] }),
  });
  const list = await listRes.json();
  if (!listRes.ok) {
    console.error("shopping-list failed", listRes.status, list);
    process.exit(1);
  }

  const res = await fetch(`${BASE}/api/negotiate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      request: { query: "wireless earbuds", maxPriceCents: 12000, priority: "save" },
      ledger: [],
      list,
    }),
  });
  if (!res.ok) {
    console.error("negotiate failed", res.status, await res.text());
    process.exit(1);
  }

  let summary = null;
  let purchased = null;
  const text = await res.text();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.type === "summary") summary = e.summary;
      if (e.type === "purchased") purchased = e;
    } catch {
      /* skip */
    }
  }
  if (!summary) {
    console.error("No summary in negotiate stream; tail:", text.slice(-500));
    process.exit(2);
  }
  console.log("outcome:", summary.outcome, "paidCents:", summary.paidCents, "rail:", purchased?.entry?.rail, "tx:", purchased?.receipt?.txHash);

  const submit = await fetch(`${BASE}/api/reppo`, {
    method: "POST",
    headers,
    body: JSON.stringify({ summary }),
  });
  const subBody = await submit.json();
  if (!submit.ok) {
    console.error("reppo submit failed", submit.status, subBody);
    process.exit(3);
  }
  console.log("reppo queued:", subBody);
  const evalId = subBody.evalId;
  if (!evalId) process.exit(4);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const poll = await fetch(`${BASE}/api/reppo/${encodeURIComponent(evalId)}`, { headers, cache: "no-store" });
    const body = await poll.json();
  if (!poll.ok) {
      console.error("reppo poll failed", poll.status, body);
      process.exit(5);
    }
    console.log("poll", body.status, body.verdict ? { score: body.verdict.score, route: body.verdict.route } : null, body.verifyUrl);
    if (body.terminal) {
      console.log(
        JSON.stringify(
          {
            evalId,
            status: body.status,
            inputMatch: typeof body.input === "string" && body.input.length > 20,
            score: body.verdict?.score ?? null,
            route: body.verdict?.route ?? null,
            verifyUrl: body.verifyUrl,
          },
          null,
          2,
        ),
      );
      process.exit(body.status === "COMPLETED" && body.verdict?.score != null ? 0 : 6);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.error("reppo poll timeout");
  process.exit(7);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});