/** M8 — roads: land paths between towns, laid at worldgen and when colonies are founded, used by caravans. */
import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { run, step } from "../src/sim/engine";
import { findPath, layRoad, roadBetween, roadMask } from "../src/sim/worldgen/roads";
import { BIOME } from "../src/sim/worldgen/terrain";
import { SOCIETY } from "../src/sim/data/economy";
import { tripLength } from "../src/sim/systems/trade";

describe("M8 — roads", () => {
  it("lays a road between every pair of Day-0 towns on a continent, over land only, 4-connected, deterministically", () => {
    const w = generateWorld(7919, { civs: 3, population: 100 });
    expect(w.roads.length).toBe(3);
    const t = w.terrain;
    for (const r of w.roads) {
      expect(r.a).toBeLessThan(r.b);
      const a = w.settlements[r.a];
      const b = w.settlements[r.b];
      expect(r.tiles[0]).toBe(a.cy * t.width + a.cx);
      expect(r.tiles[r.tiles.length - 1]).toBe(b.cy * t.width + b.cx);
      for (let i = 0; i < r.tiles.length; i++) {
        expect(t.biome[r.tiles[i]]).not.toBe(BIOME.ocean);
        if (i > 0) {
          const d = Math.abs(r.tiles[i] - r.tiles[i - 1]);
          expect(d === 1 || d === t.width).toBe(true);
        }
      }
    }
    const w2 = generateWorld(7919, { civs: 3, population: 100 });
    expect(JSON.stringify(w2.roads)).toBe(JSON.stringify(w.roads));
  });

  it("prefers open ground: a path around a forest is taken over one through it when it is not much longer", () => {
    const w = generateWorld(7919, { civs: 1, population: 30 });
    const t = w.terrain;
    // a straight corridor of forest with grass around it
    const y0 = 40;
    for (let x = 20; x < 60; x++) for (let y = y0 - 2; y <= y0 + 2; y++) { t.biome[y * t.width + x] = BIOME.grassland; t.river[y * t.width + x] = 0; }
    for (let x = 30; x < 50; x++) t.biome[y0 * t.width + x] = BIOME.forest;
    const p = findPath(t, 20, y0, 59, y0)!;
    expect(p).toBeTruthy();
    const forestTiles = p.filter((i) => t.biome[i] === BIOME.forest).length;
    expect(forestTiles).toBe(0);
    expect(p.length).toBeLessThanOrEqual(44); // 40 across plus a step aside and back
  });

  it("returns null across the sea and a mask with a bit per connected side", () => {
    const w = generateWorld(1, { civs: 1, population: 30 });
    const t = w.terrain;
    // an island of one land tile in a sea
    for (let i = 0; i < t.biome.length; i++) t.biome[i] = BIOME.ocean;
    t.biome[10 * t.width + 10] = BIOME.grassland;
    t.biome[50 * t.width + 50] = BIOME.grassland;
    expect(findPath(t, 10, 10, 50, 50)).toBeNull();
    const mask = roadMask({ width: 4, height: 4 }, [{ a: 0, b: 1, tiles: [0, 1, 2, 6] }]);
    expect(mask[0]).toBe(16 | 2);        // only an east neighbour
    expect(mask[1]).toBe(16 | 2 | 8);    // east and west
    expect(mask[2]).toBe(16 | 8 | 4);    // west and south
    expect(mask[6]).toBe(16 | 1);        // north
    expect(mask[3]).toBe(0);
  });

  it("a colony gets a road to its parent, and caravans take the road's length as their journey", () => {
    const w = generateWorld(1234, { civs: 3, population: 100 });
    run(w, 60);
    const civ = w.civs.find((c) => c.alive && c.settlements.length < SOCIETY.maxSettlements)!;
    civ.treasury += SOCIETY.colonyCost * 2;
    w.moneyMinted += SOCIETY.colonyCost * 2;
    w.story.influence = 30;
    const before = w.roads.length;
    step(w, [{ day: w.day + 1, type: "found_colony", civ: civ.id, from: civ.settlements[0] }]);
    const col = w.settlements[w.settlements.length - 1];
    expect(col.parent).toBe(civ.settlements[0]);
    expect(w.roads.length).toBeGreaterThan(before);
    const road = roadBetween(w.roads, col.id, col.parent);
    expect(road).toBeTruthy();
    expect(tripLength(w, w.settlements[col.parent], col)).toBe(road!.tiles.length - 1);
    const straight = Math.hypot(col.cx - w.settlements[col.parent].cx, col.cy - w.settlements[col.parent].cy);
    expect(tripLength(w, w.settlements[col.parent], col)).toBeGreaterThanOrEqual(Math.floor(straight));
    // laying the same road twice gives the same tiles
    expect(JSON.stringify(layRoad(w.terrain, w.settlements[col.parent], col))).toBe(JSON.stringify(road));
  });
});
