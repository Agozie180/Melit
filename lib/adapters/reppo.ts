// SERVER-ONLY. Reppo Eval Router client (an external, asynchronous judge).
//
// Endpoints per https://eval.reppo.xyz/agents.md (the older /agents/eval-requests paths on
// docs.reppo.ai now return 404):
//   POST /api/v1/agents/evals        { taskType: "claim"|"response"|"action", input: string <= 50 KB }
//                                    -> 201 { id, status: "QUEUED", ... }
//   GET  /api/v1/agents/evals/{id}   -> { status: QUEUED|PROCESSING|COMPLETED|FAILED, score, route, result, trace }
// Errors: 400 validation, 401 bad key, 402 out of credits, 404 unknown id, 500, 502 (not queued).
// A text evaluation costs 440 credits and is only charged once it COMPLETES.

import type { ReppoVerdict } from "../learning/types";

const DEFAULT_BASE_URL = "https://eval.reppo.xyz/api/v1";
const TIMEOUT_MS = 15_000;
export const REPPO_MAX_INPUT_BYTES = 50 * 1024;

export type ReppoTaskType = "claim" | "response" | "action";
export type ReppoRemoteStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export class ReppoError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when Reppo could not be reached. */
    readonly status: number,
    /** Whether submitting/polling again later can succeed. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface ReppoEvaluation {
  id: string;
  status: ReppoRemoteStatus;
  /** The text Reppo evaluated, used to check a verdict belongs to a given negotiation. */
  input: string | null;
  verdict: ReppoVerdict | null;
  error: string | null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown, max = 1200): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function parseEvaluation(raw: unknown): ReppoEvaluation {
  const data = obj(raw);
  const id = str(data.id, 120);
  const status = data.status;
  if (!id || (status !== "QUEUED" && status !== "PROCESSING" && status !== "COMPLETED" && status !== "FAILED")) {
    throw new ReppoError("Reppo returned an unexpected evaluation shape", 200, true);
  }
  let verdict: ReppoVerdict | null = null;
  if (status === "COMPLETED") {
    const result = obj(data.result);
    const rubric: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(result.rubric_scores))) {
      const n = num(v);
      if (n !== null) rubric[k.slice(0, 40)] = n;
    }
    const reasoningByModel = new Map<string, string>();
    const traceEvals = obj(data.trace).evaluations;
    if (Array.isArray(traceEvals)) {
      for (const e of traceEvals) {
        const model = str(obj(e).model, 80);
        const reasoning = str(obj(e).reasoning, 600);
        if (model && reasoning) reasoningByModel.set(model, reasoning);
      }
    }
    const consensusEvals = obj(result.consensus).evaluators;
    const evaluators = Array.isArray(consensusEvals)
      ? consensusEvals.slice(0, 8).map((e) => {
          const model = str(obj(e).model, 80) ?? "evaluator";
          return { model, overall: num(obj(e).overall), reasoning: reasoningByModel.get(model) ?? null };
        })
      : [...reasoningByModel].slice(0, 8).map(([model, reasoning]) => ({ model, overall: null, reasoning }));
    verdict = {
      score: num(result.score) ?? num(data.score),
      route: str(result.route, 20) ?? str(data.route, 20),
      decision: str(result.decision, 20),
      confidence: str(result.confidence, 20),
      reason: str(result.reason),
      rubric,
      evaluators,
      completedAt: str(data.completedAt, 40),
    };
  }
  return { id, status, input: typeof data.input === "string" ? data.input : null, verdict, error: status === "FAILED" ? (str(data.error, 300) ?? "Reppo marked the evaluation FAILED (not charged).") : null };
}

function describeHttpError(status: number, body: string): ReppoError {
  const detail = body ? `: ${body.slice(0, 200)}` : "";
  switch (status) {
    case 400:
      return new ReppoError(`Reppo rejected the submission (400)${detail}`, status, false);
    case 401:
      return new ReppoError("Reppo rejected the API key (401). Check REPPO_API_KEY.", status, false);
    case 402:
      return new ReppoError("Reppo account is out of evaluation credits (402).", status, false);
    case 404:
      return new ReppoError("Reppo has no evaluation with that id (404).", status, false);
    case 502:
      return new ReppoError("Reppo couldn't queue the evaluation (502, not charged).", status, true);
    default:
      return new ReppoError(`Reppo returned HTTP ${status}${detail}`, status, status >= 500 || status === 429);
  }
}

export class ReppoClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts?: { apiKey?: string; baseUrl?: string; fetchImpl?: typeof fetch }) {
    this.apiKey = opts?.apiKey ?? (process.env.REPPO_API_KEY || undefined);
    this.baseUrl = (opts?.baseUrl ?? (process.env.REPPO_BASE_URL || DEFAULT_BASE_URL)).replace(/\/+$/, "");
    this.fetchImpl = opts?.fetchImpl ?? fetch;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.apiKey) throw new ReppoError("REPPO_API_KEY is not set", 0, false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
      });
    } catch (err) {
      const msg = (err as Error).name === "AbortError" ? `timed out after ${TIMEOUT_MS / 1000}s` : (err as Error).message;
      throw new ReppoError(`Reppo unreachable: ${msg}`, 0, true);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw describeHttpError(res.status, await res.text().catch(() => ""));
    return res.json().catch(() => {
      throw new ReppoError("Reppo returned invalid JSON", res.status, true);
    });
  }

  async submit(taskType: ReppoTaskType, input: string): Promise<ReppoEvaluation> {
    if (!input.trim()) throw new ReppoError("Evaluation input is empty", 400, false);
    if (new TextEncoder().encode(input).length > REPPO_MAX_INPUT_BYTES) throw new ReppoError("Evaluation input exceeds 50 KB", 400, false);
    return parseEvaluation(await this.request("/agents/evals", { method: "POST", body: JSON.stringify({ taskType, input }) }));
  }

  async get(id: string): Promise<ReppoEvaluation> {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) throw new ReppoError("Invalid evaluation id", 400, false);
    return parseEvaluation(await this.request(`/agents/evals/${encodeURIComponent(id)}`, { method: "GET" }));
  }
}

let singleton: ReppoClient | undefined;
export function getReppoClient(): ReppoClient {
  singleton ??= new ReppoClient();
  return singleton;
}
