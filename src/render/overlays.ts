/**
 * Map overlays (split out of scene.ts in M9): the static ones from the world's own layers
 * (territory, moisture, elevation, resources) and the live ones from the day's frame (food, wealth,
 * sickness, trade roads and gates). One sprite at a time in `layer`, uploaded as a byte buffer.
 */
import { BufferImageSource, Container, Sprite, Texture } from "pixi.js";
import type { RenderFrame, WorldInfo } from "../workers/protocol";
import { CZ } from "../workers/protocol";
import { TILE } from "./art";
import { TERRITORY } from "./palette";

export type OverlayMode = "none" | "political" | "moisture" | "elevation" | "resources" | "food" | "wealth" | "sickness" | "trade";
/** Overlays computed from the day's frame rather than the static map; redrawn as the world changes. */
export const LIVE_OVERLAYS: ReadonlySet<OverlayMode> = new Set<OverlayMode>(["food", "wealth", "sickness", "trade"]);

/**
 * A texture from raw RGBA bytes. Overlays use this rather than a canvas source: in headless Chromium
 * (SwiftShader) a 128×128 canvas-backed texture uploaded only a strip of itself, while a byte buffer
 * uploads whole everywhere.
 */
function textureFromPixels(data: Uint8Array, width: number, height: number): Texture {
  const source = new BufferImageSource({ resource: data, width, height, alphaMode: "premultiply-alpha-on-upload", scaleMode: "nearest" });
  return new Texture({ source });
}

export class Overlays {
  readonly layer = new Container();
  mode: OverlayMode = "none";
  private overlaySprite: Sprite | null = null;
  private frame: RenderFrame | null = null;
  /** Day the live overlay was last drawn, -1 when it needs drawing. */
  private overlayDay = -1;

  constructor(private readonly info: WorldInfo) {}

  /** Called with every frame: live overlays redraw every five days or at once after a mode change. */
  onFrame(f: RenderFrame): void {
    this.frame = f;
    if (f.delta?.owner && this.mode === "political") this.set("political", f);
    if (LIVE_OVERLAYS.has(this.mode) && (f.day % 5 === 0 || this.overlayDay < 0)) this.drawLive(f);
  }

  destroy(): void {
    this.layer.destroy({ children: true });
  }

  set(mode: OverlayMode, frame: RenderFrame | null): void {
    this.mode = mode;
    this.frame = frame;
    if (this.overlaySprite) {
      this.overlaySprite.destroy({ texture: true, textureSource: true });
      this.overlaySprite = null;
    }
    this.overlayDay = -1;
    if (mode === "none") return;
    if (LIVE_OVERLAYS.has(mode)) {
      if (frame) this.drawLive(frame);
      return;
    }
    const { info } = this;
    const c = document.createElement("canvas");
    c.width = info.width;
    c.height = info.height;
    const g = c.getContext("2d");
    if (!g) return;
    const img = g.createImageData(info.width, info.height);
    for (let i = 0; i < info.width * info.height; i++) {
      let r = 0, gg = 0, b = 0, a = 0;
      if (mode === "political" && info.owner[i] > 0) {
        const col = TERRITORY[(info.owner[i] - 1) % TERRITORY.length];
        r = (col >> 16) & 255; gg = (col >> 8) & 255; b = col & 255; a = 110;
      } else if (mode === "moisture" && info.biome[i] !== 0) {
        const m = info.moisture[i];
        r = 40; gg = 90 + (m >> 2); b = 160 + (m >> 2); a = 40 + (m >> 1);
      } else if (mode === "elevation") {
        const e = info.elevation[i];
        r = gg = b = e; a = 120;
      } else if (mode === "resources" && info.resource[i] !== 0) {
        const col = [0, 0x8fd18a, 0xb0b0b6, 0x2a2a2a, 0x6fd0e0][info.resource[i]];
        r = (col >> 16) & 255; gg = (col >> 8) & 255; b = col & 255; a = 230;
      }
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
    const sp = new Sprite(textureFromPixels(new Uint8Array(img.data.buffer), info.width, info.height));
    sp.scale.set(TILE);
    this.layer.addChild(sp);
    this.overlaySprite = sp;
  }

  /**
   * Food, wealth and sickness tint each town's land by one number; trade draws the roads caravans use.
   * Food: price against base (green under 110 %, amber to 200 %, red beyond). Wealth: mean citizen wealth
   * against the world's. Sickness: share of a town's people sick or incubating.
   */
  private drawLive(f: RenderFrame): void {
    const { info } = this;
    this.overlayDay = f.day;
    if (this.overlaySprite) {
      this.overlaySprite.destroy({ texture: true, textureSource: true });
      this.overlaySprite = null;
    }
    const c = document.createElement("canvas");
    c.width = info.width;
    c.height = info.height;
    const g = c.getContext("2d");
    if (!g) return;
    const mode = this.mode;
    if (mode === "trade") {
      // roads: every route a caravan has ever used, brighter and wider by what is on it today
      const traffic = new Map<string, number>();
      for (const [a, b] of f.routes) traffic.set(`${Math.min(a, b)}-${Math.max(a, b)}`, 0);
      for (const cv of f.caravans) { const k = `${Math.min(cv.from, cv.to)}-${Math.max(cv.from, cv.to)}`; traffic.set(k, (traffic.get(k) ?? 0) + cv.qty); }
      g.lineCap = "round";
      for (const [k, qty] of traffic) {
        const [a, b] = k.split("-").map(Number);
        const sa = info.settlements[a];
        const sb = info.settlements[b];
        if (!sa || !sb) continue;
        g.strokeStyle = `rgba(255, 214, 120, ${Math.min(1, 0.6 + qty / 150)})`;
        g.lineWidth = Math.min(3, 1.3 + qty / 80);
        g.beginPath();
        g.moveTo(sa.cx + 0.5, sa.cy + 0.5);
        g.lineTo(sb.cx + 0.5, sb.cy + 0.5);
        g.stroke();
      }
      // towns that ban exports or shut their borders get a ring
      for (const st of f.settlements) {
        const civ = f.civs.find((x) => x.id === st.civ);
        if (!civ || (!civ.exportBan && !civ.borders && !civ.quarantine)) continue;
        g.strokeStyle = civ.quarantine ? "rgba(120, 220, 120, 0.9)" : civ.exportBan ? "rgba(255, 120, 80, 0.9)" : "rgba(200, 200, 220, 0.9)";
        g.lineWidth = 1;
        g.beginPath();
        g.arc(st.cx + 0.5, st.cy + 0.5, 6, 0, Math.PI * 2);
        g.stroke();
      }
    } else {
      // one value per settlement, 0..1, painted over its territory
      const value = new Map<number, number>();
      if (mode === "food") for (const st of f.settlements) value.set(st.id, Math.max(0, Math.min(1, (st.foodRatio - 100) / 150)));
      else if (mode === "sickness") for (const st of f.settlements) value.set(st.id, st.population ? Math.min(1, (3 * st.sick) / st.population) : 0);
      else if (mode === "wealth") {
        const sum = new Map<number, number>();
        const n = new Map<number, number>();
        let all = 0;
        let alive = 0;
        for (let i = 0; i < f.citizens.length; i += CZ.STRIDE) {
          if (f.citizens[i + CZ.alive] !== 1) continue;
          const st = f.citizens[i + CZ.settlement];
          sum.set(st, (sum.get(st) ?? 0) + f.citizens[i + CZ.wealth]);
          n.set(st, (n.get(st) ?? 0) + 1);
          all += f.citizens[i + CZ.wealth];
          alive++;
        }
        const mean = alive ? all / alive : 1;
        for (const st of f.settlements) value.set(st.id, n.get(st.id) ? Math.max(0, Math.min(1, (sum.get(st.id)! / n.get(st.id)!) / (2 * mean))) : 0);
      }
      // every land tile takes the value of the nearest town within reach, fading with distance, so the
      // tint reads at any zoom instead of hiding under the buildings
      const REACH = 16;
      const towns = f.settlements.filter((st) => value.has(st.id));
      const img = g.createImageData(info.width, info.height);
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const i = y * info.width + x;
          if (info.biome[i] === 0) continue; // sea
          let best = -1;
          let bestD = REACH * REACH + 1;
          for (const st of towns) {
            const d = (st.cx - x) * (st.cx - x) + (st.cy - y) * (st.cy - y);
            if (d < bestD) { bestD = d; best = st.id; }
          }
          if (best < 0) continue;
          const v = value.get(best)!;
          let r = 0, gg = 0, b = 0;
          if (mode === "wealth") { r = 60 + Math.round(180 * v); gg = 40 + Math.round(150 * v); b = 20; }
          else { r = 60 + Math.round(195 * v); gg = 200 - Math.round(160 * v); b = 60 - Math.round(40 * v); } // green → red
          const fade = 1 - Math.sqrt(bestD) / REACH;
          img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = Math.round(90 + 110 * fade);
        }
      }
      g.putImageData(img, 0, 0);
    }
    const pixels = g.getImageData(0, 0, info.width, info.height).data;
    const sp = new Sprite(textureFromPixels(new Uint8Array(pixels.buffer), info.width, info.height));
    sp.scale.set(TILE);
    this.layer.addChild(sp);
    this.overlaySprite = sp;
  }

  /** Caravans: a cart drawn on the straight road between two towns, placed by how far along the trip the day is. */}
