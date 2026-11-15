import { PaymentFailedError, RailError, type PaymentOrder, type PaymentRail, type PaymentReceipt, type RailAttempt } from "./types";

/**
 * Tries rails in order. Any ordinary failure falls through to the next rail. A RailError with
 * allowFallback=false stops immediately: falling back after a Passport policy denial would
 * bypass the session cap, and falling back after an unknown outcome could pay twice.
 */
export class PaymentRouter {
  constructor(readonly rails: PaymentRail[]) {}

  async pay(order: PaymentOrder): Promise<PaymentReceipt> {
    const attempts: RailAttempt[] = [];
    if (this.rails.length === 0) {
      throw new PaymentFailedError("No payment rail is configured.", attempts);
    }
    for (const rail of this.rails) {
      try {
        const receipt = await rail.pay(order);
        attempts.push({ rail: rail.id, ok: true });
        return { ...receipt, attempts };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempts.push({ rail: rail.id, ok: false, error: message });
        if (err instanceof RailError && !err.allowFallback) {
          throw new PaymentFailedError(message, attempts);
        }
      }
    }
    throw new PaymentFailedError(attempts.map((a) => a.error).filter(Boolean).join(" | "), attempts);
  }
}
