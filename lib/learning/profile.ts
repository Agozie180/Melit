// Melit's learned negotiation strategy. Shared by client (localStorage) and server (prompt
// injection), so it must stay free of Node-only imports.
//
// Every change goes through applyBoundedUpdate: whatever proposed the change (SERV turning an
// owner note into an update, the market-review rule, or a Reppo verdict), a single update can
// only move each knob by a bounded step and the result always stays inside the hard range.

import { z } from "zod";

export type StrategyPriority = "save" | "speed";
export type LearningSource = "owner" | "market" | "reppo";

export interface StrategyProfile {
  /** 0 = gentle (opens near market), 1 = very aggressive (opens far below market). */
  aggressiveness: number;
  /** Highest final ask Melit will accept, as a multiple of the market reference price. */
  walkAwayThreshold: number;
  priority: StrategyPriority;
  notes: string[];
  /** Number of updates applied so far; 0 means the untouched default strategy. */
  version: number;
  updatedAt: number;
}

export const PROFILE_LIMITS = {
  aggressiveness: { min: 0, max: 1 },
  walkAwayThreshold: { min: 0.85, max: 1.3 },
  maxNotes: 6,
  maxNoteLength: 140,
} as const;

/** Largest change one update may make, per source. */
export const STEP_LIMITS: Record<LearningSource, { aggressiveness: number; walkAwayThreshold: number }> = {
  owner: { aggressiveness: 0.15, walkAwayThreshold: 0.05 },
  reppo: { aggressiveness: 0.1, walkAwayThreshold: 0.04 },
  market: { aggressiveness: 0.05, walkAwayThreshold: 0.02 },
};

export const DEFAULT_PROFILE: StrategyProfile = {
  aggressiveness: 0.5,
  walkAwayThreshold: 1.05,
  priority: "save",
  notes: [],
  version: 0,
  updatedAt: 0,
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function cleanNote(note: string): string {
  return note.replace(/\s+/g, " ").trim().slice(0, PROFILE_LIMITS.maxNoteLength);
}

/** Lenient parse for anything that claims to be a profile (client storage, request bodies). */
export const StrategyProfileSchema = z
  .object({
    aggressiveness: z.number().finite(),
    walkAwayThreshold: z.number().finite(),
    priority: z.enum(["save", "speed"]),
    notes: z.array(z.string()).max(20),
    version: z.number().int().nonnegative().max(1_000_000),
    updatedAt: z.number().finite().nonnegative(),
  })
  .transform(
    (p): StrategyProfile => ({
      aggressiveness: round3(clamp(p.aggressiveness, PROFILE_LIMITS.aggressiveness.min, PROFILE_LIMITS.aggressiveness.max)),
      walkAwayThreshold: round3(clamp(p.walkAwayThreshold, PROFILE_LIMITS.walkAwayThreshold.min, PROFILE_LIMITS.walkAwayThreshold.max)),
      priority: p.priority,
      notes: p.notes.map(cleanNote).filter(Boolean).slice(-PROFILE_LIMITS.maxNotes),
      version: p.version,
      updatedAt: p.updatedAt,
    }),
  );

export function parseProfile(raw: unknown): StrategyProfile {
  const parsed = StrategyProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_PROFILE;
}

export interface ProfileUpdate {
  aggressivenessDelta: number;
  walkAwayThresholdDelta: number;
  priority: StrategyPriority | "keep";
  addNote: string | null;
  removeNoteIndex: number | null;
}

export const NO_CHANGE: ProfileUpdate = {
  aggressivenessDelta: 0,
  walkAwayThresholdDelta: 0,
  priority: "keep",
  addNote: null,
  removeNoteIndex: null,
};

export interface AppliedUpdate {
  profile: StrategyProfile;
  /** Human-readable list of what actually changed (after bounding). */
  changes: string[];
  /** True when a proposed delta had to be cut down to the per-update step limit. */
  capped: boolean;
}

export function applyBoundedUpdate(
  current: StrategyProfile,
  update: ProfileUpdate,
  source: LearningSource,
  now: number = Date.now(),
): AppliedUpdate {
  const base = parseProfile(current);
  const step = STEP_LIMITS[source];
  const changes: string[] = [];
  let capped = false;

  const boundDelta = (delta: number, limit: number) => {
    const d = Number.isFinite(delta) ? delta : 0;
    if (Math.abs(d) > limit) capped = true;
    return clamp(d, -limit, limit);
  };

  const aggressiveness = round3(
    clamp(base.aggressiveness + boundDelta(update.aggressivenessDelta, step.aggressiveness), PROFILE_LIMITS.aggressiveness.min, PROFILE_LIMITS.aggressiveness.max),
  );
  if (aggressiveness !== base.aggressiveness) {
    changes.push(`aggressiveness ${base.aggressiveness.toFixed(2)} → ${aggressiveness.toFixed(2)}`);
  }

  const walkAwayThreshold = round3(
    clamp(
      base.walkAwayThreshold + boundDelta(update.walkAwayThresholdDelta, step.walkAwayThreshold),
      PROFILE_LIMITS.walkAwayThreshold.min,
      PROFILE_LIMITS.walkAwayThreshold.max,
    ),
  );
  if (walkAwayThreshold !== base.walkAwayThreshold) {
    changes.push(`walk-away ${Math.round(base.walkAwayThreshold * 100)}% → ${Math.round(walkAwayThreshold * 100)}% of market`);
  }

  let priority = base.priority;
  if (update.priority !== "keep" && update.priority !== base.priority) {
    priority = update.priority;
    changes.push(`priority ${base.priority} → ${priority}`);
  }

  let notes = [...base.notes];
  if (update.removeNoteIndex !== null && Number.isInteger(update.removeNoteIndex) && update.removeNoteIndex >= 0 && update.removeNoteIndex < notes.length) {
    changes.push(`dropped note "${notes[update.removeNoteIndex]}"`);
    notes.splice(update.removeNoteIndex, 1);
  }
  const note = update.addNote ? cleanNote(update.addNote) : "";
  if (note && !notes.some((n) => n.toLowerCase() === note.toLowerCase())) {
    notes.push(note);
    if (notes.length > PROFILE_LIMITS.maxNotes) notes = notes.slice(-PROFILE_LIMITS.maxNotes);
    changes.push(`noted "${note}"`);
  }

  const changed = changes.length > 0;
  return {
    profile: {
      aggressiveness,
      walkAwayThreshold,
      priority,
      notes,
      version: changed ? base.version + 1 : base.version,
      updatedAt: changed ? now : base.updatedAt,
    },
    changes,
    capped,
  };
}
