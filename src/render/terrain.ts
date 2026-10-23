/**
 * Terrain (split out of scene.ts in M9): tile, river, road, bridge and foam textures, the chunked
 * RenderTextures they bake into, the progressive bake queue, and the water animation frames.
 * Owns the `layer` the renderer places under everything else.
 */
import { Container, RenderTexture, Sprite, Texture } from "pixi.js";
import type { Application } from "pixi.js";
import { BIOME_INDEX } from "../sim/types";
import { hash2 } from "../sim/worldgen/noise";
import { roadMask } from "../sim/worldgen/roads";
import type { WorldInfo } from "../workers/protocol";
import { TILE, TILE_VARIANTS, makeBridge, makeFoam, makeRiver, makeRoad, makeTile } from "./art";
import type { TileName } from "./art";
import type { Tier } from "./scene";

export const CHUNK = 16;

function nearest(t: Texture): Texture {
  t.source.scaleMode = "nearest";
  return t;
}

export class Terrain {
  readonly layer = new Container();
  private tiles = new Map<string, Texture>();
  private foamTex = new Map<number, Texture>();
  private riverTex = new Map<number, Texture>();
  private roadTex = new Map<number, Texture>();
  private bridgeTex = new Map<number, Texture>();
  private roadMaskLayer: Uint8Array = new Uint8Array(0);
  private chunkSprites: { sprite: Sprite; frames: Texture[] }[] = [];
  private chunkByKey = new Map<number, { sprite: Sprite; frames: Texture[] }>();
  private bakeQueue: { cx: number; cy: number; frame: number }[] = [];
  private bakeStarted = 0;
  /** Wall-clock time the last full bake took, ms (for ?why). */
  bakeDoneMs = -1;
  private dry = false;
  private tier: Tier = "full";
  private reducedMotion = false;

  constructor(private readonly app: Application, private readonly info: WorldInfo) {
    for (const name of ["ocean0", "ocean1", "ocean2", "ocean3", "coast", "grassland", "forest", "hills", "mountain", "desert", "grassland_dry", "forest_dry", "hills_dry"] as TileName[])
      for (let v = 0; v < (name.startsWith("ocean") ? 1 : TILE_VARIANTS); v++) this.tiles.set(`${name}#${v}`, nearest(Texture.from(makeTile(name, v))));
    for (let f = 0; f < 4; f++) for (let m = 1; m < 16; m++) this.foamTex.set(f * 16 + m, nearest(Texture.from(makeFoam(m, f))));
    for (let m = 0; m < 16; m++) this.riverTex.set(m, nearest(Texture.from(makeRiver(m))));
    for (let m = 16; m < 32; m++) this.roadTex.set(m, nearest(Texture.from(makeRoad(m))));
    this.roadMaskLayer = roadMask(info, info.roads);
    this.buildChunks();
  }

  get pending(): number { return this.bakeQueue.length; }

  /** Roads were laid (a colony): recompute the mask and bake again. */
  roadsChanged(): void {
    this.roadMaskLayer = roadMask(this.info, this.info.roads);
    this.rebuild(this.dry);
  }

  /** Shows water frame `f` on every chunk that has all four. */
  setWaterFrame(f: number): void {
    for (const c of this.chunkSprites) if (c.frames.length === 4) c.sprite.texture = c.frames[f];
  }

  /** Back to the first frame everywhere (lite and still tiers do not animate water). */
  stillWater(): void {
    for (const c of this.chunkSprites) c.sprite.texture = c.frames[0];
  }

  destroy(): void {
    for (const c of this.chunkSprites) { c.sprite.destroy(); for (const t of c.frames) t.destroy(true); }
    this.chunkSprites = [];
    this.layer.destroy({ children: true });
  }

  rebuild(dry: boolean): void {
    this.dry = dry;
    for (const c of this.chunkSprites) { c.sprite.destroy(); for (const t of c.frames) t.destroy(true); }
    this.chunkSprites = [];
    this.chunkByKey.clear();
    this.bakeQueue = [];
    this.layer.removeChildren();
    this.buildChunks();
  }

  /**
   * Terrain chunks are baked progressively (M8): the chunks nearest the camera are baked at once so
   * the first paint shows a map, the rest within a few milliseconds per tick, and the three extra
   * water frames last of all. Keeps the main thread free for the HUD and the first frame; a chunk
   * not yet baked is simply absent for a few ticks.
   */
  private buildChunks(): void {
    const { info } = this;
    const cw = Math.ceil(info.width / CHUNK);
    const ch = Math.ceil(info.height / CHUNK);
    const first = info.settlements[0];
    const fx = first ? first.cx / CHUNK : cw / 2;
    const fy = first ? first.cy / CHUNK : ch / 2;
    const order: { cx: number; cy: number; d: number }[] = [];
    for (let cy = 0; cy < ch; cy++) for (let cx = 0; cx < cw; cx++) order.push({ cx, cy, d: (cx + 0.5 - fx) ** 2 + (cy + 0.5 - fy) ** 2 });
    order.sort((p, q) => p.d - q.d);
    this.bakeQueue = order.map(({ cx, cy }) => ({ cx, cy, frame: 0 }));
    this.bakeStarted = performance.now();
    // the nearest chunks now; the viewport at the default zoom is about six of them
    for (let n = 0; n < 9 && this.bakeQueue.length; n++) this.bakeOne(this.bakeQueue.shift()!);
  }

  /** Bakes queued chunks until the time budget for this tick is spent. */
  bakePending(budgetMs: number, tier: Tier, reducedMotion: boolean): void {
    this.tier = tier;
    this.reducedMotion = reducedMotion;
    if (this.bakeQueue.length === 0) {
      if (this.bakeStarted > 0) { this.bakeDoneMs = performance.now() - this.bakeStarted; this.bakeStarted = 0; }
      return;
    }
    const t0 = performance.now();
    while (this.bakeQueue.length && performance.now() - t0 < budgetMs) this.bakeOne(this.bakeQueue.shift()!);
  }

  private bakeOne(job: { cx: number; cy: number; frame: number }): void {
    const { info } = this;
    const { cx, cy, frame: f } = job;
    const land = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < info.width && yy < info.height && info.biome[yy * info.width + xx] !== 0;
    const foamMask = (x: number, y: number): number => (land(x, y - 1) ? 1 : 0) | (land(x + 1, y) ? 2 : 0) | (land(x, y + 1) ? 4 : 0) | (land(x - 1, y) ? 8 : 0);
    const riverMask = (x: number, y: number): number => {
      const at = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < info.width && yy < info.height && (info.river[yy * info.width + xx] === 1 || info.biome[yy * info.width + xx] === 0);
      return (at(x, y - 1) ? 1 : 0) | (at(x + 1, y) ? 2 : 0) | (at(x, y + 1) ? 4 : 0) | (at(x - 1, y) ? 8 : 0);
    };
    let hasWater = false;
    const container = new Container();
    for (let ty = 0; ty < CHUNK; ty++) {
      for (let tx = 0; tx < CHUNK; tx++) {
        const x = cx * CHUNK + tx;
        const y = cy * CHUNK + ty;
        if (x >= info.width || y >= info.height) continue;
        const i = y * info.width + x;
        const biome = BIOME_INDEX[info.biome[i]];
        const name: TileName = biome === "ocean" ? (`ocean${f}` as TileName) : this.dry && (biome === "grassland" || biome === "forest" || biome === "hills") ? (`${biome}_dry` as TileName) : (biome as TileName);
        if (biome === "ocean") hasWater = true;
        const variant = biome === "ocean" ? 0 : hash2(x, y, 5) % TILE_VARIANTS;
        const sp = new Sprite(this.tiles.get(`${name}#${variant}`));
        sp.position.set(tx * TILE, ty * TILE);
        container.addChild(sp);
        if (biome === "ocean") {
          const fm = foamMask(x, y);
          if (fm) {
            const fs = new Sprite(this.foamTex.get(f * 16 + fm));
            fs.position.set(tx * TILE, ty * TILE);
            container.addChild(fs);
          }
        }
        if (info.river[i]) {
          const rv = new Sprite(this.riverTex.get(riverMask(x, y)));
          rv.position.set(tx * TILE, ty * TILE);
          container.addChild(rv);
        }
        if (this.roadMaskLayer[i] && biome !== "ocean") {
          // a road over a river is a bridge
          const rd = new Sprite(info.river[i] ? this.bridgeTexture(this.roadMaskLayer[i]) : this.roadTex.get(this.roadMaskLayer[i]));
          rd.position.set(tx * TILE, ty * TILE);
          container.addChild(rd);
        }
      }
    }
    const rt = RenderTexture.create({ width: CHUNK * TILE, height: CHUNK * TILE, scaleMode: "nearest" });
    this.app.renderer.render({ container, target: rt });
    container.destroy({ children: true });
    const key = cy * 1000 + cx;
    let rec = this.chunkByKey.get(key);
    if (!rec) {
      const sprite = new Sprite(rt);
      sprite.position.set(cx * CHUNK * TILE, cy * CHUNK * TILE);
      this.layer.addChild(sprite);
      rec = { sprite, frames: [rt] };
      this.chunkByKey.set(key, rec);
      this.chunkSprites.push(rec);
      // the other three water frames come after every chunk has its first — only where water animates
      if (hasWater && this.tier === "full" && !this.reducedMotion) for (let g = 1; g < 4; g++) this.bakeQueue.push({ cx, cy, frame: g });
    } else {
      rec.frames[f] = rt;
    }
  }

  private bridgeTexture(mask: number): Texture {
    let t = this.bridgeTex.get(mask);
    if (!t) {
      t = nearest(Texture.from(makeBridge(mask)));
      this.bridgeTex.set(mask, t);
    }
    return t;
  }
}
