import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { run, step } from "../src/sim/engine";
import { hashHex } from "../src/sim/hash";
import { checkInvariants } from "../src/sim/invariants";
import { ECON } from "../src/sim/data/economy";
import type { Intervention } from "../src/sim/types";

/** The M1–M3 regression world: one civilization of 30 on a small map. */
const SMALL = { civs: 1 as const, population: 30, size: "small" as const, disasters: "off" as const };

/** docs/08 M2 acceptance: 200 seeds, invariants on, starvation rare, drought moves prices, fast. */
const SEEDS = Array.from({ length: 100 }, (_, i) => (i + 1) * 7919);

describe("M2 economy — 100-seed harness", () => {
  const results = SEEDS.map((seed) => {
    const w = generateWorld(seed, SMALL);
    const t0 = performance.now();
    const r = run(w, 545, { strict: true });
    return { seed, ms: performance.now() - t0, deaths: r.events.filter((e) => e.type === "life.death" && e.data?.cause === "starvation").length, events: r.events, last: r.metrics[544], world: w };
  });

  it("holds every invariant for 545 days on every seed (money conserved, no negative stocks)", () => {
    for (const r of results) expect(checkInvariants(r.world), `seed ${r.seed}`).toEqual([]);
  });

  it("nobody starves in more than 10 % of normal worlds", () => {
    const withDeaths = results.filter((r) => r.deaths > 0).length;
    expect(withDeaths / results.length, `${withDeaths} seeds had starvation deaths`).toBeLessThanOrEqual(0.1);
  });

  it("runs 545 days in under 500 ms per world (headless)", () => {
    const avg = results.reduce((a, r) => a + r.ms, 0) / results.length;
    expect(avg).toBeLessThan(500);
  });

  it("has a living economy: hiring and upgrades happen, prices stay bounded (founding is tested on the 100-person world)", () => {
    const upgraded = results.filter((r) => r.events.some((e) => e.type === "econ.business_upgraded")).length;
    const hired = results.filter((r) => r.events.some((e) => e.type === "life.hired")).length;
    expect(upgraded / results.length).toBeGreaterThan(0.5);
    expect(hired / results.length).toBeGreaterThan(0.8);
    for (const r of results) {
      const m = r.world.markets[0];
      expect(m.price.food).toBeGreaterThanOrEqual(Math.floor((ECON.basePrice.food * ECON.priceFloorPct) / 100));
      expect(m.price.food).toBeLessThanOrEqual(Math.floor((ECON.basePrice.food * ECON.priceCeilPct) / 100));
    }
  });
});

describe("M2 economy — causality and determinism", () => {
  it("a 100-day drought at least doubles the food price within 160 days in most worlds; the same worlds without it stay near base", () => {
    let doubled = 0;
    for (const seed of [7919, 42, 2026, 123456]) {
      const drought: Intervention[] = [{ day: 30, type: "disaster", kind: "drought", settlement: 0, intensity: 80 }];
      const a = generateWorld(seed, SMALL);
      const b = generateWorld(seed, SMALL);
      let peakA = 0;
      let peakB = 0;
      for (let d = 1; d <= 160; d++) {
        step(a, d === 30 ? drought : [], { strict: true });
        step(b, [], { strict: true });
        peakA = Math.max(peakA, a.markets[0].price.food);
        peakB = Math.max(peakB, b.markets[0].price.food);
      }
      if (peakA >= ECON.basePrice.food * 2) doubled++;
      expect(peakB, `seed ${seed} control`).toBeLessThan(ECON.basePrice.food * 1.2);
    }
    expect(doubled, "seeds where the drought doubled the price").toBeGreaterThanOrEqual(3);
  });

  it("replays identically: same seed + same interventions → same hash; different interventions → different hash", () => {
    const iv: Intervention[] = [{ day: 100, type: "disaster", kind: "drought", settlement: 0, intensity: 30 }];
    const a = generateWorld(99, SMALL);
    const b = generateWorld(99, SMALL);
    const c = generateWorld(99, SMALL);
    run(a, 200, { interventions: iv });
    run(b, 200, { interventions: iv });
    run(c, 200);
    expect(hashHex(a)).toBe(hashHex(b));
    expect(hashHex(a)).not.toBe(hashHex(c));
  });

  it("common random numbers: an intervention does not change the weather stream's position", () => {
    const iv: Intervention[] = [{ day: 50, type: "disaster", kind: "drought", settlement: 0, intensity: 30 }];
    const a = generateWorld(5, SMALL);
    const b = generateWorld(5, SMALL);
    run(a, 120, { interventions: iv });
    run(b, 120);
    expect(a.rng.weather).toEqual(b.rng.weather);
  });

  it("refuses interventions it does not implement instead of silently ignoring them", () => {
    const w = generateWorld(1, SMALL);
    expect(() => step(w, [{ day: 1, type: "fund_project", project: 0, amount: 100 }])).toThrow(/not implemented/);
  });
});
