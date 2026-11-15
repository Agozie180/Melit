import { DEFAULT_PROFILE, PROFILE_LIMITS, type StrategyProfile } from "@/lib/learning/profile";
import type { LearningEvent } from "@/lib/learning/types";
import { Badge, Card, CardTitle } from "./ui";
import { SourceBadge } from "./LearningLog";

function Meter({ value, min, max, def }: { value: number; min: number; max: number; def: number }) {
  const pct = ((value - min) / (max - min)) * 100;
  const defPct = ((def - min) / (max - min)) * 100;
  return (
    <div className="relative mt-1 h-2 rounded-full bg-neutral-100">
      <div className="absolute inset-y-0 left-0 rounded-full bg-violet-500 transition-all duration-500" style={{ width: `${pct}%` }} />
      <div className="absolute -top-0.5 h-3 w-px bg-neutral-400" style={{ left: `${defPct}%` }} title="Default" />
    </div>
  );
}

export function StrategyCard({
  profile,
  lastEvent,
  onReset,
  disabled,
}: {
  profile: StrategyProfile;
  lastEvent: LearningEvent | null;
  onReset: () => void;
  disabled: boolean;
}) {
  const aggr = profile.aggressiveness;
  const aggrLabel = aggr >= 0.7 ? "pushes hard" : aggr >= 0.4 ? "balanced" : "gentle";
  return (
    <Card>
      <CardTitle aside={<Badge tone={profile.version ? "violet" : "neutral"}>{profile.version ? `${profile.version} update${profile.version === 1 ? "" : "s"}` : "default"}</Badge>}>
        Melit&apos;s strategy
      </CardTitle>
      <dl className="space-y-3 text-sm">
        <div>
          <div className="flex justify-between">
            <dt className="font-medium">Aggressiveness</dt>
            <dd className="tabular-nums text-neutral-600">
              {aggr.toFixed(2)} · {aggrLabel}
            </dd>
          </div>
          <Meter value={aggr} min={PROFILE_LIMITS.aggressiveness.min} max={PROFILE_LIMITS.aggressiveness.max} def={DEFAULT_PROFILE.aggressiveness} />
        </div>
        <div>
          <div className="flex justify-between">
            <dt className="font-medium">Walk-away limit</dt>
            <dd className="tabular-nums text-neutral-600">{Math.round(profile.walkAwayThreshold * 100)}% of market price</dd>
          </div>
          <Meter
            value={profile.walkAwayThreshold}
            min={PROFILE_LIMITS.walkAwayThreshold.min}
            max={PROFILE_LIMITS.walkAwayThreshold.max}
            def={DEFAULT_PROFILE.walkAwayThreshold}
          />
        </div>
        <div className="flex justify-between">
          <dt className="font-medium">Standing priority</dt>
          <dd className="text-neutral-600">{profile.priority === "save" ? "Save money" : "Close fast"}</dd>
        </div>
        <div>
          <dt className="font-medium">Notes from feedback</dt>
          <dd>
            {profile.notes.length ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-neutral-700">
                {profile.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-neutral-500">None yet. Rate a deal below to teach Melit.</p>
            )}
          </dd>
        </div>
      </dl>
      {lastEvent && (
        <div className="mt-4 rounded-xl bg-violet-50 p-3 text-sm ring-1 ring-violet-100" aria-live="polite">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-violet-900">What Melit learned</span>
            <SourceBadge event={lastEvent} />
          </div>
          <p className="text-violet-950">{lastEvent.learned}</p>
        </div>
      )}
      <p className="mt-3 text-xs text-neutral-500">
        Sent with every negotiation and injected into each SERV Reasoning call. Each feedback can only move a setting a small, capped step.
      </p>
      <button
        type="button"
        onClick={onReset}
        disabled={disabled}
        className="mt-3 text-xs font-medium text-neutral-500 underline-offset-2 hover:text-neutral-800 hover:underline disabled:opacity-50"
      >
        Reset learning (strategy, reviews, feedback and Reppo jobs)
      </button>
    </Card>
  );
}
