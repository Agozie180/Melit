import { describe, expect, it } from "vitest";
import { ReppoClient, parseEvaluation } from "../lib/adapters/reppo";
import { verdictIsReady } from "../lib/learning/reppo-verdict";

describe("Reppo configuration", () => {
  it("reports configured only when REPPO_API_KEY is set and uses the default API base", () => {
    const off = new ReppoClient({ apiKey: undefined });
    expect(off.configured).toBe(false);

    const on = new ReppoClient({ apiKey: "test-key", baseUrl: "https://eval.reppo.xyz/api/v1" });
    expect(on.configured).toBe(true);
  });

  it("treats a completed evaluation with trace as ready and matches input", () => {
    const input = "deal transcript";
    const raw = {
      id: "cm_trace_1",
      status: "COMPLETED",
      input,
      result: {
        score: 88,
        route: "ship",
        decision: "accept",
        confidence: "high",
        reason: "OK",
        rubric_scores: { quality: 90 },
        consensus: { evaluators: [{ model: "gpt", overall: 88 }] },
      },
      trace: { evaluations: [{ model: "gpt", reasoning: "Looks good." }] },
    };
    const parsed = parseEvaluation(raw);
    expect(parsed.status).toBe("COMPLETED");
    expect(parsed.input).toBe(input);
    expect(verdictIsReady(parsed.verdict)).toBe(true);
    expect(parsed.verdict?.evaluators[0]?.reasoning).toMatch(/good/i);
  });
});