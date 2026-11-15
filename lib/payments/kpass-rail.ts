// SERVER-ONLY. Rail 1: Kite Passport sandbox via the `kpass` CLI.
//
// kpass is run as a child process with an explicit argv array (no shell), so nothing from an
// order or URL is ever interpreted by a shell. The Passport backend itself fetches the seller
// URL and settles the x402 payment, which means the seller checkout must be publicly
// reachable (SELLER_BASE_URL), not localhost.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { explorerTxUrl, KITE_TESTNET } from "../kite/config";
import { signOrder } from "./order-token";
import { RailError, type PaymentOrder, type PaymentRail, type PaymentReceipt } from "./types";

export interface KpassResult {
  exitCode: number;
  json: Record<string, unknown> | null;
  stderr: string;
}

export type KpassRunner = (args: string[]) => Promise<KpassResult>;

const EXECUTE_TIMEOUT_MS = 330_000;

export function kpassBinary(): string {
  if (process.env.KPASS_BIN) return process.env.KPASS_BIN;
  const local = join(homedir(), ".local", "bin", "kpass");
  return existsSync(local) ? local : "kpass";
}

export const execKpass: KpassRunner = (args) =>
  new Promise((resolve) => {
    execFile(
      kpassBinary(),
      [...args, ...(process.env.KPASS_BASE_URL ? ["--base-url", process.env.KPASS_BASE_URL] : []), "--output", "json", "--no-interactive"],
      {
        shell: false,
        timeout: EXECUTE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        cwd: process.env.KPASS_WORKDIR || process.cwd(),
        env: { ...process.env, KPASS_NO_BROWSER: "1" },
      },
      (error, stdout, stderr) => {
        let json: Record<string, unknown> | null = null;
        try {
          json = stdout.trim() ? (JSON.parse(stdout) as Record<string, unknown>) : null;
        } catch {
          json = null;
        }
        const exitCode = error ? (typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : 1) : 0;
        resolve({ exitCode, json, stderr: String(stderr ?? "").slice(0, 2000) });
      },
    );
  });

/** Passport policy denials: the session cap is a second guard layer, so never route around it. */
const POLICY_CODES = new Set([
  "session_total_exceeded",
  "separate_session_used_up",
  "session_rule_exceeded",
  "payment_cap_exceeded",
  "session_asset_forbidden",
  "merchant_not_allowed",
]);
/** A payment may already have gone through; paying again on another rail could double-charge. */
const UNKNOWN_OUTCOME_CODES = new Set(["payment_outcome_pending", "recurring_payment_unknown", "payment_settled_unfulfilled"]);

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function dig(obj: unknown, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** Only an explicit "sandbox" answer counts. Anything else is treated as "not sandbox". */
export function isSandboxStatus(json: Record<string, unknown> | null): boolean {
  if (!json) return false;
  const candidates = [json.mode, json.environment, dig(json, "data", "mode"), dig(json, "data", "environment")];
  if (candidates.some((c) => typeof c === "string" && c.toLowerCase() === "sandbox")) return true;
  return json.sandbox === true || dig(json, "data", "sandbox") === true;
}

export class KitePassportSandboxRail implements PaymentRail {
  readonly id = "kite-passport-sandbox" as const;

  constructor(
    private readonly run: KpassRunner = execKpass,
    private readonly sellerBaseUrl: string = process.env.SELLER_BASE_URL || "",
    private readonly sessionId: string | undefined = process.env.KPASS_SESSION_ID || undefined,
  ) {}

  async pay(order: PaymentOrder): Promise<Omit<PaymentReceipt, "attempts">> {
    if (!this.sellerBaseUrl) {
      throw new RailError("SELLER_BASE_URL is not set, so Passport has no public seller endpoint to pay.");
    }

    const mode = await this.run(["sandbox", "status"]);
    if (mode.exitCode !== 0 || !isSandboxStatus(mode.json)) {
      const reason = str(mode.json?.error) ?? "kpass did not confirm sandbox mode";
      throw new RailError(`Refusing to use Kite Passport outside sandbox: ${reason}`);
    }

    const url = new URL(`/api/sellers/${encodeURIComponent(order.sellerId)}/checkout`, this.sellerBaseUrl);
    url.searchParams.set("order", signOrder(order));

    const args = ["session", "execute", "--method", "GET", "--url", url.toString(), "--idempotency-key", order.orderId, "--no-browser", "--no-wait"];
    if (this.sessionId) args.push("--session-id", this.sessionId);
    const res = await this.run(args);
    const json = res.json ?? {};
    const code = str(json.error_code);

    if (res.exitCode !== 0 || json.status !== "success") {
      const message = `kpass ${code ?? `exit ${res.exitCode}`}: ${str(json.error) ?? str(json.hint) ?? (res.stderr || "no output")}`;
      if (code && POLICY_CODES.has(code)) throw new RailError(`Passport session limit refused the payment (${message})`, false, code);
      if ((code && UNKNOWN_OUTCOME_CODES.has(code)) || res.exitCode === 7) {
        throw new RailError(`Passport payment outcome is unknown, not retrying on another rail (${message})`, false, code);
      }
      throw new RailError(message, true, code);
    }

    const status = Number(dig(json, "x402", "status_code") ?? dig(json, "payment", "status_code"));
    if (!(status >= 200 && status < 300)) {
      throw new RailError(`Seller returned HTTP ${Number.isFinite(status) ? status : "unknown"} through Passport`, false);
    }

    const txHash =
      str(dig(json, "payment", "payment_response", "reference")) ??
      str(dig(json, "x402", "payment_response", "reference")) ??
      str(dig(json, "x402", "transaction_hash")) ??
      null;
    const chainId = Number(dig(json, "x402", "chain_id"));
    const onKiteTestnet = chainId === KITE_TESTNET.chainId;

    return {
      receiptId: str(json.payment_id) ?? `kpass_${order.orderId}`,
      rail: this.id,
      amountCents: order.priceCents,
      testnetAmount: str(dig(json, "payment_requirement", "amount")) ?? null,
      asset: str(dig(json, "payment_requirement", "asset")) ?? null,
      payee: url.host,
      network: Number.isFinite(chainId) ? `eip155:${chainId}` : "Kite Passport sandbox",
      txHash,
      explorerUrl: txHash && onKiteTestnet ? explorerTxUrl(txHash) : null,
      settledAt: Date.now(),
      note: txHash ? undefined : "Passport did not return a transaction hash; check `kpass activity`.",
    };
  }
}
