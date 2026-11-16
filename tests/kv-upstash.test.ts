import { describe, expect, it } from "vitest";
import { redisValueToJsonString } from "../lib/server/kv";
import { loadDemoState, setSignedList, wipeDemoSession } from "../lib/server/demo-state";
import { signShoppingList } from "../lib/server/shopping-list";
import { randomUUID } from "node:crypto";

describe("Upstash Redis value normalization", () => {
  it("stringifies objects returned by Upstash GET deserialization", () => {
    const obj = { version: 1, ledger: [], list: null, ledgerIntegrity: "ok", pending: [] };
    const back = redisValueToJsonString(obj);
    expect(typeof back).toBe("string");
    expect(JSON.parse(back!)).toEqual(obj);
  });

  it("passes through JSON strings unchanged", () => {
    const s = '{"version":2,"ledger":[],"pending":[]}';
    expect(redisValueToJsonString(s)).toBe(s);
  });
});

describe("demo-state after Upstash-shaped payload", () => {
  const scope = `kv_${randomUUID()}`;

  it("loads a signed list when raw state is already a parsed object", async () => {
    const list = signShoppingList([{ name: "LED Desk Lamp", maxPrice: 49_00, quantity: 1 }]);
    await setSignedList(scope, list);
    const state = await loadDemoState(scope);
    await wipeDemoSession(scope);
    expect(state.ledgerIntegrity).toBe("ok");
    expect(state.list?.items[0].name).toMatch(/Lamp/i);
  });
});