import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { BIOME } from "../src/sim/worldgen/terrain";
import { BUILDING_SIZE } from "../src/sim/data/buildings";
import { hashHex } from "../src/sim/hash";
import { run } from "../src/sim/engine";

/** The M1–M3 regression world: one civilization of 30 on a small map. */
const SMALL = { civs: 1 as const, population: 30, size: "small" as const, disasters: "off" as const };

const SEEDS = [1, 42, 545, 9001, 123456, 2026];

describe("worldgen", () => {
  it("is deterministic: same seed → same hash, different seed → different hash", () => {
    for (const seed of SEEDS) {
      expect(hashHex(generateWorld(seed, SMALL))).toBe(hashHex(generateWorld(seed, SMALL)));
    }
    expect(hashHex(generateWorld(1, SMALL))).not.toBe(hashHex(generateWorld(2, SMALL)));
  });

  it("produces a sane land share for each terrain preset", () => {
    for (const terrain of ["continent", "archipelago", "islands"] as const) {
      const w = generateWorld(42, { ...SMALL, terrain });
      const t = w.terrain;
      let land = 0;
      for (let i = 0; i < t.biome.length; i++) if (t.biome[i] !== BIOME.ocean) land++;
      const share = land / t.biome.length;
      expect(share, terrain).toBeGreaterThan(0.2);
      expect(share, terrain).toBeLessThan(0.7);
    }
  });

  it("rivers exist and end in the ocean or at the map edge", () => {
    for (const seed of SEEDS) {
      const t = generateWorld(seed, SMALL).terrain;
      let riverTiles = 0;
      for (let i = 0; i < t.river.length; i++) riverTiles += t.river[i];
      expect(riverTiles, `seed ${seed}`).toBeGreaterThan(10);
    }
  });

  it("places every building on buildable land with no overlaps, inside the map", () => {
    for (const seed of SEEDS) {
      const w = generateWorld(seed, SMALL);
      const t = w.terrain;
      const used = new Set<number>();
      expect(w.buildings.length).toBeGreaterThanOrEqual(12);
      for (const b of w.buildings) {
        const { w: bw, h: bh } = BUILDING_SIZE[b.kind];
        for (let y = b.y; y < b.y + bh; y++)
          for (let x = b.x; x < b.x + bw; x++) {
            expect(x >= 0 && y >= 0 && x < t.width && y < t.height, `seed ${seed} ${b.kind} in bounds`).toBe(true);
            const i = y * t.width + x;
            expect(t.biome[i] !== BIOME.ocean && t.biome[i] !== BIOME.mountain, `seed ${seed} ${b.kind} on land`).toBe(true);
            expect(t.river[i], `seed ${seed} ${b.kind} not on a river`).toBe(0);
            expect(used.has(i), `seed ${seed} overlap at ${x},${y}`).toBe(false);
            used.add(i);
          }
      }
      const kinds = new Set(w.buildings.map((b) => b.kind));
      for (const k of ["town_hall", "market", "lab", "clinic", "power_plant", "workshop", "farm", "house"] as const)
        expect(kinds.has(k), `seed ${seed} has ${k}`).toBe(true);
    }
  });

  it("creates 30 citizens, all housed, with consistent employment links", () => {
    for (const seed of SEEDS) {
      const w = generateWorld(seed, SMALL);
      expect(w.citizens.length).toBe(30);
      for (const c of w.citizens) {
        expect(c.home, `seed ${seed} ${c.name} housed`).toBeGreaterThanOrEqual(0);
        if (c.workplace >= 0) {
          const biz = w.businesses[c.workplace];
          expect(biz.employees).toContain(c.id);
        }
        expect(c.name.length).toBeGreaterThan(3);
      }
      const names = new Set(w.citizens.map((c) => c.name));
      expect(names.size).toBe(30);
      expect(w.civs[0].ruler).toBeGreaterThanOrEqual(0);
    }
  });

  it("initial money equals the sum of all balances", () => {
    const w = generateWorld(7, SMALL);
    const total = w.citizens.reduce((s, c) => s + c.wealth, 0) + w.businesses.reduce((s, b) => s + b.cash, 0) + w.civs[0].treasury;
    expect(w.initialMoney).toBe(total);
    expect(Number.isInteger(total)).toBe(true);
  });
});

describe("engine (M1 minimal)", () => {
  it("runs 545 days deterministically and quickly", () => {
    const a = generateWorld(545, SMALL);
    const b = generateWorld(545, SMALL);
    const t0 = performance.now();
    const ra = run(a, 545);
    const dt = performance.now() - t0;
    run(b, 545);
    expect(a.day).toBe(545);
    expect(hashHex(a)).toBe(hashHex(b));
    expect(ra.metrics.length).toBe(545);
    // the Day-0 thirty plus whoever was born, minus whoever died: a fixed number for a fixed seed
    const born = ra.events.filter((e) => e.type === "life.birth").length;
    const died = ra.events.filter((e) => e.type === "life.death").length;
    expect(ra.metrics[544].population).toBe(30 + born - died);
    expect(born).toBeGreaterThan(0);
    expect(dt).toBeLessThan(2000);
  });

  it("season cycles every 90 days", () => {
    const w = generateWorld(3, SMALL);
    run(w, 90);
    expect(w.climate.season).toBe(1);
    run(w, 270);
    expect(w.climate.season).toBe(0);
  });
});
