/**
 * Roads (M8). A road is the cheapest 4-connected land path between two towns: Dijkstra over the
 * terrain with a cost per tile — open ground 1, forest 2, hills 3, mountain 9 (a pass, when there is
 * no way round), a river ford 4. The sea is impassable; towns on different islands get no road and
 * their caravans sail the straight line (trade.ts handles the missing road by distance).
 *
 * Roads are state, not rendering: carts and marching soldiers follow them in the scene, caravan
 * travel time is the road's length, and the terrain bakes them as dirt paths. They are computed
 * once per pair of towns — at worldgen for the Day-0 towns, and when a colony is founded for its
 * link to the parent and to the nearest other town. Pure and deterministic: no RNG.
 */
import type { Road, SettlementId, TerrainLayer } from "../types";
import { BIOME } from "./terrain";

const STEP_COST = [Infinity, 1, 1, 2, 3, 9, 1]; // by BIOME_INDEX order: ocean, coast, grassland, forest, hills, mountain, desert
const FORD_COST = 4;

function tileCost(t: TerrainLayer, i: number): number {
  const c = STEP_COST[t.biome[i]] ?? Infinity;
  if (c === Infinity) return c;
  return t.river[i] ? c + FORD_COST : c;
}

/** A small binary heap of (cost, tile) pairs. */
class Heap {
  private cost: number[] = [];
  private tile: number[] = [];
  get size(): number { return this.cost.length; }
  push(c: number, i: number): void {
    this.cost.push(c);
    this.tile.push(i);
    let k = this.cost.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (this.cost[p] <= this.cost[k]) break;
      this.swap(p, k);
      k = p;
    }
  }
  pop(): [number, number] {
    const out: [number, number] = [this.cost[0], this.tile[0]];
    const lc = this.cost.pop()!;
    const lt = this.tile.pop()!;
    if (this.cost.length > 0) {
      this.cost[0] = lc;
      this.tile[0] = lt;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < this.cost.length && this.cost[l] < this.cost[m]) m = l;
        if (r < this.cost.length && this.cost[r] < this.cost[m]) m = r;
        if (m === k) break;
        this.swap(m, k);
        k = m;
      }
    }
    return out;
  }
  private swap(a: number, b: number): void {
    [this.cost[a], this.cost[b]] = [this.cost[b], this.cost[a]];
    [this.tile[a], this.tile[b]] = [this.tile[b], this.tile[a]];
  }
}

/** The cheapest land path from (ax,ay) to (bx,by) as tile indices, both ends included; null when the sea is in the way. */
export function findPath(t: TerrainLayer, ax: number, ay: number, bx: number, by: number): number[] | null {
  const w = t.width;
  const n = w * t.height;
  const start = ay * w + ax;
  const goal = by * w + bx;
  if (start === goal) return [start];
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);
  while (heap.size > 0) {
    const [d, i] = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const x = i % w;
    const y = (i - x) / w;
    // N, E, S, W in a fixed order so ties resolve the same way on every machine
    const nb = [y > 0 ? i - w : -1, x < w - 1 ? i + 1 : -1, y < t.height - 1 ? i + w : -1, x > 0 ? i - 1 : -1];
    for (const j of nb) {
      if (j < 0 || done[j]) continue;
      const c = tileCost(t, j);
      if (c === Infinity) continue;
      const nd = d + c;
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        heap.push(nd, j);
      }
    }
  }
  if (!done[goal]) return null;
  const path: number[] = [];
  for (let i = goal; i >= 0; i = prev[i]) path.push(i);
  path.reverse();
  return path;
}

/** Builds the road between two towns, or null when none can be laid. */
export function layRoad(t: TerrainLayer, a: { id: SettlementId; cx: number; cy: number }, b: { id: SettlementId; cx: number; cy: number }): Road | null {
  const tiles = findPath(t, a.cx, a.cy, b.cx, b.cy);
  if (!tiles) return null;
  return { a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), tiles: a.id <= b.id ? tiles : tiles.slice().reverse() };
}

/** The road joining two towns, if one exists. */
export function roadBetween(roads: Road[], a: SettlementId, b: SettlementId): Road | null {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  for (const r of roads) if (r.a === lo && r.b === hi) return r;
  return null;
}

/** Per-tile 4-bit connectivity mask (N=1 E=2 S=4 W=8) of every road tile, for the autotile. */
export function roadMask(t: { width: number; height: number }, roads: Road[]): Uint8Array {
  const w = t.width;
  const on = new Uint8Array(w * t.height);
  for (const r of roads) for (const i of r.tiles) on[i] = 1;
  const mask = new Uint8Array(w * t.height);
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    let m = 16; // bit 4 marks "a road tile" even when isolated
    if (y > 0 && on[i - w]) m |= 1;
    if (x < w - 1 && on[i + 1]) m |= 2;
    if (y < t.height - 1 && on[i + w]) m |= 4;
    if (x > 0 && on[i - 1]) m |= 8;
    mask[i] = m;
  }
  return mask;
}
