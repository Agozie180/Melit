import { describe, expect, it } from "vitest";
import { CATALOG, findItem, publicCatalog } from "../lib/market/catalog";
import { MAX_ROUNDS, sellerRespond } from "../lib/market/seller";

describe("marketplace", () => {
  it("never exposes floor prices in the public catalog", () => {
    const json = JSON.stringify(publicCatalog());
    expect(json).not.toMatch(/floor/i);
    for (const item of CATALOG) {
      expect(item.floorPriceCents).toBeLessThan(item.listPriceCents);
    }
  });

  it("matches free-text requests to items", () => {
    expect(findItem("I need wireless earbuds")?.id).toBe("earbuds");
    expect(findItem("running shoes size 10")?.id).toBe("shoes");
    expect(findItem("spaceship")).toBeUndefined();
  });
});

describe("seller rules", () => {
  const item = CATALOG.find((i) => i.id === "earbuds")!;

  it("accepts any offer at or above the floor", () => {
    const r = sellerRespond(item, item.floorPriceCents, item.listPriceCents, 1);
    expect(r.status).toBe("accept");
  });

  it("counters with shrinking concessions that never go below the floor", () => {
    let ask = item.listPriceCents;
    let lastConcession = Infinity;
    for (let round = 1; round < MAX_ROUNDS; round++) {
      const r = sellerRespond(item, 1_00, ask, round);
      expect(r.status).toBe("counter");
      if (r.status !== "counter") return;
      expect(r.priceCents).toBeGreaterThanOrEqual(item.floorPriceCents);
      const concession = ask - r.priceCents;
      expect(concession).toBeLessThanOrEqual(lastConcession);
      lastConcession = concession;
      ask = r.priceCents;
    }
  });

  it("walks away after the final round", () => {
    expect(sellerRespond(item, 1_00, item.listPriceCents, MAX_ROUNDS).status).toBe("walk");
  });
});
