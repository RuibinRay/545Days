import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { DAYS, run, step } from "../src/sim/engine";
import { hashHex } from "../src/sim/hash";
import { cloneState, fromPortable, replay, snapshotBefore, takeSnapshot, toPortable } from "../src/sim/snapshot";
import { resolveEnding } from "../src/sim/story/endings";
import type { Intervention, Snapshot } from "../src/sim/types";

/** The M1–M3 regression world: one civilization of 30 on a small map. */
const SMALL = { civs: 1 as const, population: 30, size: "small" as const, disasters: "off" as const };

/** docs/08 M3 acceptance: replay from any snapshot reaches the identical hash; save/load round-trips; Day 545 always has an epilogue. */
describe("M3 — snapshots and replay", () => {
  const iv: Intervention[] = [
    { day: 40, type: "disaster", kind: "drought", settlement: 0, intensity: 30 },
    { day: 200, type: "disaster", kind: "drought", settlement: 0, intensity: 50 },
  ];

  it("replaying from every 30-day snapshot reaches the same hash as the original run", () => {
    const w = generateWorld(4242, SMALL);
    const snapshots: Snapshot[] = [takeSnapshot(w)];
    const byDay = new Map(iv.map((x) => [x.day, [x]]));
    const hashes = new Map<number, string>();
    while (w.day < 300) {
      step(w, byDay.get(w.day + 1) ?? []);
      if (w.day % 30 === 0) snapshots.push(takeSnapshot(w));
      if (w.day % 50 === 0) hashes.set(w.day, hashHex(w));
    }
    for (const [day, h] of hashes) {
      const from = snapshotBefore(snapshots, day)!;
      const r = replay(from, iv, day);
      expect(hashHex(r.state), `replay to day ${day} from snapshot ${from.day}`).toBe(h);
    }
  });

  it("a snapshot is independent of the live state", () => {
    const w = generateWorld(9, SMALL);
    run(w, 20);
    const snap = takeSnapshot(w);
    run(w, 20);
    expect(snap.state.day).toBe(20);
    expect(w.day).toBe(40);
    expect(hashHex(snap.state)).not.toBe(hashHex(w));
  });

  it("portable JSON and structuredClone both round-trip the state exactly", () => {
    const w = generateWorld(77, SMALL);
    run(w, 60, { interventions: iv.slice(0, 1) });
    const h = hashHex(w);
    const viaJson = fromPortable(JSON.parse(JSON.stringify(toPortable(w))));
    const viaClone = cloneState(w);
    expect(hashHex(viaJson)).toBe(h);
    expect(hashHex(viaClone)).toBe(h);
    // and they keep simulating identically
    run(viaJson, 30);
    run(viaClone, 30);
    run(w, 30);
    expect(hashHex(viaJson)).toBe(hashHex(w));
    expect(hashHex(viaClone)).toBe(hashHex(w));
  });
});

describe("M3 — endings", () => {
  it("Day 545 always produces an ending with an epilogue, on 50 seeds", () => {
    const titles = new Map<string, number>();
    for (let i = 1; i <= 50; i++) {
      const w = generateWorld(i * 101, SMALL);
      const r = run(w, DAYS, { stopAtTerminal: true });
      expect(r.ending, `seed ${i * 101}`).not.toBeNull();
      expect(r.ending!.epilogue.length).toBeGreaterThanOrEqual(3);
      expect(r.ending!.epilogue.join(" ")).toContain(w.settlements[0].name);
      expect(r.events.some((e) => e.type === "story.countdown_end")).toBe(true);
      titles.set(r.ending!.id, (titles.get(r.ending!.id) ?? 0) + 1);
    }
    // the fallback has variants; a normal world should not be "hard" most of the time
    expect((titles.get("fallback.hard") ?? 0) / 50).toBeLessThan(0.2);
  });

  it("an extinct world ends early with The Empty Valley", () => {
    const w = generateWorld(3, SMALL);
    // no food, no money anywhere, nothing to pay wages with: starvation within days
    for (const c of w.citizens) {
      c.foodStock = 0;
      c.wealth = 0;
      c.health = 5;
    }
    w.civs[0].treasury = 0;
    for (const b of w.businesses) {
      b.inventory.food = 0;
      b.cash = 0;
    }
    w.initialMoney = 0;
    const r = run(w, DAYS, { stopAtTerminal: true });
    expect(r.ending?.id).toBe("fallback.empty");
    expect(w.day).toBeLessThan(DAYS);
    expect(r.events.some((e) => e.type === "story.extinction")).toBe(true);
  });

  it("resolveEnding is pure: same inputs → same text", () => {
    const w = generateWorld(11, SMALL);
    const r = run(w, DAYS, { stopAtTerminal: true });
    const a = resolveEnding(w, r.events, r.metrics);
    const b = resolveEnding(cloneState(w), [...r.events], [...r.metrics]);
    expect(a).toEqual(b);
  });
});
