// Builds a Passport session delegation JSON for Melit's mock x402 seller checkouts.

export type MelitSessionDelegationOpts = {
  sellerBaseUrl: string;
  taskSummary: string;
  maxAmountPerTxUsd: string;
  maxTotalAmountUsd: string;
  currency?: string;
};

function hostFromUrl(baseUrl: string): string {
  return new URL(baseUrl.replace(/\/+$/, "")).host;
}

/** Scoped x402 delegation so session execute may call our public checkout paths. */
export function buildMelitCheckoutDelegation(opts: MelitSessionDelegationOpts): string {
  const host = hostFromUrl(opts.sellerBaseUrl);
  const delegation = {
    task: { summary: opts.taskSummary },
    payment_policy: {
      currency: opts.currency ?? "USD",
      max_amount_per_tx: opts.maxAmountPerTxUsd,
      max_total_amount: opts.maxTotalAmountUsd,
    },
    execution_constraints: {
      x402: {
        scope_mode: "scoped",
        allowed_endpoints: [
          {
            host,
            method: "GET",
            path_prefix: "/api/sellers/",
          },
        ],
      },
    },
  };
  return JSON.stringify(delegation);
}