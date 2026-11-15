export const WEEKLY_CAP_CENTS = 300_00;
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const MELIT_FEE_RATE = 0.15;

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Melit keeps 15% of what it saved; the user keeps the rest (so the two always sum exactly). */
export function splitSavings(savedCents: number): { feeCents: number; userCents: number } {
  const feeCents = Math.round(savedCents * MELIT_FEE_RATE);
  return { feeCents, userCents: savedCents - feeCents };
}
