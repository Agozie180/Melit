// SERVER-ONLY. Reasoning adapter.
//
// SERV Reasoning (docs.openserv.ai/serv-reasoning) is wire-compatible with the OpenAI Chat
// Completions API: POST https://inference-api.openserv.ai/v1/chat/completions with a bearer
// key, a required system message, and an optional strict `response_format: json_schema`.
// The adapter only returns raw model JSON; validation and fallbacks live in the negotiator.

export interface ReasoningResult {
  /** Parsed JSON object returned by the model (still unvalidated). */
  json: unknown;
  model: string;
}

export interface ReasoningAdapter {
  readonly provider: string;
  readonly model: string;
  readonly configured: boolean;
  completeJson(args: {
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<ReasoningResult>;
}

export class ReasoningError extends Error {}

const SERV_BASE_URL = "https://inference-api.openserv.ai/v1";
const TIMEOUT_MS = 25_000;
/** Cap completion size so strict json_schema does not bump max_tokens past the model limit (128k). */
const DEFAULT_MAX_COMPLETION_TOKENS = 2048;

function maxCompletionTokens(): number {
  const raw = process.env.SERV_MAX_COMPLETION_TOKENS ?? process.env.SERV_MAX_TOKENS;
  if (raw == null || raw === "") return DEFAULT_MAX_COMPLETION_TOKENS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 64) return DEFAULT_MAX_COMPLETION_TOKENS;
  return Math.min(n, 16_000);
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export class ServReasoningAdapter implements ReasoningAdapter {
  readonly provider = "SERV Reasoning";
  readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(opts?: { apiKey?: string; model?: string; baseUrl?: string }) {
    this.apiKey = opts?.apiKey ?? (process.env.OPENSERV_API_KEY || process.env.SERV_API_KEY || undefined);
    this.model = opts?.model ?? (process.env.SERV_MODEL || "gpt-5.4-mini");
    this.baseUrl = opts?.baseUrl ?? (process.env.SERV_BASE_URL || SERV_BASE_URL);
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async completeJson(args: {
    system: string;
    user: string;
    schemaName: string;
    schema: Record<string, unknown>;
  }): Promise<ReasoningResult> {
    if (!this.apiKey) throw new ReasoningError("OPENSERV_API_KEY is not set");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          reasoning_effort: "low",
          max_completion_tokens: maxCompletionTokens(),
          messages: [
            { role: "system", content: args.system },
            { role: "user", content: args.user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: args.schemaName, strict: true, schema: args.schema },
          },
        }),
      });
    } catch (err) {
      const msg = (err as Error).name === "AbortError" ? `timed out after ${TIMEOUT_MS / 1000}s` : (err as Error).message;
      throw new ReasoningError(`SERV request failed: ${msg}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ReasoningError(`SERV returned HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
    }

    const data = (await res.json().catch(() => null)) as {
      model?: string;
      choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
    } | null;
    const choice = data?.choices?.[0];
    if (!choice?.message) throw new ReasoningError("SERV response had no message");
    if (choice.message.refusal) throw new ReasoningError(`Model refused: ${choice.message.refusal}`);
    if (choice.finish_reason === "length") throw new ReasoningError("Model output was truncated");
    const content = choice.message.content;
    if (!content) throw new ReasoningError("SERV response had empty content");

    try {
      return { json: JSON.parse(stripFences(content)), model: data?.model ?? this.model };
    } catch {
      throw new ReasoningError("Model returned invalid JSON");
    }
  }
}

let singleton: ReasoningAdapter | undefined;
export function getReasoningAdapter(): ReasoningAdapter {
  singleton ??= new ServReasoningAdapter();
  return singleton;
}
