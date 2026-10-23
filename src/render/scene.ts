/**
 * PixiJS renderer for the living map (docs/04). Read-only consumer of WorldInfo + RenderFrame.
 * Owns: chunked terrain, animated water, overlays, building/citizen sprite pools, camera,
 * selection, day/night, and the performance-tier ladder. Owns no game logic.
 */
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { BUILDING_SIZE } from "../sim/data/buildings";
import type { BuildingKind, Occupation } from "../sim/types";
import { hash2 } from "../sim/worldgen/noise";
import { BD, BUILDING_KINDS, CZ, INFECTIONS, MS_PER_DAY, OCCUPATIONS } from "../workers/protocol";
import type { RenderFrame, Speed, WorldInfo } from "../workers/protocol";
import { CITIZEN_H, TILE, makeBuilding, makeCitizen } from "./art";
import { Terrain } from "./terrain";
import { Overlays } from "./overlays";
import type { OverlayMode } from "./overlays";
import { Caravans, pointAlong } from "./caravans";
import { PAL, TERRITORY } from "./palette";

export type Tier = "full" | "lite" | "still" | "text";
export type { OverlayMode } from "./overlays";
export type Selection = { kind: "building"; id: number } | { kind: "citizen"; id: number } | { kind: "tile"; x: number; y: number };

export interface RenderStatus {
  tier: Tier;
  reason: string;
  fps: number;
  renderer: string;
  zoom: number;
  visibleCitizens: number;
  contextLosses: number;
  /** Chunks still waiting to be baked, and how long the last full bake took (ms). */
  bakePending: number;
  bakeMs: number;
}

const ZOOMS = [1, 2, 3, 4];
const WATER_FRAME_MS = 500;
const LITE_FPS = 40;
const LITE_SECONDS = 3;

/** Day phase schedule for a 4-stop itinerary. [start, end, kind, stopIndex] — walks go from stop to stop+1. */
const SCHEDULE: [number, number, "at" | "walk", number][] = [
  [0, 0.1, "at", 0],
  [0.1, 0.22, "walk", 0],
  [0.22, 0.55, "at", 1],
  [0.55, 0.63, "walk", 1],
  [0.63, 0.76, "at", 2],
  [0.76, 0.88, "walk", 2],
  [0.88, 1.0, "at", 3],
];

function nearest(t: Texture): Texture {
  t.source.scaleMode = "nearest";
  return t;
}

function lerpColor(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Multiply tint for the time of day. Night keeps enough value that the map stays readable. */
export function dayTint(phase: number): number {
  const DAY = 0xffffff;
  const DUSK = 0xe8b887;
  const NIGHT = 0x6b74b8;
  const DAWN = 0xf2c9a0;
  if (phase < 0.08) return lerpColor(NIGHT, DAWN, phase / 0.08);
  if (phase < 0.15) return lerpColor(DAWN, DAY, (phase - 0.08) / 0.07);
  if (phase < 0.62) return DAY;
  if (phase < 0.72) return lerpColor(DAY, DUSK, (phase - 0.62) / 0.1);
  if (phase < 0.82) return lerpColor(DUSK, NIGHT, (phase - 0.72) / 0.1);
  return NIGHT;
}

export class WorldRenderer {
  readonly app: Application;
  readonly host: HTMLElement;
  readonly info: WorldInfo;
  private world = new Container();
  private terrain!: Terrain;
  private overlays!: Overlays;
  private caravans!: Caravans;
  private buildingLayer = new Container();
  private citizenLayer = new Container();
  private fxLayer = new Container();
  private labelLayer = new Container();
  private tintRect = new Graphics();
  private selectionBox = new Graphics();

  private buildingTex = new Map<string, Texture>();
  private citizenTex = new Map<string, Texture>();
  private buildingSprites = new Map<number, Sprite>();
  private citizenSprites = new Map<number, { sprite: Sprite; occ: Occupation; stops: number[]; jitter: number }>();
  private citizenPos = new Map<number, { x: number; y: number }>();
  private buildingsById = new Map<number, { kind: BuildingKind; x: number; y: number; w: number; h: number; settlement: number }>();

  private frame: RenderFrame | null = null;
  /** Settlement id → civ colour index, from the latest frame (conquest changes it). */
  private settlementCiv = new Map<number, number>();
  private settlementLabels = new Map<number, Text>();
  private flashes: { g: Graphics; born: number }[] = [];
  private dry = false;
  private speed: Speed = 0;
  private dayClock = 0; // 0..1 within the current day
  private frameAt = 0; // performance.now() when the current day's frame arrived
  private waterClock = 0;
  private waterFrame = 0;
  private reducedMotion = false;
  private zoomIndex = 1;
  private tier: Tier = "full";
  private tierReason = "default";
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 60;
  private lowFpsSeconds = 0;
  private contextLosses = 0;
  private selection: Selection | null = null;
  private destroyed = false;

  onSelect: ((sel: Selection | null) => void) | null = null;
  onTierChange: ((tier: Tier, reason: string) => void) | null = null;

  private constructor(app: Application, host: HTMLElement, info: WorldInfo) {
    this.app = app;
    this.host = host;
    this.info = info;
  }

  static async create(host: HTMLElement, info: WorldInfo, opts: { reducedMotion: boolean; forceLite?: boolean }): Promise<WorldRenderer> {
    const app = new Application();
    await app.init({
      preference: "webgl",
      resizeTo: host,
      background: PAL.abyss,
      antialias: false,
      roundPixels: true,
      resolution: Math.min(2, Math.max(1, Math.floor(window.devicePixelRatio || 1))),
      autoDensity: true,
      powerPreference: "high-performance",
    });
    host.appendChild(app.canvas);
    app.canvas.style.display = "block";
    app.canvas.style.touchAction = "none";
    app.canvas.setAttribute("aria-hidden", "true");
    const r = new WorldRenderer(app, host, info);
    r.reducedMotion = opts.reducedMotion;
    r.build();
    if (opts.forceLite || (navigator.hardwareConcurrency ?? 4) <= 2) r.setTier("lite", opts.forceLite ? "forced by setting" : "≤ 2 CPU cores");
    r.attachInput();
    app.canvas.addEventListener("webglcontextlost", () => {
      r.contextLosses++;
      if (r.contextLosses >= 2) r.setTier("still", "WebGL context lost twice");
    });
    app.ticker.add((ticker) => r.update(ticker.deltaMS));
    return r;
  }

  // ───────────────────────── build ─────────────────────────

  private build(): void {
    const { world } = this;
    this.terrain = new Terrain(this.app, this.info);
    this.overlays = new Overlays(this.info);
    this.caravans = new Caravans(this.info, this.citizenLayer);
    world.addChild(this.terrain.layer, this.overlays.layer, this.buildingLayer, this.citizenLayer, this.fxLayer, this.selectionBox, this.tintRect, this.labelLayer);
    this.app.stage.addChild(world);

    const w = this.info.width * TILE;
    const h = this.info.height * TILE;
    this.tintRect.rect(0, 0, w, h).fill(0xffffff);
    this.tintRect.blendMode = "multiply";

    for (const s of this.info.settlements) this.addLabel(s);


    // start centred on the first settlement
    const s = this.info.settlements[0];
    this.zoomIndex = 1;
    this.centerOn(s ? s.cx * TILE : w / 2, s ? s.cy * TILE : h / 2);
  }

  /** A name over a town; colonies get theirs the day they are founded. */
  private addLabel(s: WorldInfo["settlements"][number]): void {
    if (!s || this.settlementLabels.has(s.id)) return;
    const civ = this.info.civs[s.civ];
    const label = new Text({
      text: `${s.name}\n${civ?.name ?? ""}`,
      style: { fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontSize: 10, fill: TERRITORY[(civ?.color ?? 0) % TERRITORY.length], stroke: { color: PAL.abyss, width: 3 }, align: "center" },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    label.position.set(s.cx * TILE + TILE / 2, s.cy * TILE - 30);
    this.labelLayer.addChild(label);
    this.settlementLabels.set(s.id, label);
    this.settlementCiv.set(s.id, civ?.color ?? 0);
  }

  // ───────────────────────── frames ─────────────────────────

  applyFrame(f: RenderFrame): void {
    if (this.destroyed) return;
    this.frame = f;
    this.dayClock = this.speed === 0 ? 0.3 : 0; // a paused world is shown in morning light
    this.frameAt = performance.now();
    // drought: the land itself goes dry (chunks are re-baked once when it begins and once when it ends)
    const dry = f.climate.droughtDays > 0;
    if (dry !== this.dry) {
      this.dry = dry;
      this.terrain.rebuild(dry);
    }
    // towns founded since the map was drawn (the client has merged them into info by now)
    if (f.delta) {
      for (const st of f.delta.settlements) this.addLabel(st);
      if (f.delta.roads) {
        this.caravans.roadsChanged();
        this.terrain.roadsChanged();
      }
    }
    this.overlays.onFrame(f);
    this.caravans.draw(f);
    // whose town is whose (conquest moves a settlement between civs)
    for (const st of f.settlements) {
      const civ = f.civs.find((c) => c.id === st.civ);
      const color = civ?.color ?? 0;
      if (this.settlementCiv.get(st.id) !== color) {
        this.settlementCiv.set(st.id, color);
        const label = this.settlementLabels.get(st.id);
        if (label) {
          label.text = `${st.name}\n${civ?.name ?? ""}`;
          label.style.fill = TERRITORY[color % TERRITORY.length];
        }
      }
    }
    // buildings
    const seen = new Set<number>();
    for (let i = 0; i < f.buildings.length; i += BD.STRIDE) {
      const id = f.buildings[i + BD.id];
      const kind = BUILDING_KINDS[f.buildings[i + BD.kind]];
      const x = f.buildings[i + BD.x];
      const y = f.buildings[i + BD.y];
      const tier = f.buildings[i + BD.tier];
      const alive = f.buildings[i + BD.alive] === 1;
      const settlement = f.buildings[i + BD.settlement];
      if (!alive) continue;
      seen.add(id);
      let sp = this.buildingSprites.get(id);
      if (!sp) {
        sp = new Sprite();
        sp.anchor.set(0, 1); // the plot's bottom edge: taller tiers rise above their footprint
        this.buildingLayer.addChild(sp);
        this.buildingSprites.set(id, sp);
      }
      const { w, h } = BUILDING_SIZE[kind];
      sp.texture = this.buildingTexture(kind, tier, this.settlementCiv.get(settlement) ?? 0);
      sp.visible = true;
      sp.position.set(x * TILE, (y + h) * TILE);
      sp.zIndex = (y + h) * TILE;
      void w;
      this.buildingsById.set(id, { kind, x, y, ...BUILDING_SIZE[kind], settlement });
    }
    this.buildingLayer.sortableChildren = true;
    for (const [id, sp] of this.buildingSprites) if (!seen.has(id)) { sp.visible = false; }
    // citizens
    const seenC = new Set<number>();
    for (let i = 0; i < f.citizens.length; i += CZ.STRIDE) {
      const id = f.citizens[i + CZ.id];
      const stops = [f.citizens[i + CZ.it0], f.citizens[i + CZ.it1], f.citizens[i + CZ.it2], f.citizens[i + CZ.it3]];
      const occ = OCCUPATIONS[f.citizens[i + CZ.occ]];
      const alive = f.citizens[i + CZ.alive] === 1;
      const infection = INFECTIONS[f.citizens[i + CZ.infection]] ?? "none";
      if (!alive) continue;
      seenC.add(id);
      let rec = this.citizenSprites.get(id);
      if (!rec) {
        const sprite = new Sprite(this.citizenTexture(occ, id, 0));
        sprite.anchor.set(0.5, 1);
        this.citizenLayer.addChild(sprite);
        rec = { sprite, occ, stops, jitter: (hash2(id, 9, 3) % 11) - 5 };
        this.citizenSprites.set(id, rec);
      }
      rec.occ = occ;
      rec.stops = stops;
      rec.sprite.visible = true;
      rec.sprite.tint = infection === "sick" ? 0x9fd89f : infection === "incubating" ? 0xd8e8c0 : 0xffffff; // the fevered go green
    }
    for (const [id, rec] of this.citizenSprites) if (!seenC.has(id)) rec.sprite.visible = false;
    this.placeCitizens(0);
    this.drawSelection();
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
  }

  setReducedMotion(v: boolean): void {
    this.reducedMotion = v;
  }

  private buildingTexture(kind: BuildingKind, tier: number, civColor: number): Texture {
    const key = `${kind}:${tier}:${civColor}`;
    let t = this.buildingTex.get(key);
    if (!t) {
      t = nearest(Texture.from(makeBuilding(kind, tier, TERRITORY[civColor % TERRITORY.length])));
      this.buildingTex.set(key, t);
    }
    return t;
  }

  /** A short burst of colour at a tile: raids and conquests. Cheap, and skipped under reduced motion. */
  flashAt(tileX: number, tileY: number, color: number): void {
    if (this.destroyed || this.reducedMotion || this.tier === "still") return;
    const g = new Graphics();
    g.position.set(tileX * TILE + TILE / 2, tileY * TILE + TILE / 2);
    g.circle(0, 0, TILE * 2).fill({ color, alpha: 0.35 });
    g.circle(0, 0, TILE * 0.6).fill({ color, alpha: 0.9 });
    this.fxLayer.addChild(g);
    this.flashes.push({ g, born: performance.now() });
  }

  private citizenTexture(occ: Occupation, id: number, frame: 0 | 1): Texture {
    const key = `${occ}:${id % 24}:${frame}`; // 24 looks per occupation: skin × hair × cut (M8)
    let t = this.citizenTex.get(key);
    if (!t) {
      t = nearest(Texture.from(makeCitizen(occ, id % 24, frame)));
      this.citizenTex.set(key, t);
    }
    return t;
  }

  private door(buildingId: number): { x: number; y: number } | null {
    const b = this.buildingsById.get(buildingId);
    if (!b) return null;
    return { x: (b.x + b.w / 2) * TILE, y: (b.y + b.h) * TILE };
  }

  /** Positions every citizen for day-phase `p` (0..1). Walks are straight lines between doors. */
  private placeCitizens(p: number): void {
    const snap = this.reducedMotion || this.speed === 16 || this.tier !== "full";
    let visible = 0;
    for (const [id, rec] of this.citizenSprites) {
      if (!rec.sprite.visible) continue;
      const stops = rec.stops.map((s) => (s >= 0 ? s : rec.stops[0]));
      const seg = SCHEDULE.find(([a, b]) => p >= a && p < b) ?? SCHEDULE[SCHEDULE.length - 1];
      let pos: { x: number; y: number } | null;
      let walking = false;
      if (seg[2] === "at" || snap) {
        const idx = seg[2] === "at" ? seg[3] : seg[3] + 1;
        pos = this.door(stops[Math.min(idx, 3)]);
      } else {
        const a = this.door(stops[seg[3]]);
        const b = this.door(stops[seg[3] + 1]);
        if (!a || !b) pos = a ?? b;
        else {
          const t = (p - seg[0]) / (seg[1] - seg[0]);
          const sa = this.buildingsById.get(stops[seg[3]])?.settlement ?? -1;
          const sb = this.buildingsById.get(stops[seg[3] + 1])?.settlement ?? -1;
          // a march to another town follows the road: door → road → door
          const road = sa !== sb && sa >= 0 && sb >= 0 ? this.caravans.roadPath(sa, sb) : null;
          pos = road ? pointAlong([a, ...road, b], t) : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          walking = a.x !== b.x || a.y !== b.y;
        }
      }
      if (!pos) {
        rec.sprite.visible = false;
        continue;
      }
      const x = pos.x + rec.jitter;
      const y = pos.y + 2;
      rec.sprite.position.set(Math.round(x), Math.round(y));
      rec.sprite.texture = this.citizenTexture(rec.occ, id, walking && Math.floor(p * 60) % 2 === 0 ? 1 : 0);
      if (this.tier === "lite" && visible >= 60) rec.sprite.renderable = false;
      else rec.sprite.renderable = true;
      visible++;
      this.citizenPos.set(id, { x, y });
    }
    this.citizenLayer.sortableChildren = false;
  }

  // ───────────────────────── per-tick ─────────────────────────

  private update(deltaMS: number): void {
    if (this.destroyed) return;
    this.terrain.bakePending(this.tier === "full" ? 6 : 10, this.tier, this.reducedMotion);
    // fps ladder
    this.fpsAcc += deltaMS;
    this.fpsFrames++;
    if (this.fpsAcc >= 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsAcc);
      this.fpsAcc = 0;
      this.fpsFrames = 0;
      if (this.tier === "full" && this.fps < LITE_FPS && document.visibilityState === "visible") {
        this.lowFpsSeconds++;
        if (this.lowFpsSeconds >= LITE_SECONDS) this.setTier("lite", `fps ${this.fps} < ${LITE_FPS} for ${LITE_SECONDS}s`);
      } else this.lowFpsSeconds = 0;
    }
    // day clock
    // wall-clock based so a slow ticker (deltaMS is clamped at 100 ms) cannot drift from the worker's day
    if (this.speed !== 0) {
      this.dayClock = Math.min(0.999, (performance.now() - this.frameAt) / MS_PER_DAY[this.speed]);
    }
    this.placeCitizens(this.dayClock);
    // raid flashes: expand and fade over 1.2 s
    if (this.flashes.length) {
      const now = performance.now();
      this.flashes = this.flashes.filter((f) => {
        const t = (now - f.born) / 1200;
        if (t >= 1) { f.g.destroy(); return false; }
        f.g.scale.set(1 + t * 2);
        f.g.alpha = 1 - t;
        return true;
      });
    }
    // day/night
    const phase = this.speed === 0 && !this.frame ? 0.3 : this.dayClock;
    this.tintRect.tint = this.tier === "still" ? 0xffffff : dayTint(phase); // one quad; cheap enough for lite
    // water
    if (this.tier === "full" && !this.reducedMotion) {
      this.waterClock += deltaMS;
      if (this.waterClock >= WATER_FRAME_MS) {
        this.waterClock = 0;
        this.waterFrame = (this.waterFrame + 1) % 4;
        this.terrain.setWaterFrame(this.waterFrame);
      }
    }
  }

  // ───────────────────────── tiers ─────────────────────────

  getStatus(): RenderStatus {
    return {
      tier: this.tier,
      reason: this.tierReason,
      fps: this.fps,
      renderer: this.app.renderer.name,
      zoom: ZOOMS[this.zoomIndex],
      visibleCitizens: [...this.citizenSprites.values()].filter((r) => r.sprite.visible && r.sprite.renderable).length,
      contextLosses: this.contextLosses,
      bakePending: this.terrain.pending,
      bakeMs: Math.round(this.terrain.bakeDoneMs),
    };
  }

  setTier(tier: Tier, reason: string): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.tierReason = reason;
    if (tier !== "full") this.terrain.stillWater();
    this.onTierChange?.(tier, reason);
  }

  // ───────────────────────── overlays ─────────────────────────

  setOverlay(mode: OverlayMode): void {
    this.overlays.set(mode, this.frame);
  }

  getOverlay(): OverlayMode {
    return this.overlays.mode;
  }

  // ───────────────────────── camera & input ─────────────────────────

  private centerOn(wx: number, wy: number): void {
    const z = ZOOMS[this.zoomIndex];
    this.world.scale.set(z);
    this.world.position.set(Math.round(this.app.screen.width / 2 - wx * z), Math.round(this.app.screen.height / 2 - wy * z));
    this.clampCamera();
  }

  private clampCamera(): void {
    const z = ZOOMS[this.zoomIndex];
    const w = this.info.width * TILE * z;
    const h = this.info.height * TILE * z;
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    const margin = 0.5; // keep at least half the screen covered
    this.world.x = Math.round(Math.min(sw * margin, Math.max(sw * (1 - margin) - w, this.world.x)));
    this.world.y = Math.round(Math.min(sh * margin, Math.max(sh * (1 - margin) - h, this.world.y)));
  }

  pan(dx: number, dy: number): void {
    this.world.x += dx;
    this.world.y += dy;
    this.clampCamera();
  }

  zoomBy(delta: number, aroundX?: number, aroundY?: number): void {
    const next = Math.max(0, Math.min(ZOOMS.length - 1, this.zoomIndex + delta));
    if (next === this.zoomIndex) return;
    const ax = aroundX ?? this.app.screen.width / 2;
    const ay = aroundY ?? this.app.screen.height / 2;
    const z0 = ZOOMS[this.zoomIndex];
    const z1 = ZOOMS[next];
    const wx = (ax - this.world.x) / z0;
    const wy = (ay - this.world.y) / z0;
    this.zoomIndex = next;
    this.world.scale.set(z1);
    this.world.position.set(Math.round(ax - wx * z1), Math.round(ay - wy * z1));
    this.clampCamera();
    for (const l of this.labelLayer.children) l.visible = z1 >= 2;
  }

  focusOn(tileX: number, tileY: number, zoom?: number): void {
    if (zoom !== undefined) this.zoomIndex = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) >= 0 ? ZOOMS.indexOf(zoom) : this.zoomIndex));
    this.centerOn(tileX * TILE + TILE / 2, tileY * TILE + TILE / 2);
  }

  hitTest(clientX: number, clientY: number): Selection | null {
    const rect = this.app.canvas.getBoundingClientRect();
    const z = ZOOMS[this.zoomIndex];
    const wx = (clientX - rect.left - this.world.x) / z;
    const wy = (clientY - rect.top - this.world.y) / z;
    // citizens first (they stand in front of doors)
    let best: { id: number; d: number } | null = null;
    for (const [id, p] of this.citizenPos) {
      const rec = this.citizenSprites.get(id);
      if (!rec || !rec.sprite.visible || !rec.sprite.renderable) continue;
      if (Math.abs(p.x - wx) <= 8 && wy <= p.y + 2 && wy >= p.y - CITIZEN_H) {
        const d = Math.abs(p.x - wx) + Math.abs(p.y - wy);
        if (!best || d < best.d) best = { id, d };
      }
    }
    if (best) return { kind: "citizen", id: best.id };
    const tx = Math.floor(wx / TILE);
    const ty = Math.floor(wy / TILE);
    for (const [id, b] of this.buildingsById) {
      const sp = this.buildingSprites.get(id);
      if (sp && !sp.visible) continue;
      if (tx >= b.x && tx < b.x + b.w && ty >= b.y && ty < b.y + b.h) return { kind: "building", id };
    }
    if (tx >= 0 && ty >= 0 && tx < this.info.width && ty < this.info.height) return { kind: "tile", x: tx, y: ty };
    return null;
  }

  select(sel: Selection | null): void {
    this.selection = sel;
    this.drawSelection();
  }

  private drawSelection(): void {
    const g = this.selectionBox;
    g.clear();
    const sel = this.selection;
    if (!sel) return;
    let x = 0, y = 0, w = TILE, h = TILE;
    if (sel.kind === "building") {
      const b = this.buildingsById.get(sel.id);
      if (!b) return;
      x = b.x * TILE; y = b.y * TILE; w = b.w * TILE; h = b.h * TILE;
    } else if (sel.kind === "citizen") {
      const p = this.citizenPos.get(sel.id);
      if (!p) return;
      x = Math.round(p.x) - 8; y = Math.round(p.y) - CITIZEN_H; w = 16; h = CITIZEN_H + 2;
    } else {
      x = sel.x * TILE; y = sel.y * TILE;
    }
    g.rect(x - 1, y - 1, w + 2, h + 2).stroke({ color: PAL.ember, width: 1, alignment: 0 });
  }

  private attachInput(): void {
    const el = this.app.canvas;
    let dragging = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;
    let pinchDist = 0;
    const pointers = new Map<number, { x: number; y: number }>();

    el.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        dragging = true;
        moved = 0;
        lastX = e.clientX;
        lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist && Math.abs(d - pinchDist) > 40) {
          this.zoomBy(d > pinchDist ? 1 : -1, (a.x + b.x) / 2 - el.getBoundingClientRect().left, (a.y + b.y) / 2 - el.getBoundingClientRect().top);
          pinchDist = d;
        } else if (!pinchDist) pinchDist = d;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      moved += Math.abs(dx) + Math.abs(dy);
      lastX = e.clientX;
      lastY = e.clientY;
      this.pan(dx, dy);
    });
    const end = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (!dragging) return;
      dragging = false;
      if (moved < 6) this.onSelect?.(this.hitTest(e.clientX, e.clientY));
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        this.zoomBy(e.deltaY < 0 ? 1 : -1, e.clientX - rect.left, e.clientY - rect.top);
      },
      { passive: false },
    );
    this.app.renderer.on("resize", () => this.clampCamera());
  }

  // ───────────────────────── teardown ─────────────────────────

  destroy(): void {
    this.destroyed = true;
    this.app.destroy(true, { children: true, texture: true, textureSource: true });
  }
}
