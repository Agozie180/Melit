import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReasoningAdapter } from "../lib/adapters/reasoning";
import { ReppoClient, ReppoError, parseEvaluation } from "../lib/adapters/reppo";
import { proposeOwnerUpdate, proposeReppoUpdate } from "../lib/learning/feedback";
import { marketLesson } from "../lib/learning/market";
import { learningMetrics } from "../lib/learning/metrics";
import {
  DEFAULT_PROFILE,
  PROFILE_LIMITS,
  STEP_LIMITS,
  applyBoundedUpdate,
  parseProfile,
  type LearningSource,
  type ProfileUpdate,
  type StrategyProfile,
} from "../lib/learning/profile";
import { reputationFor } from "../lib/learning/reputation";
import { buildReppoInput, scrubForReppo } from "../lib/learning/reppo-input";
import { REPPO_MAX_ATTEMPTS, enqueue, markError, markPolled, markSubmitted, nextAction } from "../lib/learning/reppo-queue";
import type { DealRecord, DealSummary, ReppoVerdict, SellerReview } from "../lib/learning/types";
import { getCatalogItem, publicCatalog } from "../lib/market/catalog";
import { reviewDeal, verifiedReviews } from "../lib/market/reviews";
import { sellerRespond } from "../lib/market/seller";
import { decide, type NegotiationContext } from "../lib/negotiation/negotiator";
import { runShopping } from "../lib/negotiation/run";
import { verifyDealSummary } from "../lib/server/deal-summary";
import type { FeedEvent } from "../lib/types";

function fakeReasoner(responses: unknown[] | ((user: string, system: string) => unknown)): ReasoningAdapter & { calls: { system: string; user: string }[] } {
  const calls: { system: string; user: string }[] = [];
  return {
    provider: "fake",
    model: "fake-model",
    configured: true,
    calls,
    async completeJson({ system, user }) {
      calls.push({ system, user });
      const next = typeof responses === "function" ? responses(user, system) : responses.shift();
      if (next instanceof Error) throw next;
      return { json: next, model: "fake-model" };
    },
  };
}

async function collect(gen: AsyncGenerator<FeedEvent>) {
  const out: FeedEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// Deterministic PRNG so the fuzz test is reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

const earbuds = publicCatalog().find((i) => i.id === "earbuds")!;
const offerAt = (usd: number) => ({ action: "offer", offerPrice: usd, reasoning: ["Offer."], confidence: 0.7 });

async function purchaseSummary(): Promise<DealSummary> {
  const events = await collect(runShopping({ query: "earbuds", maxPriceCents: 120_00, priority: "save" }, [], fakeReasoner(() => offerAt(90))));
  const s = events.find((e) => e.type === "summary");
  if (s?.type !== "summary") throw new Error("no summary");
  return s.summary;
}

describe("strategy profile bounds", () => {
  it("random updates from any source never leave the hard range or exceed the per-update step", () => {
    const rand = rng(42);
    const sources: LearningSource[] = ["owner", "market", "reppo"];
    let profile: StrategyProfile = DEFAULT_PROFILE;
    for (let i = 0; i < 2000; i++) {
      const source = sources[Math.floor(rand() * 3)];
      const wild = (scale: number) => (rand() < 0.05 ? [NaN, Infinity, -Infinity][Math.floor(rand() * 3)] : (rand() - 0.5) * scale);
      const update: ProfileUpdate = {
        aggressivenessDelta: wild(10),
        walkAwayThresholdDelta: wild(5),
        priority: (["keep", "save", "speed"] as const)[Math.floor(rand() * 3)],
        addNote: rand() < 0.5 ? "x".repeat(Math.floor(rand() * 400)) + i : null,
        removeNoteIndex: rand() < 0.3 ? Math.floor(rand() * 10) - 2 : null,
      };
      const { profile: next } = applyBoundedUpdate(profile, update, source, 1000 + i);
      const step = STEP_LIMITS[source];
      expect(next.aggressiveness).toBeGreaterThanOrEqual(PROFILE_LIMITS.aggressiveness.min);
      expect(next.aggressiveness).toBeLessThanOrEqual(PROFILE_LIMITS.aggressiveness.max);
      expect(next.walkAwayThreshold).toBeGreaterThanOrEqual(PROFILE_LIMITS.walkAwayThreshold.min);
      expect(next.walkAwayThreshold).toBeLessThanOrEqual(PROFILE_LIMITS.walkAwayThreshold.max);
      expect(Math.abs(next.aggressiveness - profile.aggressiveness)).toBeLessThanOrEqual(step.aggressiveness + 1e-9);
      expect(Math.abs(next.walkAwayThreshold - profile.walkAwayThreshold)).toBeLessThanOrEqual(step.walkAwayThreshold + 1e-9);
      expect(next.notes.length).toBeLessThanOrEqual(PROFILE_LIMITS.maxNotes);
      expect(next.notes.every((n) => n.length <= PROFILE_LIMITS.maxNoteLength)).toBe(true);
      expect(Number.isFinite(next.aggressiveness) && Number.isFinite(next.walkAwayThreshold)).toBe(true);
      profile = next;
    }
  });

  it("reports when a proposal was capped and leaves version alone when nothing changes", () => {
    const capped = applyBoundedUpdate(DEFAULT_PROFILE, { aggressivenessDelta: 0.9, walkAwayThresholdDelta: 0, priority: "keep", addNote: null, removeNoteIndex: null }, "owner");
    expect(capped.capped).toBe(true);
    expect(capped.profile.aggressiveness).toBeCloseTo(0.65);
    expect(capped.profile.version).toBe(1);
    const same = applyBoundedUpdate(DEFAULT_PROFILE, { aggressivenessDelta: 0, walkAwayThresholdDelta: 0, priority: "keep", addNote: null, removeNoteIndex: null }, "owner");
    expect(same.changes).toEqual([]);
    expect(same.profile.version).toBe(0);
  });

  it("clamps a tampered client profile on the server", () => {
    const p = parseProfile({ aggressiveness: 7, walkAwayThreshold: 9, priority: "speed", notes: Array(15).fill("n".repeat(500)), version: 3, updatedAt: 1 });
    expect(p.aggressiveness).toBe(1);
    expect(p.walkAwayThreshold).toBe(1.3);
    expect(p.notes).toHaveLength(6);
    expect(p.notes[0]).toHaveLength(140);
    expect(parseProfile({ aggressiveness: "high" })).toEqual(DEFAULT_PROFILE);
  });
});

describe("learned strategy in negotiation", () => {
  const ctx: NegotiationContext = {
    item: earbuds,
    round: 1,
    maxRounds: 4,
    currentAskCents: earbuds.listPriceCents,
    history: [],
    remainingBudgetCents: 300_00,
    userMaxPriceCents: 200_00,
    priority: "save",
  };

  it("injects the profile and reputation into every SERV call", async () => {
    const r = fakeReasoner([offerAt(80)]);
    await decide({ ...ctx, profile: { ...DEFAULT_PROFILE, aggressiveness: 0.8, notes: ["Never pay list price"] }, reputation: reputationFor([], earbuds.sellerId) }, r);
    expect(r.calls[0].system).toMatch(/melit-negotiator-v2/);
    const payload = JSON.parse(r.calls[0].user.slice(r.calls[0].user.indexOf("{")));
    expect(payload.strategyProfile.aggressiveness).toBe(0.8);
    expect(payload.strategyProfile.notes).toEqual(["Never pay list price"]);
    expect(payload.sellerReputation.basedOn).toBe("no reviews yet");
  });

  it("enforces the learned walk-away limit in code", async () => {
    // Walk-away at 90% of a $110 market reference = $99; the model tries to accept $129.
    const profile = { ...DEFAULT_PROFILE, walkAwayThreshold: 0.9 };
    const accept = { action: "accept", offerPrice: 129, reasoning: ["Take it."], confidence: 0.9 };
    const early = await decide({ ...ctx, profile }, fakeReasoner([accept]));
    expect(early.action).toBe("offer");
    expect(early.offerPriceCents).toBe(99_00);
    expect(early.guardrails.join(" ")).toMatch(/walk-away/);
    const last = await decide({ ...ctx, round: 4, profile }, fakeReasoner([accept]));
    expect(last.action).toBe("walk");
  });

  it("a more aggressive profile makes the fallback open lower", async () => {
    const gentle = await decide({ ...ctx, profile: { ...DEFAULT_PROFILE, aggressiveness: 0.1 } }, fakeReasoner([new Error("down")]));
    const hard = await decide({ ...ctx, profile: { ...DEFAULT_PROFILE, aggressiveness: 0.9 } }, fakeReasoner([new Error("down")]));
    expect(hard.offerPriceCents).toBeLessThan(gentle.offerPriceCents);
  });
});

describe("market feedback", () => {
  const knife = getCatalogItem("knife")!;

  it("sellers rate insulting lowballs badly and generous buyers well", () => {
    const insult = reviewDeal({ item: knife, offersCents: [40_00, 45_00, 50_00], outcome: "seller-walked", paidCents: null });
    expect(insult.pressure).toBe("insulting");
    expect(insult.rating).toBeLessThanOrEqual(2);
    const kind = reviewDeal({ item: knife, offersCents: [85_00], outcome: "purchased", paidCents: 85_00 });
    expect(kind.pressure).toBe("generous");
    expect(kind.rating).toBe(5);
    expect(JSON.stringify(insult)).not.toMatch(/72(\.0+)?\b|7200|floor/i);
  });

  it("only accepts server-signed reviews", () => {
    const review = reviewDeal({ item: knife, offersCents: [40_00], outcome: "seller-walked", paidCents: null });
    const forged: SellerReview = { ...review, rating: 5 };
    expect(verifiedReviews([review, forged, { nonsense: true }])).toEqual([review]);
  });

  it("a bad reputation makes sellers concede less and hold out higher", () => {
    const bad = Array.from({ length: 3 }, () => reviewDeal({ item: knife, offersCents: [40_00, 41_00, 42_00], outcome: "seller-walked", paidCents: null }));
    const rep = reputationFor(bad, "granite");
    expect(rep.willingness).toBeLessThan(1);
    expect(rep.floorPremium).toBeGreaterThan(0);
    const normal = sellerRespond(knife, 60_00, knife.listPriceCents, 1);
    const grumpy = sellerRespond(knife, 60_00, knife.listPriceCents, 1, rep);
    expect(normal.status).toBe("counter");
    expect(grumpy.status).toBe("counter");
    if (normal.status === "counter" && grumpy.status === "counter") expect(grumpy.priceCents).toBeGreaterThan(normal.priceCents);
    // An offer right at the usual floor is no longer enough.
    expect(sellerRespond(knife, knife.floorPriceCents, 80_00, 2, rep).status).toBe("counter");
  });

  it("other sellers use the market-wide reputation until they have their own reviews", () => {
    const bad = [reviewDeal({ item: knife, offersCents: [40_00, 41_00, 42_00], outcome: "seller-walked", paidCents: null })];
    const rep = reputationFor(bad, "breezy");
    expect(rep.sellerId).toBeNull();
    expect(rep.willingness).toBeLessThan(1);
  });

  it("the market rule nudges aggressiveness down after a bad review", () => {
    const review = reviewDeal({ item: knife, offersCents: [40_00], outcome: "seller-walked", paidCents: null });
    const lesson = marketLesson(review, reputationFor([review], "granite"));
    expect(lesson?.update.aggressivenessDelta).toBeLessThan(0);
    const applied = applyBoundedUpdate(DEFAULT_PROFILE, lesson!.update, "market");
    expect(applied.profile.aggressiveness).toBeCloseTo(0.45);
  });
});

describe("deal summaries and Reppo input", () => {
  it("each negotiation ends with a signed summary and a seller review", async () => {
    const events = await collect(runShopping({ query: "earbuds", maxPriceCents: 120_00, priority: "save" }, [], fakeReasoner(() => offerAt(90))));
    const types = events.map((e) => e.type);
    expect(types.slice(-2)).toEqual(["seller-review", "summary"]);
    const summary = (events.at(-1) as Extract<FeedEvent, { type: "summary" }>).summary;
    expect(summary.outcome).toBe("purchased");
    expect(verifyDealSummary(summary).ok).toBe(true);
    expect(verifyDealSummary({ ...summary, paidCents: 1 }).ok).toBe(false);
  });

  it("the Reppo input is synthetic: no addresses, hashes, emails, URLs or keys", async () => {
    const summary = await purchaseSummary();
    summary.rounds[0].reasoning.push("Pay 0x14433179E3450A5a4D5A7e0a6E81627e4e6421a8 via https://kitescan.ai/tx/0xabc, mail me@example.com, key rk_abcdef1234567890");
    const input = buildReppoInput(summary);
    expect(input).not.toMatch(/0x[0-9a-f]{6,}/i);
    expect(input).not.toMatch(/https?:\/\//);
    expect(input).not.toMatch(/@example\.com/);
    expect(input).not.toMatch(/rk_abcdef/);
    expect(input).toMatch(/Wireless Earbuds/);
    expect(new TextEncoder().encode(input).length).toBeLessThan(50 * 1024);
    expect(scrubForReppo("ok $90.00 in round 2")).toBe("ok $90.00 in round 2");
  });
});

describe("feedback via SERV", () => {
  it("clamps an over-eager SERV proposal to the per-update step", async () => {
    const summary = await purchaseSummary();
    const r = fakeReasoner([
      { aggressivenessDelta: 0.9, walkAwayThresholdDelta: -0.5, priority: "keep", addNote: "Push harder on electronics", removeNoteIndex: null, learned: "I'll push harder." },
    ]);
    const proposal = await proposeOwnerUpdate(r, { summary, profile: DEFAULT_PROFILE, rating: "down", note: "you paid too much" });
    expect(proposal.method).toBe("serv");
    const applied = applyBoundedUpdate(DEFAULT_PROFILE, proposal.update, "owner");
    expect(applied.capped).toBe(true);
    expect(applied.profile.aggressiveness).toBeCloseTo(0.65);
    expect(applied.profile.walkAwayThreshold).toBeCloseTo(1.0);
    expect(applied.profile.notes).toEqual(["Push harder on electronics"]);
  });

  it("falls back to a labelled rule when SERV fails", async () => {
    const summary = await purchaseSummary();
    const proposal = await proposeOwnerUpdate(fakeReasoner([new Error("SERV returned HTTP 503")]), { summary, profile: DEFAULT_PROFILE, rating: "down", note: "you overpaid" });
    expect(proposal.method).toBe("fallback");
    expect(proposal.fallbackReason).toMatch(/503/);
    expect(proposal.update.aggressivenessDelta).toBeGreaterThan(0);
  });

  it("turns a Reppo verdict into an update and says so", async () => {
    const summary = await purchaseSummary();
    const verdict: ReppoVerdict = { score: 62, route: "review", decision: "reject", confidence: "medium", reason: "Conceded too fast.", rubric: { accuracy: 60 }, evaluators: [], completedAt: null };
    const r = fakeReasoner([{ aggressivenessDelta: 0.05, walkAwayThresholdDelta: 0, priority: "keep", addNote: null, removeNoteIndex: null, learned: "Reppo thinks I conceded too fast." }]);
    const proposal = await proposeReppoUpdate(r, { summary, profile: DEFAULT_PROFILE, verdict });
    expect(proposal.learned).toMatch(/^Reppo/);
    expect(r.calls[0].user).toMatch(/Conceded too fast/);
    const fallback = await proposeReppoUpdate(fakeReasoner([new Error("down")]), { summary, profile: DEFAULT_PROFILE, verdict });
    expect(fallback.method).toBe("fallback");
    expect(fallback.update.aggressivenessDelta).toBe(0);
  });
});

describe("Reppo is asynchronous and optional", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("negotiation and purchase work when Reppo is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("fetch failed: ECONNREFUSED");
    }));
    const client = new ReppoClient({ apiKey: "test", baseUrl: "http://reppo.invalid/api/v1" });
    await expect(client.submit("action", "hello")).rejects.toMatchObject({ status: 0, retryable: true });
    const events = await collect(runShopping({ query: "earbuds", maxPriceCents: 120_00, priority: "save" }, [], fakeReasoner(() => offerAt(90))));
    expect(events.some((e) => e.type === "purchased")).toBe(true);
    expect(events.at(-1)?.type).toBe("summary");
  });

  it("a pending Reppo evaluation never blocks the next purchase", async () => {
    // Reppo hangs forever.
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    const client = new ReppoClient({ apiKey: "test", baseUrl: "http://reppo.invalid/api/v1" });
    void client.submit("action", "first deal").catch(() => {});
    let jobs = enqueue([], "deal_1", 0);
    jobs = markSubmitted(jobs, "deal_1", "eval_1", "QUEUED", 0);
    jobs = enqueue(jobs, "deal_2", 1);
    const events = await collect(runShopping({ query: "earbuds", maxPriceCents: 120_00, priority: "save" }, [], fakeReasoner(() => offerAt(90))));
    expect(events.some((e) => e.type === "purchased")).toBe(true);
    // The queue stays one-at-a-time: deal_2 waits while deal_1 is pending.
    expect(nextAction(jobs, 5_000)).toBeNull();
    expect(nextAction(jobs, 20_000)).toMatchObject({ type: "poll", job: { dealId: "deal_1" } });
  });

  it("queue submits the next job after a verdict, backs off on errors and gives up eventually", () => {
    let jobs = enqueue(enqueue([], "a", 0), "b", 1);
    expect(nextAction(jobs, 0)).toMatchObject({ type: "submit", job: { dealId: "a" } });
    jobs = markSubmitted(jobs, "a", "eval_a", "QUEUED", 0);
    jobs = markPolled(jobs, "a", { status: "PROCESSING", verdict: null, error: null }, 10_000);
    expect(jobs[0].state).toBe("pending");
    const verdict: ReppoVerdict = { score: 90, route: "ship", decision: "accept", confidence: "high", reason: "Good.", rubric: {}, evaluators: [], completedAt: null };
    jobs = markPolled(jobs, "a", { status: "COMPLETED", verdict, error: null }, 20_000);
    expect(jobs[0].state).toBe("verdict");
    expect(nextAction(jobs, 20_000)).toMatchObject({ type: "submit", job: { dealId: "b" } });
    for (let i = 0; i < REPPO_MAX_ATTEMPTS; i++) jobs = markError(jobs, "b", "Reppo unreachable", true, 30_000);
    expect(jobs[1].state).toBe("failed");
    expect(markError(enqueue([], "c", 0), "c", "402 credits", false, 0)[0].state).toBe("failed");
  });

  it("parses a completed Reppo evaluation", () => {
    const e = parseEvaluation({
      id: "cm123",
      status: "COMPLETED",
      input: "x",
      score: 97,
      route: "review",
      result: {
        score: 97,
        decision: "accept",
        confidence: "medium",
        route: "review",
        reason: "Solid negotiation.",
        rubric_scores: { accuracy: 98, completeness: 95, bogus: "x" },
        consensus: { evaluators: [{ model: "gpt", overall: 96, evaluator: "e1" }] },
      },
      trace: { evaluations: [{ model: "gpt", reasoning: "Fine." }] },
    });
    expect(e.verdict).toMatchObject({ score: 97, route: "review", rubric: { accuracy: 98, completeness: 95 }, evaluators: [{ model: "gpt", overall: 96, reasoning: "Fine." }] });
    expect(() => parseEvaluation({ id: "x", status: "WEIRD" })).toThrow(ReppoError);
  });
});

describe("learning metrics", () => {
  const rec = (over: Partial<DealRecord>): DealRecord => ({
    dealId: Math.random().toString(36),
    at: 0,
    itemName: "x",
    sellerName: "y",
    outcome: "purchased",
    listPriceCents: 100_00,
    marketReferenceCents: 90_00,
    paidCents: 80_00,
    rounds: 2,
    profileVersion: 0,
    summary: null,
    review: null,
    feedback: null,
    ...over,
  });

  it("splits before and after feedback and ignores guard blocks", () => {
    const m = learningMetrics([
      rec({ paidCents: 90_00, feedback: { rating: "down", note: "", at: 0 } }),
      rec({ outcome: "seller-walked", paidCents: null }),
      rec({ outcome: "blocked", paidCents: null }),
      rec({ profileVersion: 1, paidCents: 75_00, feedback: { rating: "up", note: "", at: 0 } }),
    ]);
    expect(m.before).toMatchObject({ negotiations: 2, closed: 1, closedPct: 50, avgSavedPct: 10, approvalPct: 0 });
    expect(m.after).toMatchObject({ negotiations: 1, closedPct: 100, avgSavedPct: 25, approvalPct: 100 });
  });
});
