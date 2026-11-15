import { reputationFor } from "@/lib/learning/reputation";
import type { SellerReview } from "@/lib/learning/types";
import { Card, CardTitle } from "./ui";

export function Stars({ rating }: { rating: number }) {
  return (
    <span className="whitespace-nowrap text-amber-500" aria-label={`${rating} out of 5`}>
      {"★".repeat(rating)}
      <span className="text-neutral-300">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export function ReputationCard({ reviews, sellers }: { reviews: SellerReview[]; sellers: { id: string; name: string }[] }) {
  const market = reputationFor(reviews, null);
  return (
    <Card>
      <CardTitle
        aside={
          <span className="text-xs text-neutral-500">
            {market.avgRating === null ? "no reviews" : `${market.avgRating.toFixed(1)}★ overall · ${reviews.length} review${reviews.length === 1 ? "" : "s"}`}
          </span>
        }
      >
        Market reputation
      </CardTitle>
      <ul className="space-y-2 text-sm">
        {sellers.map((s) => {
          const rep = reputationFor(reviews, s.id);
          const own = rep.sellerId === s.id;
          const last = [...reviews].reverse().find((r) => r.sellerId === s.id);
          return (
            <li key={s.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{s.name}</span>
                {own && rep.avgRating !== null ? <Stars rating={Math.round(rep.avgRating)} /> : <span className="text-xs text-neutral-400">not rated yet</span>}
              </div>
              <p className="text-xs text-neutral-500">
                {rep.willingness < 1 || rep.floorPremium > 0
                  ? `Concedes ${Math.round((1 - rep.willingness) * 100)}% less${rep.floorPremium > 0 ? ` and holds out ${Math.round(rep.floorPremium * 100)}% higher` : ""}${own ? "" : " (market-wide reputation)"}`
                  : "Normal willingness to deal"}
                {last && ` · last: “${last.text}”`}
              </p>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-neutral-500">
        Mock sellers rate Melit after every negotiation with fixed rules: how far below their hidden minimum Melit pushed, how long it haggled, and how it
        ended. Low ratings make sellers concede less next time.
      </p>
    </Card>
  );
}
