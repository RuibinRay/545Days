/**
 * Caravans and roads on screen (split out of scene.ts in M9): cart sprites placed along the road
 * between two towns by how far the trip has come, and the cached pixel paths that marching soldiers
 * share. Carts live in the citizen layer so they sort with the people.
 */
import { Sprite, Texture } from "pixi.js";
import type { Container } from "pixi.js";
import { roadBetween } from "../sim/worldgen/roads";
import type { RenderFrame, WorldInfo } from "../workers/protocol";
import { TILE, makeCaravan } from "./art";

function nearest(t: Texture): Texture {
  t.source.scaleMode = "nearest";
  return t;
}

/** The point a fraction `t` along a polyline, by arc length. */
export function pointAlong(pts: { x: number; y: number }[], t: number): { x: number; y: number } {
  if (pts.length === 1) return pts[0];
  let total = 0;
  const seg: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  let want = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < seg.length; i++) {
    if (want <= seg[i] || i === seg.length - 1) {
      const u = seg[i] > 0 ? Math.min(1, want / seg[i]) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u };
    }
    want -= seg[i];
  }
  return pts[pts.length - 1];
}

export class Caravans {
  private caravanSprites = new Map<number, Sprite>();
  private caravanTextures = new Map<string, Texture>();
  /** Pixel paths between towns along the roads, cached per pair (key "a-b"). */
  private roadPaths = new Map<string, { x: number; y: number }[]>();

  constructor(private readonly info: WorldInfo, private readonly layer: Container) {}

  /** Roads were laid: forget the cached paths. */
  roadsChanged(): void { this.roadPaths.clear(); }

  destroy(): void {
    for (const sp of this.caravanSprites.values()) sp.destroy();
    this.caravanSprites.clear();
  }

  draw(f: RenderFrame): void {
    const seen = new Set<number>();
    for (const cv of f.caravans) {
      const a = this.info.settlements[cv.from];
      const b = this.info.settlements[cv.to];
      if (!a || !b) continue;
      seen.add(cv.id);
      let sp = this.caravanSprites.get(cv.id);
      if (!sp) {
        sp = new Sprite(this.caravanTexture(cv.good));
        sp.anchor.set(0.5, 1);
        this.layer.addChild(sp);
        this.caravanSprites.set(cv.id, sp);
      }
      const span = Math.max(1, cv.arriveDay - cv.departDay);
      const t = Math.max(0, Math.min(1, (f.day - cv.departDay) / span));
      const pos = this.alongRoad(cv.from, cv.to, t) ?? { x: (a.cx + (b.cx - a.cx) * t) * TILE + TILE / 2, y: (a.cy + (b.cy - a.cy) * t) * TILE + TILE / 2 };
      sp.position.set(Math.round(pos.x), Math.round(pos.y + TILE / 2));
      sp.zIndex = sp.position.y;
    }
    for (const [id, sp] of this.caravanSprites) if (!seen.has(id)) { sp.destroy(); this.caravanSprites.delete(id); }
  }

  /** The road's tile centres from town `from` to town `to`, in pixels, or null without a road. */
  roadPath(from: number, to: number): { x: number; y: number }[] | null {
    const key = `${from}-${to}`;
    const hit = this.roadPaths.get(key);
    if (hit) return hit;
    const r = roadBetween(this.info.roads, from, to);
    if (!r) return null;
    const w = this.info.width;
    let pts = r.tiles.map((i) => ({ x: (i % w) * TILE + TILE / 2, y: Math.floor(i / w) * TILE + TILE / 2 }));
    if (r.a !== from) pts = pts.slice().reverse();
    this.roadPaths.set(key, pts);
    return pts;
  }

  /** A point `t` (0..1) of the way along the road between two towns, by tile count. */
  alongRoad(from: number, to: number, t: number): { x: number; y: number } | null {
    const pts = this.roadPath(from, to);
    if (!pts || pts.length < 2) return null;
    return pointAlong(pts, t);
  }

  private caravanTexture(good: string): Texture {
    let t = this.caravanTextures.get(good);
    if (!t) {
      t = nearest(Texture.from(makeCaravan(good)));
      this.caravanTextures.set(good, t);
    }
    return t;
  }
}
