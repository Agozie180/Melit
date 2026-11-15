import { describe, expect, it, vi } from "vitest";
import { ServReasoningAdapter } from "../lib/adapters/reasoning";

describe("ServReasoningAdapter", () => {
  it("sends a capped max_tokens and json_object (avoids OpenServ max_tokens 400)", async () => {
    let body: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "test",
          choices: [{ message: { content: '{"action":"walk","offerPrice":0,"reasoning":["ok"],"confidence":1}' } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const a = new ServReasoningAdapter({ apiKey: "test-key", fetchImpl });
    await a.completeJson({
      system: "You are Melit.",
      user: "Decide.",
      schemaName: "melit_negotiation_decision",
      schema: { type: "object" },
    });
    expect(body?.max_tokens).toBe(2048);
    expect((body?.response_format as { type?: string })?.type).toBe("json_object");
    expect((body?.response_format as { json_schema?: unknown })?.json_schema).toBeUndefined();
  });
});