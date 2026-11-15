// SERVER-ONLY. Turns feedback into a strategy update proposal. SERV Reasoning reads the
// feedback and the negotiation it is about and proposes small deltas as strict JSON; zod
// validates it and applyBoundedUpdate (lib/learning/profile.ts) clamps it. If SERV fails or
// returns something invalid, a simple rule proposes the update instead and it is labelled
// "fallback".

import { z } from "zod";
import type { ReasoningAdapter } from "../adapters/reasoning";
import { formatUsd } from "../money";
import { NO_CHANGE, STEP_LIMITS, cleanNote, type LearningSource, type ProfileUpdate, type StrategyProfile } from "./profile";
import { buildReppoInput } from "./reppo-input";
import type { DealSummary, ReppoVerdict } from "./types";

export interface ProposedUpdate {
  update: ProfileUpdate;
  learned: string;
  method: "serv" | "fallback";
  fallbackReason?: string;
}

const ProposalSchema = z.object({
  aggressivenessDelta: z.number().finite(),
  walkAwayThresholdDelta: z.number().finite(),
  priority: z.enum(["keep", "save", "speed"]),
  addNote: z.string().max(400).nullable(),
  removeNoteIndex: z.number().int().nullable(),
  learned: z.string().min(1).max(400),
});

const PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    aggressivenessDelta: { type: "number", description: "Change to aggressiveness (0..1 scale). Positive = push harder on price." },
    walkAwayThresholdDelta: { type: "number", description: "Change to the walk-away limit, as a fraction of market price (e.g. 0.03 = +3% of market)." },
    priority: { type: "string", enum: ["keep", "save", "speed"], description: "New standing priority, or keep." },
    addNote: { type: ["string", "null"], description: "One short lesson to remember (max 140 chars), or null." },
    removeNoteIndex: { type: ["integer", "null"], description: "Index of an existing note that this feedback contradicts, or null." },
    learned: { type: "string", description: "One sentence, first person, telling the owner what Melit learned." },
  },
  required: ["aggressivenessDelta", "walkAwayThresholdDelta", "priority", "addNote", "removeNoteIndex", "learned"],
  additionalProperties: false,
} as const;

function systemPrompt(source: LearningSource): string {
  const step = STEP_LIMITS[source];
  return `You are the learning module of Melit, a shopping agent that haggles with sellers for its owner.
Prompt version: melit-learner-v1.
You receive the current strategy profile, one finished negotiation and one piece of feedback about it (${source === "owner" ? "from the owner" : "from Reppo, an external panel of AI evaluators"}). Propose the smallest strategy change that addresses the feedback.

Strategy knobs:
- aggressiveness (0..1): higher opens lower and concedes slower. Raise it if Melit overpaid or gave in too easily; lower it if Melit lost a deal by lowballing, annoyed the seller or took too long.
- walkAwayThreshold (fraction of market reference, 0.85..1.3): the most Melit will pay. Raise it if Melit walked away from a deal the owner wanted; lower it if the owner felt Melit paid too much.
- priority: "save" (maximise savings) or "speed" (close in fewer rounds). Change only if the feedback is clearly about it.
- notes: short lessons in the owner's words. Add one only if it is a reusable rule (not a one-off comment). Remove one only if this feedback directly contradicts it.

Limits (code clamps anything larger): |aggressivenessDelta| <= ${step.aggressiveness}, |walkAwayThresholdDelta| <= ${step.walkAwayThreshold}.
Positive feedback usually means keep the strategy (deltas 0). Never invent facts that are not in the negotiation or the feedback.
Respond only with the JSON object required by the schema. "learned" is one plain sentence addressed to the owner, e.g. "I'll open a bit higher with firm sellers so we don't lose deals."`;
}

function profileForPrompt(profile: StrategyProfile) {
  return {
    aggressiveness: profile.aggressiveness,
    walkAwayThreshold: profile.walkAwayThreshold,
    priority: profile.priority,
    notes: profile.notes.map((text, index) => ({ index, text })),
  };
}

async function askServ(reasoner: ReasoningAdapter, source: LearningSource, user: string): Promise<{ ok: true; value: ProposedUpdate } | { ok: false; reason: string }> {
  try {
    const result = await reasoner.completeJson({
      system: systemPrompt(source),
      user,
      schemaName: "melit_strategy_update",
      schema: PROPOSAL_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
    const parsed = ProposalSchema.safeParse(result.json);
    if (!parsed.success) return { ok: false, reason: `SERV output failed schema validation: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    const p = parsed.data;
    return {
      ok: true,
      value: {
        update: {
          aggressivenessDelta: p.aggressivenessDelta,
          walkAwayThresholdDelta: p.walkAwayThresholdDelta,
          priority: p.priority,
          addNote: p.addNote ? cleanNote(p.addNote) || null : null,
          removeNoteIndex: p.removeNoteIndex,
        },
        learned: p.learned.trim().slice(0, 300),
        method: "serv",
      },
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

/** Deterministic stand-in for when SERV is unavailable. Labelled "fallback" wherever it shows. */
export function ownerFallback(summary: DealSummary, rating: "up" | "down", note: string): Omit<ProposedUpdate, "method" | "fallbackReason"> {
  const text = note.toLowerCase();
  const addNote = note.trim() ? cleanNote(note) : null;
  if (rating === "up") {
    return { update: { ...NO_CHANGE, addNote }, learned: "You liked how that went, so I'm keeping my strategy." };
  }
  const overpaid = /overpa|too much|expensive|cheaper|lower|harder|push/.test(text);
  const lostDeal = /lost|missed|walk|gave up|too low|lowball|rude|insult|faster|quick|slow|long/.test(text);
  if (overpaid && !lostDeal) {
    return { update: { ...NO_CHANGE, aggressivenessDelta: 0.1, walkAwayThresholdDelta: -0.03, addNote }, learned: "You felt I paid too much, so I'll push harder on price." };
  }
  if (lostDeal && !overpaid) {
    return {
      update: { ...NO_CHANGE, aggressivenessDelta: -0.1, walkAwayThresholdDelta: 0.03, priority: /faster|quick|slow|long/.test(text) ? "speed" : "keep", addNote },
      learned: "You didn't like how hard I pushed, so I'll be gentler and more willing to close.",
    };
  }
  if (summary.outcome === "purchased" && summary.paidCents !== null && summary.paidCents > summary.marketReferenceCents) {
    return { update: { ...NO_CHANGE, aggressivenessDelta: 0.1, addNote }, learned: "I paid above the market reference, so I'll push harder next time." };
  }
  if (summary.outcome !== "purchased") {
    return { update: { ...NO_CHANGE, aggressivenessDelta: -0.1, walkAwayThresholdDelta: 0.03, addNote }, learned: "I didn't get you the item, so I'll be a bit more willing to close." };
  }
  return { update: { ...NO_CHANGE, addNote }, learned: "Noted. I'll keep that in mind next time." };
}

export async function proposeOwnerUpdate(
  reasoner: ReasoningAdapter,
  args: { summary: DealSummary; profile: StrategyProfile; rating: "up" | "down"; note: string },
): Promise<ProposedUpdate> {
  const user = `Current strategy profile:\n${JSON.stringify(profileForPrompt(args.profile), null, 2)}\n\nThe negotiation:\n${buildReppoInput(args.summary)}\n\nOwner feedback: ${args.rating === "up" ? "thumbs up" : "thumbs down"}${args.note.trim() ? `, note: "${cleanNote(args.note)}"` : " (no note)"}\n\nPropose the strategy update.`;
  const res = await askServ(reasoner, "owner", user);
  if (res.ok) return res.value;
  return { ...ownerFallback(args.summary, args.rating, args.note), method: "fallback", fallbackReason: res.reason };
}

export function reppoFallback(verdict: ReppoVerdict): Omit<ProposedUpdate, "method" | "fallbackReason"> {
  const score = verdict.score === null ? "?" : Math.round(verdict.score);
  return {
    update: NO_CHANGE,
    learned: `Reppo scored that negotiation ${score}/100 (${verdict.route ?? "no route"}). I couldn't interpret the details right now, so my strategy stays as it is.`,
  };
}

export async function proposeReppoUpdate(
  reasoner: ReasoningAdapter,
  args: { summary: DealSummary; profile: StrategyProfile; verdict: ReppoVerdict },
): Promise<ProposedUpdate> {
  const v = args.verdict;
  const verdictText = JSON.stringify(
    {
      score: v.score,
      route: v.route,
      decision: v.decision,
      confidence: v.confidence,
      reason: v.reason,
      rubricScores: v.rubric,
      evaluatorNotes: v.evaluators.map((e) => ({ model: e.model, overall: e.overall, reasoning: e.reasoning })),
    },
    null,
    2,
  );
  const paid = args.summary.paidCents === null ? "nothing paid" : `paid ${formatUsd(args.summary.paidCents)}`;
  const user = `Current strategy profile:\n${JSON.stringify(profileForPrompt(args.profile), null, 2)}\n\nThe negotiation (${paid}):\n${buildReppoInput(args.summary)}\n\nReppo verdict (external evaluator panel; route ship = good, review = needs a human look, block = bad):\n${verdictText}\n\nIf the verdict is good and gives no concrete criticism, keep the strategy. Otherwise propose the update its criticism implies. Start "learned" with "Reppo".`;
  const res = await askServ(reasoner, "reppo", user);
  if (res.ok) return res.value;
  return { ...reppoFallback(v), method: "fallback", fallbackReason: res.reason };
}
