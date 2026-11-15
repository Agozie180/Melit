import type { LearningEvent } from "@/lib/learning/types";
import { Badge, Card, CardTitle } from "./ui";

const SOURCE_LABEL: Record<LearningEvent["source"], string> = {
  owner: "Owner feedback",
  market: "Seller reviews",
  reppo: "Learned from Reppo verdict",
};

export function SourceBadge({ event }: { event: LearningEvent }) {
  return (
    <>
      <Badge tone={event.source === "reppo" ? "green" : event.source === "owner" ? "violet" : "neutral"}>{SOURCE_LABEL[event.source]}</Badge>
      {event.method === "serv" && <Badge tone="violet">SERV Reasoning</Badge>}
      {event.method === "rule" && <Badge>Deterministic rule</Badge>}
      {event.method === "fallback" && <Badge tone="amber">Fallback rule</Badge>}
    </>
  );
}

export function LearningLog({ log }: { log: LearningEvent[] }) {
  const recent = [...log].reverse().slice(0, 12);
  return (
    <Card>
      <CardTitle aside={<span className="text-xs text-neutral-500">{log.length} update{log.length === 1 ? "" : "s"}</span>}>Learning log</CardTitle>
      {recent.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing learned yet. Seller reviews, your thumbs up/down and Reppo verdicts will show up here.</p>
      ) : (
        <ol className="space-y-2">
          {recent.map((e) => (
            <li key={e.id} className="rounded-xl border border-black/[0.06] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <SourceBadge event={e} />
                <span className="ml-auto text-xs text-neutral-500">{new Date(e.at).toLocaleTimeString()}</span>
              </div>
              <p className="mt-1.5">{e.learned}</p>
              {e.changes.length > 0 ? (
                <p className="mt-1 text-xs text-neutral-500">
                  {e.changes.join(" · ")}
                  {e.capped && " · capped to the per-update limit"}
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">Strategy unchanged.</p>
              )}
              {e.method === "fallback" && e.fallbackReason && <p className="mt-1 text-xs text-amber-800">SERV unavailable: {e.fallbackReason}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
