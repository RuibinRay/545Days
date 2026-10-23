/**
 * "still" tier: no WebGL. Draws the terrain and buildings once per day to a 2D canvas,
 * pans/zooms with CSS transforms. No citizens, no water animation (docs/04 tiers).
 */
import { BIOME_INDEX } from "../sim/types";
import type { BuildingKind } from "../sim/types";
import { BD, BUILDING_KINDS } from "../workers/protocol";
import type { RenderFrame, WorldInfo } from "../workers/protocol";
import { TILE, makeBridge, makeBuilding, makeRiver, makeRoad, makeTile } from "./art";
import { roadMask } from "../sim/worldgen/roads";
import type { TileName } from "./art";

export class StillRenderer {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private tiles = new Map<string, HTMLCanvasElement>();
  private buildings = new Map<string, HTMLCanvasElement>();
  private zoom = 2;
  private ox = 0;
  private oy = 0;

  constructor(private host: HTMLElement, private info: WorldInfo) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = info.width * TILE;
    this.canvas.height = info.height * TILE;
    this.canvas.style.imageRendering = "pixelated";
    this.canvas.style.transformOrigin = "0 0";
    this.canvas.setAttribute("aria-hidden", "true");
    const g = this.canvas.getContext("2d");
    if (!g) throw new Error("2D canvas unavailable");
    this.g = g;
    g.imageSmoothingEnabled = false;
    host.appendChild(this.canvas);
    this.drawTerrain();
    const s = info.settlements[0];
    if (s) this.center(s.cx * TILE, s.cy * TILE);
  }

  private tile(name: TileName): HTMLCanvasElement {
    let c = this.tiles.get(name);
    if (!c) {
      c = makeTile(name);
      this.tiles.set(name, c);
    }
    return c;
  }

  private drawTerrain(): void {
    const { info, g } = this;
    const roads = roadMask(info, info.roads);
    const roadTiles = new Map<number, HTMLCanvasElement>();
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = y * info.width + x;
        const biome = BIOME_INDEX[info.biome[i]];
        g.drawImage(this.tile(biome === "ocean" ? "ocean0" : (biome as TileName)), x * TILE, y * TILE);
        if (info.river[i]) g.drawImage(makeRiver(0), x * TILE, y * TILE);
        if (roads[i] && biome !== "ocean") {
          const key = info.river[i] ? 1000 + roads[i] : roads[i];
          let rt = roadTiles.get(key);
          if (!rt) { rt = info.river[i] ? makeBridge(roads[i]) : makeRoad(roads[i]); roadTiles.set(key, rt); }
          g.drawImage(rt, x * TILE, y * TILE);
        }
      }
  }

  applyFrame(f: RenderFrame): void {
    const { g } = this;
    for (let i = 0; i < f.buildings.length; i += BD.STRIDE) {
      if (f.buildings[i + BD.alive] !== 1) continue;
      const kind: BuildingKind = BUILDING_KINDS[f.buildings[i + BD.kind]];
      const key = `${kind}:${f.buildings[i + BD.tier]}`;
      let c = this.buildings.get(key);
      if (!c) {
        c = makeBuilding(kind, f.buildings[i + BD.tier]);
        this.buildings.set(key, c);
      }
      g.drawImage(c, f.buildings[i + BD.x] * TILE, f.buildings[i + BD.y] * TILE);
    }
  }

  center(wx: number, wy: number): void {
    this.ox = this.host.clientWidth / 2 - wx * this.zoom;
    this.oy = this.host.clientHeight / 2 - wy * this.zoom;
    this.apply();
  }

  pan(dx: number, dy: number): void {
    this.ox += dx;
    this.oy += dy;
    this.apply();
  }

  zoomBy(d: number): void {
    this.zoom = Math.max(1, Math.min(4, this.zoom + d));
    this.apply();
  }

  private apply(): void {
    this.canvas.style.transform = `translate(${Math.round(this.ox)}px, ${Math.round(this.oy)}px) scale(${this.zoom})`;
  }

  destroy(): void {
    this.canvas.remove();
  }
}
