import type { ReppoVerdict } from "./types";

/** Reppo documents score, route, and result as null until the evaluation is fully COMPLETED. */
export function verdictIsReady(verdict: ReppoVerdict | null | undefined): verdict is ReppoVerdict {
  if (!verdict) return false;
  return verdict.score !== null && typeof verdict.route === "string" && verdict.route.length > 0;
}