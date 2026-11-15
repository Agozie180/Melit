import { afterEach, describe, expect, it, vi } from "vitest";
import { ServReasoningAdapter } from "../lib/adapters/reasoning";

function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = (fetchMock.mock.calls.at(-1)?.[1] ?? {}) as RequestInit;
  return JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
}

describe("ServReasoningAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.SERV_MAX_COMPLETION_TOKENS;
    delete process.env.SERV_MAX_TOKENS;
  });

  it("sends bounded max_completion_tokens so strict json_schema does not exceed the model limit", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        model: "gpt-5.4-mini",
        choices: [{ message: { content: '{"action":"walk","offerPrice":0,"reasoning":["ok"],"confidence":0.5}' }, finish_reason: "stop" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new ServReasoningAdapter({ apiKey: "test-key", baseUrl: "https://inference.example/v1" });
    await adapter.completeJson({
      system: "sys",
      user: "user",
      schemaName: "test",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    });

    const body = lastFetchBody(fetchMock);
    expect(body.max_completion_tokens).toBe(2048);
    expect(body.max_completion_tokens).toBeLessThanOrEqual(16_000);
    expect(body.max_tokens).toBeUndefined();
  });

  it("honours SERV_MAX_COMPLETION_TOKENS when set", async () => {
    process.env.SERV_MAX_COMPLETION_TOKENS = "512";
    const fetchMock = vi.fn(async () =>
      Response.json({
        model: "gpt-5.4-mini",
        choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new ServReasoningAdapter({ apiKey: "test-key", baseUrl: "https://inference.example/v1" });
    await adapter.completeJson({
      system: "sys",
      user: "user",
      schemaName: "test",
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    });
    expect(lastFetchBody(fetchMock).max_completion_tokens).toBe(512);
  });
});