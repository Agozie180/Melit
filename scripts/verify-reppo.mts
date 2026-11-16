#!/usr/bin/env node
/**
 * Submits a tiny Reppo "action" eval and polls until COMPLETED with score + route (or FAILED).
 * Requires REPPO_API_KEY. Exits 0 only when a traceable verdict is ready.
 */
import { getReppoClient } from "../lib/adapters/reppo";
import { verdictIsReady } from "../lib/learning/reppo-verdict";

const client = getReppoClient();
if (!client.configured) {
  console.error("REPPO_API_KEY is not set.");
  process.exit(1);
}

const input =
  "Melit negotiation transcript (verify script): seller opened at $120, agent offered $90, seller accepted. Outcome: purchased at $90.";
const submitted = await client.submit("action", input);
console.log(`Submitted ${submitted.id} status=${submitted.status}`);

const deadline = Date.now() + 120_000;
let last = submitted;
while (Date.now() < deadline) {
  last = await client.get(submitted.id);
  if (last.status === "FAILED") {
    console.error(last.error ?? "Reppo FAILED");
    process.exit(2);
  }
  if (last.status === "COMPLETED" && verdictIsReady(last.verdict)) {
    console.log(
      JSON.stringify(
        {
          id: last.id,
          score: last.verdict!.score,
          route: last.verdict!.route,
          inputMatch: last.input === input,
          evalUrl: `https://eval.reppo.xyz/evaluations/${last.id}`,
        },
        null,
        2,
      ),
    );
    process.exit(last.input === input ? 0 : 3);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.error(`Timed out; last status=${last.status}`);
process.exit(4);