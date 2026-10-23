/**
 * Procedural placeholder pixel art, drawn with Canvas 2D at native pixel size.
 * Every sprite is generated from the DESIGN_SYSTEM palette and a deterministic hash,
 * so it is original by construction. The M8 art pass replaces these with hand-drawn
 * sheets of the same dimensions (docs/04 "Art direction").
 */
import { BUILDING_SIZE } from "../sim/data/buildings";
import type { BuildingKind, Occupation } from "../sim/types";
import { hash2 } from "../sim/worldgen/noise";
import { PAL, hex } from "./palette";

export const TILE = 16;

function canvas(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  g.imageSmoothingEnabled = false;
  return { c, g };
}

function px(g: CanvasRenderingContext2D, x: number, y: number, color: number, w = 1, h = 1): void {
  g.fillStyle = hex(color);
  g.fillRect(x, y, w, h);
}

// ───────────────────────── terrain tiles ─────────────────────────

export type TileName = "ocean0" | "ocean1" | "ocean2" | "ocean3" | "coast" | "grassland" | "forest" | "hills" | "mountain" | "desert" | "grassland_dry" | "forest_dry" | "hills_dry";

function speckle(g: CanvasRenderingContext2D, base: number, dark: number, light: number, seed: number, density: number): void {
  px(g, 0, 0, base, TILE, TILE);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const h = hash2(x, y, seed);
      if (h % 100 < density) px(g, x, y, h % 2 ? dark : light);
    }
}

/** Number of drawn variants per land tile (M8); the scene picks one by tile position. */
export const TILE_VARIANTS = 4;

/**
 * One terrain tile. `variant` (0..3) moves the speckle seed and the decoration — a flower pair, a
 * tuft, a pebble, a third tree, a second ridge — so a field is not a wallpaper of one stamp.
 */
export function makeTile(name: TileName, variant = 0): HTMLCanvasElement {
  const { c, g } = canvas(TILE, TILE);
  const v = variant % TILE_VARIANTS;
  const vs = v * 97; // seed shift per variant
  switch (name) {
    case "ocean0":
    case "ocean1":
    case "ocean2":
    case "ocean3": {
      const f = Number(name.slice(5));
      px(g, 0, 0, 0x1f3f78, TILE, TILE);
      // slow-moving highlight bands: 4 frames, each shifted 1 px
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const h = hash2(x, y, 11);
          if ((x + y + f) % 8 === 0 && h % 3 === 0) px(g, x, y, 0x2b5a9c);
          if (h % 37 === 0) px(g, (x + f) % TILE, y, 0x3b6ea5);
        }
      break;
    }
    case "coast":
      speckle(g, PAL.sand, PAL.sandDark, 0xe6d3a2, 21 + vs, 14);
      if (v === 1) { px(g, 4, 10, 0xf3eadb, 2, 1); px(g, 5, 9, 0xf3eadb, 1, 1); } // a shell
      else if (v === 2) { px(g, 10, 5, PAL.ashDark, 3, 2); px(g, 11, 4, PAL.ash, 1, 1); } // a pebble
      else if (v === 3) { px(g, 2, 3, PAL.sandDark, 6, 1); px(g, 7, 12, PAL.sandDark, 7, 1); } // tide lines
      break;
    case "grassland":
      speckle(g, PAL.moss, PAL.mossDark, 0x74944a, 31 + vs, 12);
      if (v === 1) { // tufts
        px(g, 3, 9, PAL.mossDark, 1, 3); px(g, 4, 8, 0x74944a, 1, 3); px(g, 5, 10, PAL.mossDark, 1, 2);
        px(g, 11, 4, PAL.mossDark, 1, 3); px(g, 12, 3, 0x74944a, 1, 3);
      } else if (v === 2) { // a pair of flowers
        px(g, 4, 5, 0xf3eadb); px(g, 3, 6, 0xf3eadb); px(g, 5, 6, 0xf3eadb); px(g, 4, 7, 0xf3eadb); px(g, 4, 6, 0xf2c14e);
        px(g, 11, 11, 0xd49bd6); px(g, 10, 12, 0xd49bd6); px(g, 12, 12, 0xd49bd6); px(g, 11, 13, 0xd49bd6); px(g, 11, 12, 0xf2c14e);
      } else if (v === 3) { // a half-buried stone
        px(g, 9, 9, PAL.stoneDark, 4, 2); px(g, 10, 8, PAL.stone, 2, 1); px(g, 9, 9, PAL.stone, 1, 1);
      }
      break;
    case "forest": {
      speckle(g, PAL.forest, PAL.forestDark, PAL.moss, 41 + vs, 8);
      // two or three canopies per tile, placed by variant; the third is a sapling or a big old tree
      const spots: ReadonlyArray<readonly [number, number, number]> = v === 0 ? [[4, 5, 0], [11, 10, 0]] : v === 1 ? [[5, 4, 0], [10, 11, 0], [12, 3, 1]] : v === 2 ? [[8, 7, 2]] : [[3, 10, 0], [11, 5, 0], [6, 3, 1]];
      for (const [cx, cy, kind] of spots) {
        if (kind === 2) { // a broad old tree
          px(g, cx - 4, cy - 1, PAL.forestDark, 9, 5);
          px(g, cx - 3, cy - 3, 0x4a6e34, 7, 2);
          px(g, cx - 2, cy - 4, 0x5a7e3a, 5, 1);
          px(g, cx - 2, cy - 1, 0x4a6e34, 3, 2);
          px(g, cx, cy + 4, 0x4a3320, 1, 3);
          px(g, cx - 1, cy + 6, 0x3a2a18, 3, 1);
        } else if (kind === 1) { // a sapling
          px(g, cx - 1, cy, 0x4a6e34, 3, 2);
          px(g, cx, cy - 1, 0x5a7e3a, 1, 1);
          px(g, cx, cy + 2, 0x4a3320, 1, 2);
        } else {
          px(g, cx - 2, cy - 1, PAL.forestDark, 5, 4);
          px(g, cx - 1, cy - 2, 0x4a6e34, 3, 1);
          px(g, cx - 1, cy - 1, 0x4a6e34, 3, 2);
          px(g, cx, cy + 3, 0x4a3320, 1, 2);
        }
      }
      break;
    }
    case "hills": {
      speckle(g, PAL.field, PAL.ashDark, 0xb8b06a, 51 + vs, 10);
      const ridges: ReadonlyArray<readonly [number, number, number]> = v === 0 ? [[2, 9, 5], [9, 12, 5]] : v === 1 ? [[1, 5, 6], [8, 9, 6], [4, 13, 4]] : v === 2 ? [[5, 7, 7]] : [[2, 11, 4], [10, 4, 5]];
      for (const [x, y, w] of ridges) {
        px(g, x, y, PAL.ashDark, w, 1);
        px(g, x + 1, y - 1, PAL.ashDark, w - 2, 1);
        px(g, x + 1, y + 1, 0xb8b06a, w - 1, 1); // the lit side of the slope
      }
      if (v === 3) { px(g, 12, 11, PAL.stoneDark, 3, 2); px(g, 13, 10, PAL.stone, 1, 1); }
      break;
    }
    case "mountain": {
      speckle(g, PAL.stone, PAL.stoneDark, 0xb0b0b6, 61 + vs, 16);
      // a peak: shadowed west face, lit east face, snow on top; the peak moves by variant
      const pk = [7, 4, 10, 6][v];
      const top = [1, 3, 2, 5][v];
      for (let dy = 0; dy < 10; dy++) {
        const y = top + dy;
        if (y >= TILE) break;
        px(g, pk - dy, y, PAL.stoneDark, dy + 1, 1);
        px(g, pk + 1, y, 0xb0b0b6, dy, 1);
      }
      px(g, pk - 1, top, PAL.snow, 3, 1);
      px(g, pk - 2, top + 1, PAL.snow, 5, 1);
      px(g, pk - 1, top + 2, PAL.snow, 2, 1);
      if (v === 2) px(g, 2, 12, PAL.stoneDark, 1, 4);
      break;
    }
    case "desert":
      speckle(g, PAL.desert, PAL.desertDark, 0xe3c07c, 71 + vs, 9);
      if (v === 0) { px(g, 1, 4, PAL.desertDark, 6, 1); px(g, 8, 11, PAL.desertDark, 7, 1); }
      else if (v === 1) { px(g, 3, 8, PAL.desertDark, 9, 1); px(g, 5, 7, 0xe3c07c, 5, 1); }
      else if (v === 2) { px(g, 7, 5, 0x5e7a3a, 1, 6); px(g, 5, 7, 0x5e7a3a, 2, 1); px(g, 5, 6, 0x5e7a3a, 1, 2); px(g, 9, 8, 0x5e7a3a, 2, 1); px(g, 10, 7, 0x5e7a3a, 1, 2); } // a cactus
      else { px(g, 2, 12, PAL.desertDark, 5, 1); px(g, 10, 3, PAL.desertDark, 4, 1); px(g, 12, 9, 0xb09a7a, 2, 1); }
      break;
    // drought: grass goes to straw, canopies thin, hills bake
    case "grassland_dry":
      speckle(g, 0x9a9448, 0x7a7430, 0xb8b06a, 31, 12);
      px(g, 3, 6, 0x7a7430, 4, 1);
      px(g, 9, 12, 0x7a7430, 5, 1);
      break;
    case "forest_dry": {
      speckle(g, 0x6a6a34, 0x4a4a24, 0x8a8a48, 41, 8);
      for (const [cx, cy] of [[4, 5], [11, 10]] as const) {
        px(g, cx - 2, cy - 1, 0x5a5a2a, 5, 4);
        px(g, cx - 1, cy - 2, 0x7a7438, 3, 1);
        px(g, cx, cy + 3, 0x4a3320, 1, 2);
      }
      break;
    }
    case "hills_dry": {
      speckle(g, 0xb8a860, 0x8a7a40, 0xd0c080, 51, 10);
      px(g, 2, 9, 0x8a7a40, 5, 1);
      px(g, 9, 12, 0x8a7a40, 5, 1);
      break;
    }
  }
  return c;
}

/** River overlays: a channel through the tile; `mask` bits N=1 E=2 S=4 W=8 say which sides connect. */
export function makeRiver(mask: number): HTMLCanvasElement {
  const { c, g } = canvas(TILE, TILE);
  const a = 4; // channel from x=4..11 (8 px wide)
  const w = 8;
  const bank = 0x2b5080;
  const arm = (x: number, y: number, ww: number, hh: number) => {
    px(g, x, y, bank, ww, hh);
  };
  // banks (slightly wider, darker), then water, then one highlight pixel-line per arm
  if (mask === 0) arm(a - 1, a - 1, w + 2, w + 2);
  if (mask & 1) arm(a - 1, 0, w + 2, a + w);
  if (mask & 4) arm(a - 1, a, w + 2, TILE - a);
  if (mask & 8) arm(0, a - 1, a + w, w + 2);
  if (mask & 2) arm(a, a - 1, TILE - a, w + 2);
  const water = (x: number, y: number, ww: number, hh: number) => px(g, x, y, PAL.river, ww, hh);
  if (mask === 0) water(a, a, w, w);
  if (mask & 1) water(a, 0, w, a + w);
  if (mask & 4) water(a, a, w, TILE - a);
  if (mask & 8) water(0, a, a + w, w);
  if (mask & 2) water(a, a, TILE - a, w);
  const hl = (x: number, y: number, ww: number, hh: number) => px(g, x, y, PAL.riverLight, ww, hh);
  if (mask & 1) hl(a + 2, 0, 1, a + 2);
  if (mask & 4) hl(a + 2, a + 2, 1, TILE - a - 2);
  if (mask & 8) hl(0, a + 2, a + 2, 1);
  if (mask & 2) hl(a + 2, a + 2, TILE - a - 2, 1);
  if (mask === 0) hl(a + 2, a + 2, 2, 2);
  return c;
}

/**
 * Shore foam (M8): on an ocean tile, a pale line along each side that touches land; `mask` bits
 * N=1 E=2 S=4 W=8, `frame` 0..3 shifts the breaks so it shimmers with the water.
 */
export function makeFoam(mask: number, frame: number): HTMLCanvasElement {
  const { c, g } = canvas(TILE, TILE);
  const foam = 0xbfd8e8;
  const spray = 0xe8f2f8;
  const line = (x: number, y: number, w: number, h: number, along: "x" | "y") => {
    for (let k = 0; k < (along === "x" ? w : h); k++) {
      const hsh = hash2(k, mask, 17 + frame);
      if (hsh % 5 === 0) continue; // a break in the foam
      if (along === "x") px(g, x + k, y, hsh % 7 === 0 ? spray : foam);
      else px(g, x, y + k, hsh % 7 === 0 ? spray : foam);
    }
  };
  if (mask & 1) { line(0, 0, TILE, 1, "x"); line(0, 1, TILE, 1, "x"); }
  if (mask & 4) { line(0, TILE - 1, TILE, 1, "x"); line(0, TILE - 2, TILE, 1, "x"); }
  if (mask & 8) { line(0, 0, 1, TILE, "y"); line(1, 0, 1, TILE, "y"); }
  if (mask & 2) { line(TILE - 1, 0, 1, TILE, "y"); line(TILE - 2, 0, 1, TILE, "y"); }
  return c;
}

/**
 * Road overlays (M8): a trodden dirt path through the tile; `mask` bits N=1 E=2 S=4 W=8 say which
 * sides connect, bit 16 marks a road tile with no neighbours (a crossroads stub). Two wheel ruts
 * run along each arm and a few packed-earth speckles keep it from reading as a stripe.
 */
export function makeRoad(mask: number): HTMLCanvasElement {
  const { c, g } = canvas(TILE, TILE);
  const a = 5; // path from x=5..10 (6 px wide)
  const w = 6;
  const earth = 0xb08a58;
  const edge = 0x8a6a40;
  const rut = 0x9a7a4a;
  const painted = new Uint8Array(TILE * TILE);
  const band = (x: number, y: number, ww: number, hh: number, col: number) => {
    px(g, x, y, col, ww, hh);
    for (let yy = y; yy < y + hh; yy++) for (let xx = x; xx < x + ww; xx++) if (xx >= 0 && yy >= 0 && xx < TILE && yy < TILE) painted[yy * TILE + xx] = 1;
  };
  const arms = (col: number, pad: number) => {
    const aa = a - pad;
    const wwid = w + 2 * pad;
    if ((mask & 15) === 0) band(aa, aa, wwid, wwid, col);
    if (mask & 1) band(aa, 0, wwid, a + w + pad, col);
    if (mask & 4) band(aa, aa, wwid, TILE - aa, col);
    if (mask & 8) band(0, aa, a + w + pad, wwid, col);
    if (mask & 2) band(aa, aa, TILE - aa, wwid, col);
  };
  arms(edge, 1);
  arms(earth, 0);
  // ruts: one pixel-line each side of the centre along every arm
  if (mask & 1) { band(a + 1, 0, 1, a + w, rut); band(a + w - 2, 0, 1, a + w, rut); }
  if (mask & 4) { band(a + 1, a, 1, TILE - a, rut); band(a + w - 2, a, 1, TILE - a, rut); }
  if (mask & 8) { band(0, a + 1, a + w, 1, rut); band(0, a + w - 2, a + w, 1, rut); }
  if (mask & 2) { band(a, a + 1, TILE - a, 1, rut); band(a, a + w - 2, TILE - a, 1, rut); }
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const h = hash2(x, y, 83 + mask);
      if (h % 23 === 0 && painted[y * TILE + x]) px(g, x, y, h % 2 ? 0xc29a66 : edge);
    }
  return c;
}

/**
 * A bridge (M9): where a road fords a river the deck runs with the road — planks across the water,
 * a rail on each side, posts at the banks. `mask` is the road mask of the tile; the deck follows
 * its N/S or E/W arms.
 */
export function makeBridge(mask: number): HTMLCanvasElement {
  const { c, g } = canvas(TILE, TILE);
  const plank = 0xb08a58;
  const plankDark = 0x8a6a40;
  const rail = 0x5a3a28;
  const vertical = (mask & 5) !== 0 && (mask & 10) === 0 ? true : (mask & 10) !== 0 && (mask & 5) === 0 ? false : (mask & 5) !== 0;
  if (vertical) {
    px(g, 4, 0, plank, 8, TILE);
    for (let y = 0; y < TILE; y += 2) px(g, 4, y, plankDark, 8, 1);
    px(g, 3, 0, rail, 1, TILE);
    px(g, 12, 0, rail, 1, TILE);
    for (const y of [0, 7, 15]) { px(g, 2, y, rail, 2, 1); px(g, 12, y, rail, 2, 1); }
  } else {
    px(g, 0, 4, plank, TILE, 8);
    for (let x = 0; x < TILE; x += 2) px(g, x, 4, plankDark, 1, 8);
    px(g, 0, 3, rail, TILE, 1);
    px(g, 0, 12, rail, TILE, 1);
    for (const x of [0, 7, 15]) { px(g, x, 2, rail, 1, 2); px(g, x, 12, rail, 1, 2); }
  }
  return c;
}

// ───────────────────────── buildings ─────────────────────────
//
// Three models per kind, one per tier, each with its own silhouette: a hut becomes a cottage
// becomes a stone townhouse; a shed becomes a barn becomes a silo. Higher tiers may rise above
// the footprint (EXTRA px); the renderer anchors every building sprite at the bottom of its plot.
// `civColor` is the owning civilization's banner colour: on doors, flags, awnings and roof ridges.

const KIND_STYLE: Record<BuildingKind, { wall: number; roof: number; trim: number }> = {
  house: { wall: 0xc9a27a, roof: 0x8a3b2a, trim: 0x5a3a28 },
  farm: { wall: 0xa9743f, roof: 0x7a2f22, trim: 0x5a3a28 },
  workshop: { wall: 0x8a8f9a, roof: 0x3d4452, trim: 0x2a2f3a },
  factory: { wall: 0x9a5a48, roof: 0x3a3a3a, trim: 0x2a2a2a },
  market: { wall: 0xd8c39a, roof: 0xc0512f, trim: 0xf3eadb },
  clinic: { wall: 0xf3eadb, roof: 0x6fa0d4, trim: 0x3b6ea5 },
  lab: { wall: 0xe6e9ee, roof: 0x2f4f84, trim: 0x6fa0d4 },
  town_hall: { wall: 0xb9b2a4, roof: 0x5a3a28, trim: 0xf2c14e },
  power_plant: { wall: 0x4e5560, roof: 0x2c3038, trim: 0xf2c14e },
  warehouse: { wall: 0x8b6b4a, roof: 0x4a3a2a, trim: 0x2a2a2a },
  barracks: { wall: 0x7d7468, roof: 0x4a3f36, trim: 0x2a2a2a },
  ruin: { wall: 0x6a635a, roof: 0x4a4540, trim: 0x2a2a2a },
};

const THATCH = 0xc9a24a;
const THATCH_DARK = 0x9a7a30;
const TILE_RED = 0x9a3b2a;
const SLATE = 0x4a5160;
const STONE = 0x9a9aa0;
const STONE_DARK = 0x6c6c74;
const TIMBER = 0x8a5a3a;
const TIMBER_DARK = 0x5a3a28;
const PLASTER = 0xe8dcc4;
const BRICK = 0x9a5a48;
const BRICK_DARK = 0x6e3f32;
const GLASS = 0xf2c14e;
const SMOKE = 0x8a94a8;

/** Extra height above the footprint per tier. */
export function buildingExtra(kind: BuildingKind, tier: number): number {
  if (kind === "ruin" || kind === "farm") return 0;
  return tier >= 3 ? 12 : tier === 2 ? 4 : 0;
}

function lighten(c: number, by = 30): number {
  const r = Math.min(255, ((c >> 16) & 255) + by);
  const g = Math.min(255, ((c >> 8) & 255) + by);
  const b = Math.min(255, (c & 255) + by);
  return (r << 16) | (g << 8) | b;
}
function darken(c: number, by = 30): number {
  const r = Math.max(0, ((c >> 16) & 255) - by);
  const g = Math.max(0, ((c >> 8) & 255) - by);
  const b = Math.max(0, (c & 255) - by);
  return (r << 16) | (g << 8) | b;
}

interface Pen { g: CanvasRenderingContext2D; W: number; H: number; top: number }

/** A wall body from y0 to the bottom with a shaded right edge and a 1-px base. */
function body(p: Pen, x: number, y0: number, w: number, color: number, shade = darken(color, 35)): void {
  px(p.g, x, y0, color, w, p.H - 1 - y0);
  px(p.g, x + w - 3, y0, shade, 3, p.H - 1 - y0);
  px(p.g, x, p.H - 1, darken(color, 60), w, 1);
}
/** A peaked roof over [x, x+w) rising from y0 by `h`, with a ridge. */
function peakRoof(p: Pen, x: number, y0: number, w: number, h: number, color: number, ridge = darken(color, 40)): void {
  for (let i = 0; i < h; i++) {
    const inset = Math.floor(((h - 1 - i) * (w / 2)) / h);
    px(p.g, x + inset, y0 - h + 1 + i, i % 3 === 2 ? darken(color, 15) : color, w - inset * 2, 1);
  }
  px(p.g, x + Math.floor(w / 2) - 1, y0 - h, ridge, 2, 1);
}
/** A flat/hipped roof slab with an overhang. */
function flatRoof(p: Pen, x: number, y0: number, w: number, h: number, color: number): void {
  px(p.g, x - 1, y0 - h, color, w + 2, h);
  px(p.g, x - 1, y0 - 1, darken(color, 40), w + 2, 1);
}
function windows(p: Pen, x: number, y: number, w: number, n: number, color = GLASS): void {
  for (let i = 0; i < n; i++) px(p.g, x + Math.floor(((w - 3) * (i + 0.5)) / n), y, color, 3, 3);
}
function door(p: Pen, cx: number, color: number, h = 6): void {
  px(p.g, cx - 2, p.H - 1 - h, color, 4, h);
  px(p.g, cx + 1, p.H - 4, GLASS, 1, 1);
}
function flag(p: Pen, x: number, y: number, color: number, h = 8): void {
  px(p.g, x, y, TIMBER_DARK, 1, h);
  px(p.g, x + 1, y, color, 4, 3);
}
function chimney(p: Pen, x: number, y: number, h: number, color = BRICK_DARK): void {
  px(p.g, x, y, color, 3, h);
  px(p.g, x - 1, y, darken(color, 20), 5, 1);
  px(p.g, x + 1, y - 2, SMOKE, 1, 1);
  px(p.g, x + 2, y - 4, SMOKE, 1, 1);
}
function tower(p: Pen, x: number, y0: number, w: number, h: number, wall: number, roof: number, civ: number): void {
  px(p.g, x, y0 - h, wall, w, h);
  px(p.g, x + w - 2, y0 - h, darken(wall, 35), 2, h);
  peakRoof(p, x - 1, y0 - h, w + 2, Math.max(3, Math.floor(w / 2) + 1), roof);
  flag(p, x + Math.floor(w / 2), y0 - h - Math.floor(w / 2) - 8, civ);
}

export function makeBuilding(kind: BuildingKind, tier: number, civColor = 0xf2c14e): HTMLCanvasElement {
  const { w, h } = BUILDING_SIZE[kind];
  const extra = buildingExtra(kind, tier);
  const W = w * TILE;
  const H = h * TILE + extra;
  const { c, g } = canvas(W, H);
  const p: Pen = { g, W, H, top: extra };
  const s = KIND_STYLE[kind];
  const civ = civColor;
  const t = Math.max(1, Math.min(3, tier));

  switch (kind) {
    case "house": {
      if (t === 1) {
        // hut: timber walls, thatched peak, one window
        body(p, 3, p.top + 14, W - 6, TIMBER);
        peakRoof(p, 1, p.top + 15, W - 2, 10, THATCH, THATCH_DARK);
        windows(p, 6, p.top + 18, W - 12, 1);
        door(p, Math.floor(W / 2) + 6, civ, 5);
      } else if (t === 2) {
        // cottage: plaster walls, red tiles, chimney, two windows
        body(p, 2, p.top + 12, W - 4, PLASTER);
        px(g, 2, p.top + 12, TIMBER_DARK, W - 4, 1);
        peakRoof(p, 0, p.top + 13, W, 12, TILE_RED);
        chimney(p, W - 9, p.top + 2, 8);
        windows(p, 5, p.top + 17, W - 10, 2);
        door(p, Math.floor(W / 2), civ, 6);
      } else {
        // townhouse: two storeys of stone, slate roof, four windows, civ banner
        body(p, 2, p.top + 6, W - 4, STONE, STONE_DARK);
        px(g, 2, p.top + 6 + 10, STONE_DARK, W - 4, 1);
        flatRoof(p, 2, p.top + 6, W - 4, 4, SLATE);
        peakRoof(p, 4, p.top + 2, W - 8, 4, SLATE);
        windows(p, 5, p.top + 9, W - 10, 2);
        windows(p, 5, p.top + 19, W - 10, 2);
        door(p, Math.floor(W / 2), civ, 7);
        flag(p, W - 5, p.top - 4 + 4, civ, 7);
      }
      return c;
    }
    case "farm": {
      // fields: furrow rows; tier 2 adds a barn and fence; tier 3 an orchard and a silo
      px(g, 0, 0, 0x7f6a3a, W, H);
      const crop = t === 1 ? 0x79a53a : t === 2 ? 0x8fbf4a : 0x6f9f3a;
      for (let y = 2; y < H; y += 4) px(g, 1, y, crop, W - 2, 2);
      if (t >= 3) for (let y = 3; y < H - 2; y += 8) for (let x = 3; x < W - 2; x += 7) { px(g, x, y, 0x3f6a2a, 3, 3); px(g, x + 1, y + 3, TIMBER_DARK, 1, 2); }
      if (t === 1) {
        px(g, W - 12, 3, TIMBER, 10, 8);
        px(g, W - 13, 2, THATCH, 12, 3);
      } else {
        px(g, W - 16, 2, TILE_RED, 14, 12);
        px(g, W - 15, 6, 0xb9b2a4, 12, 8);
        px(g, W - 10, 9, TIMBER_DARK, 3, 5);
        px(g, 0, H - 3, TIMBER_DARK, W, 1);
        for (let x = 0; x < W; x += 4) px(g, x, H - 5, TIMBER_DARK, 1, 3);
      }
      if (t >= 3) {
        px(g, 2, 2, STONE, 7, 16);
        px(g, 7, 2, STONE_DARK, 2, 16);
        px(g, 1, 1, SLATE, 9, 2);
        flag(p, 5, -6 + 7, civ, 6);
      }
      return c;
    }
    case "workshop": {
      if (t === 1) {
        body(p, 2, p.top + 12, W - 4, TIMBER);
        peakRoof(p, 0, p.top + 13, W, 8, SLATE);
        chimney(p, W - 8, p.top + 6, 7);
        door(p, 9, civ, 7);
        px(g, W - 11, p.top + 17, GLASS, 4, 3);
      } else if (t === 2) {
        body(p, 1, p.top + 10, W - 2, BRICK, BRICK_DARK);
        flatRoof(p, 1, p.top + 10, W - 2, 3, SLATE);
        chimney(p, 4, p.top + 1, 9);
        windows(p, 4, p.top + 14, W - 8, 2);
        door(p, Math.floor(W / 2) + 4, civ, 8);
        px(g, 2, p.top + 22, 0xd8c39a, 6, 4); // sign
      } else {
        body(p, 1, p.top + 4, W - 2, BRICK, BRICK_DARK);
        px(g, 1, p.top + 15, BRICK_DARK, W - 2, 1);
        flatRoof(p, 1, p.top + 4, W - 2, 3, SLATE);
        chimney(p, 3, p.top - 6 + 6, 9);
        chimney(p, W - 7, p.top - 6 + 6, 9);
        windows(p, 4, p.top + 8, W - 8, 3);
        windows(p, 4, p.top + 18, W - 8, 3);
        door(p, Math.floor(W / 2), civ, 8);
      }
      return c;
    }
    case "factory": {
      body(p, 1, p.top + 10, W - 2, BRICK, BRICK_DARK);
      // sawtooth roof grows with tier
      const teeth = 1 + t;
      for (let i = 0; i < teeth; i++) {
        const x = 1 + Math.floor(((W - 2) * i) / teeth);
        const tw = Math.floor((W - 2) / teeth);
        for (let k = 0; k < 6; k++) px(g, x + k, p.top + 10 - k, k % 2 ? SLATE : lighten(SLATE), tw - k, 1);
      }
      for (let i = 0; i < t; i++) chimney(p, 5 + i * 12, p.top - 2 + 2, 12);
      windows(p, 4, p.top + 15, W - 8, 2 + t);
      door(p, Math.floor(W / 2), civ, 7);
      return c;
    }
    case "market": {
      if (t === 1) {
        // stall: posts and a striped awning in the civ colour
        px(g, 2, p.top + 12, TIMBER_DARK, 2, H - 13);
        px(g, W - 4, p.top + 12, TIMBER_DARK, 2, H - 13);
        for (let x = 0; x < W; x += 4) px(g, x, p.top + 10, x % 8 ? civ : PAL.ivory, 4, 4);
        px(g, 4, H - 10, 0xd8c39a, W - 8, 6);
        px(g, 6, H - 9, 0xc0512f, 4, 3);
        px(g, 12, H - 9, 0x79a53a, 4, 3);
        px(g, 18, H - 9, GLASS, 4, 3);
      } else if (t === 2) {
        body(p, 1, p.top + 12, W - 2, 0xd8c39a);
        flatRoof(p, 1, p.top + 12, W - 2, 3, TILE_RED);
        for (let x = 0; x < W; x += 4) px(g, x, p.top + 15, x % 8 ? civ : PAL.ivory, 4, 3);
        door(p, 8, TIMBER_DARK, 8);
        door(p, W - 8, TIMBER_DARK, 8);
      } else {
        body(p, 1, p.top + 6, W - 2, 0xd8c39a);
        flatRoof(p, 1, p.top + 6, W - 2, 3, TILE_RED);
        tower(p, Math.floor(W / 2) - 4, p.top + 6, 8, 10, PLASTER, TILE_RED, civ);
        px(g, Math.floor(W / 2) - 2, p.top - 1 + 1, PAL.ivory, 4, 4); // clock face
        px(g, Math.floor(W / 2), p.top + 1, 0x2a2a2a, 1, 2);
        for (let x = 0; x < W; x += 4) px(g, x, p.top + 9, x % 8 ? civ : PAL.ivory, 4, 3);
        door(p, 8, TIMBER_DARK, 9);
        door(p, W - 8, TIMBER_DARK, 9);
      }
      return c;
    }
    case "clinic": {
      body(p, 2, p.top + (t === 3 ? 4 : 11), W - 4, PAL.ivory, 0xcfc6b6);
      flatRoof(p, 2, p.top + (t === 3 ? 4 : 11), W - 4, 3, t === 1 ? SLATE : 0x6fa0d4);
      windows(p, 5, p.top + (t === 3 ? 8 : 15), W - 10, t === 1 ? 1 : 2, 0xbfe0ff);
      if (t === 3) windows(p, 5, p.top + 18, W - 10, 2, 0xbfe0ff);
      // green cross
      px(g, W - 9, p.top + (t === 3 ? 7 : 14) + 1, 0x4caf6f, 5, 1);
      px(g, W - 7, p.top + (t === 3 ? 7 : 14) - 1, 0x4caf6f, 1, 5);
      door(p, Math.floor(W / 2) - 3, civ, 7);
      if (t === 3) flag(p, 4, p.top - 2 + 2, civ, 7);
      return c;
    }
    case "lab": {
      if (t === 1) {
        body(p, 3, p.top + 16, W - 6, STONE, STONE_DARK);
        peakRoof(p, 1, p.top + 17, W - 2, 10, 0x2f4f84);
        chimney(p, W - 10, p.top + 8, 9, STONE_DARK);
        windows(p, 6, p.top + 21, W - 12, 3, 0xbfe0ff);
        door(p, Math.floor(W / 2), civ, 8);
      } else if (t === 2) {
        body(p, 2, p.top + 14, W - 4, PLASTER);
        // dome
        for (let i = 0; i < 10; i++) {
          const half = Math.floor(Math.sqrt(100 - (10 - i) * (10 - i)) * 1.4);
          px(g, Math.floor(W / 2) - half, p.top + 4 + i, i % 3 ? 0x2f4f84 : 0x3b6ea5, half * 2, 1);
        }
        px(g, Math.floor(W / 2) - 1, p.top + 1, PAL.ember, 2, 3);
        windows(p, 6, p.top + 19, W - 12, 3, 0xbfe0ff);
        windows(p, 6, p.top + 29, W - 12, 3, 0xbfe0ff);
        door(p, Math.floor(W / 2), civ, 8);
      } else {
        body(p, 2, p.top + 10, W - 4, PLASTER);
        flatRoof(p, 2, p.top + 10, W - 4, 3, 0x2f4f84);
        tower(p, Math.floor(W / 2) - 5, p.top + 10, 10, 14, STONE, 0x2f4f84, civ);
        px(g, Math.floor(W / 2) - 1, p.top - 1 + 1, PAL.ember, 3, 3); // the orb
        px(g, Math.floor(W / 2), p.top - 4 + 4, 0xbfe0ff, 1, 1);
        windows(p, 5, p.top + 14, W - 10, 4, 0xbfe0ff);
        windows(p, 5, p.top + 26, W - 10, 4, 0xbfe0ff);
        door(p, Math.floor(W / 2), civ, 8);
      }
      return c;
    }
    case "town_hall": {
      if (t === 1) {
        body(p, 2, p.top + 16, W - 4, TIMBER);
        peakRoof(p, 0, p.top + 17, W, 12, THATCH_DARK, TIMBER_DARK);
        windows(p, 6, p.top + 21, W - 12, 3);
        door(p, Math.floor(W / 2), civ, 9);
        flag(p, Math.floor(W / 2), p.top + 5 - 8 + 8, civ, 10);
      } else if (t === 2) {
        body(p, 1, p.top + 12, W - 2, STONE, STONE_DARK);
        flatRoof(p, 1, p.top + 12, W - 2, 4, SLATE);
        peakRoof(p, 6, p.top + 8, W - 12, 5, SLATE);
        for (let x = 5; x < W - 4; x += 8) px(g, x, p.top + 16, PAL.ivory, 2, H - p.top - 18);
        windows(p, 7, p.top + 18, W - 14, 3);
        door(p, Math.floor(W / 2), civ, 10);
        flag(p, Math.floor(W / 2), p.top - 2 + 2, civ, 9);
      } else {
        // palace: wide stone hall with two towers and a central banner
        body(p, 1, p.top + 10, W - 2, STONE, STONE_DARK);
        flatRoof(p, 1, p.top + 10, W - 2, 4, SLATE);
        tower(p, 2, p.top + 10, 9, 12, STONE, SLATE, civ);
        tower(p, W - 11, p.top + 10, 9, 12, STONE, SLATE, civ);
        for (let x = 13; x < W - 12; x += 6) px(g, x, p.top + 14, PAL.ivory, 2, H - p.top - 16);
        windows(p, 14, p.top + 16, W - 28, 2);
        door(p, Math.floor(W / 2), civ, 11);
        px(g, Math.floor(W / 2) - 3, p.top + 12, civ, 6, 6); // the great banner
      }
      return c;
    }
    case "power_plant": {
      body(p, 1, p.top + 14, W - 2, 0x4e5560, 0x2c3038);
      flatRoof(p, 1, p.top + 14, W - 2, 3, 0x2c3038);
      for (let i = 0; i < t; i++) chimney(p, 4 + i * 9, p.top + 2, 12, 0x5a6270);
      if (t === 3) {
        // cooling tower
        for (let i = 0; i < 18; i++) px(g, W - 16 + Math.floor(i / 6), p.top + 2 + i - 4 + 4, 0x9a9aa0, 14 - Math.floor(i / 3), 1);
        px(g, W - 13, p.top - 2 + 2, 0xd0d6e0, 6, 2);
      }
      windows(p, 4, p.top + 19, W - 8, 3, 0xbfe0ff);
      px(g, Math.floor(W / 2) - 3, p.top + 26, GLASS, 6, 2); // the switch panel glow
      door(p, Math.floor(W / 2), civ, 7);
      return c;
    }
    case "barracks": {
      if (t === 1) {
        // palisade and a tent
        for (let x = 0; x < W; x += 3) px(g, x, p.top + 10, x % 6 ? TIMBER : TIMBER_DARK, 2, H - p.top - 11);
        px(g, 0, p.top + 9, TIMBER_DARK, W, 1);
        peakRoof(p, 10, H - 4, W - 20, 12, 0xd8c39a, civ);
        px(g, Math.floor(W / 2) - 1, H - 10, civ, 2, 6);
        flag(p, 3, p.top + 1, civ, 8);
      } else if (t === 2) {
        body(p, 1, p.top + 10, W - 2, STONE, STONE_DARK);
        for (let x = 1; x < W - 1; x += 4) px(g, x, p.top + 8, STONE, 2, 2); // crenellations
        tower(p, W - 11, p.top + 10, 9, 8, STONE, SLATE, civ);
        px(g, 6, p.top + 15, 0x2a2a2a, 3, 3);
        px(g, 16, p.top + 15, 0x2a2a2a, 3, 3);
        door(p, 11, TIMBER_DARK, 9);
      } else {
        body(p, 1, p.top + 8, W - 2, STONE_DARK, 0x4a4a52);
        for (let x = 1; x < W - 1; x += 4) px(g, x, p.top + 6, STONE_DARK, 2, 2);
        tower(p, 1, p.top + 8, 10, 12, STONE, SLATE, civ);
        tower(p, W - 11, p.top + 8, 10, 12, STONE, SLATE, civ);
        px(g, 15, p.top + 12, 0x2a2a2a, 3, 3);
        px(g, 23, p.top + 12, 0x2a2a2a, 3, 3);
        px(g, 31, p.top + 12, 0x2a2a2a, 3, 3);
        door(p, Math.floor(W / 2), TIMBER_DARK, 10);
        px(g, Math.floor(W / 2) - 3, H - 11, civ, 6, 2); // lintel banner
      }
      return c;
    }
    case "warehouse": {
      body(p, 1, p.top + 10, W - 2, TIMBER, TIMBER_DARK);
      peakRoof(p, 0, p.top + 11, W, 7, SLATE);
      door(p, Math.floor(W / 2), TIMBER_DARK, 9);
      px(g, Math.floor(W / 2) - 5, H - 10, TIMBER_DARK, 10, 1);
      return c;
    }
    case "ruin": {
      px(g, 2, 6, s.wall, 10, 8);
      px(g, 4, 3, s.roof, 4, 3);
      px(g, 9, 10, s.trim, 5, 4);
      px(g, 1, 13, 0x4a4540, 3, 2);
      px(g, 12, 5, 0x4a4540, 2, 2);
      return c;
    }
  }
  return c;
}

// ───────────────────────── citizens ─────────────────────────

const OCC_COLOR: Record<Occupation, number> = {
  unemployed: 0x8c8378,
  farmer: 0x79a53a,
  worker: 0x5a6b8a,
  merchant: 0xc0512f,
  engineer: 0xf2c14e,
  scientist: 0xe6e9ee,
  doctor: 0x6fa0d4,
  official: 0x7a4e9a,
  soldier: 0xa33a3a,
  ruler: 0x5a2a7a,
  retired: 0xb9b2a4,
  child: 0xf0a060,
};
const SKIN = [0xf1c9a5, 0xd9a577, 0xb07a4d, 0x8a5a3a, 0x5c3a24];
const HAIR = [0x2a1a10, 0x4a3320, 0x8a5a3a, 0xd9b36a, 0x3a3a3a, 0xb0b0b6];

export const CITIZEN_W = 16;
export const CITIZEN_H = 24;

export function makeCitizen(occupation: Occupation, id: number, frame: 0 | 1): HTMLCanvasElement {
  const { c, g } = canvas(CITIZEN_W, CITIZEN_H);
  const skin = SKIN[hash2(id, 1, 7) % SKIN.length];
  const hair = HAIR[hash2(id, 2, 7) % HAIR.length];
  // clothing: three cuts per occupation — plain, belted, or a darker coat with a lighter collar
  const cut = hash2(id, 3, 7) % 3;
  const base = OCC_COLOR[occupation];
  const tunic = cut === 2 ? darken(base, 25) : base;
  const small = occupation === "child";
  const top = small ? 8 : 4;
  // head
  px(g, 5, top, skin, 6, 5);
  px(g, 5, top, hair, 6, 2);
  px(g, 4, top + 1, hair, 1, 2);
  if (hash2(id, 4, 7) % 3 === 0) px(g, 6, top + 3, 0x3a2a1a, 4, 1); // a beard or a scarf, by the hash
  // body
  px(g, 4, top + 5, tunic, 8, small ? 6 : 8);
  if (cut === 1) px(g, 4, top + 9, darken(base, 50), 8, 1); // belt
  if (cut === 2) px(g, 6, top + 5, lighten(base, 40), 4, 1); // collar
  px(g, 3, top + 6, skin, 1, 4);
  px(g, 12, top + 6, skin, 1, 4);
  // hats and tools of the trade
  if (occupation === "farmer") { px(g, 4, top - 1, 0xc9a24a, 8, 1); px(g, 6, top - 2, 0xc9a24a, 4, 1); }
  if (occupation === "merchant") { px(g, 5, top - 1, 0x5a3a28, 6, 1); px(g, 6, top - 2, 0x5a3a28, 4, 1); }
  if (occupation === "official") { px(g, 5, top - 3, 0x2a2f3a, 6, 3); }
  if (occupation === "scientist") { px(g, 5, top + 2, 0x2a2f3a, 2, 1); px(g, 9, top + 2, 0x2a2f3a, 2, 1); }
  if (occupation === "doctor") { px(g, 5, top - 1, 0xf3eadb, 6, 1); px(g, 7, top - 1, 0xc0512f, 2, 1); }
  if (occupation === "engineer") { px(g, 4, top - 1, 0xf2c14e, 8, 1); px(g, 5, top - 2, 0xf2c14e, 6, 1); }
  if (occupation === "worker") { px(g, 5, top - 1, 0x5a6b8a, 6, 1); }
  // gear: a soldier carries a spear and a shield; a ruler wears a crown and a gold sash
  if (occupation === "soldier") {
    px(g, 14, top - 2, 0x8a5a3a, 1, 16);
    px(g, 13, top - 4, 0xd0d6e0, 3, 3);
    px(g, 1, top + 6, 0xd8c39a, 3, 5);
    px(g, 2, top + 7, 0xa33a3a, 1, 3);
    px(g, 5, top + 1, 0x8a94a8, 6, 2); // helmet
  }
  if (occupation === "ruler") {
    px(g, 5, top - 1, 0xf2c14e, 6, 1);
    px(g, 5, top - 2, 0xf2c14e, 1, 1);
    px(g, 8, top - 3, 0xf2c14e, 1, 2);
    px(g, 10, top - 2, 0xf2c14e, 1, 1);
    for (let i = 0; i < 6; i++) px(g, 4 + i, top + 6 + i, 0xf2c14e, 1, 1); // sash
  }
  // legs (walk frame alternates)
  const legY = top + (small ? 11 : 13);
  const legH = CITIZEN_H - legY;
  if (frame === 0) {
    px(g, 5, legY, 0x3a3a3a, 2, legH);
    px(g, 9, legY, 0x3a3a3a, 2, legH);
  } else {
    px(g, 4, legY, 0x3a3a3a, 2, legH - 1);
    px(g, 10, legY, 0x3a3a3a, 2, legH - 1);
  }
  return c;
}

/** A caravan (M7): a covered cart and its ox, the load coloured by the good it carries. */
export function makeCaravan(good: string): HTMLCanvasElement {
  const { c, g } = canvas(24, 16);
  const load = good === "food" ? 0xd8b25a : good === "materials" ? 0x9a7b55 : 0x6fd0e0;
  // ox
  px(g, 1, 7, 0x6b4a32, 7, 5);
  px(g, 0, 6, 0x6b4a32, 2, 3);
  px(g, 2, 12, 0x3a2a1a, 1, 3);
  px(g, 6, 12, 0x3a2a1a, 1, 3);
  px(g, 0, 5, 0xe8e0c8, 1, 1); // horn
  // yoke and cart bed
  px(g, 8, 9, 0x8a5a3a, 3, 1);
  px(g, 11, 8, 0x8a5a3a, 12, 4);
  // canopy and load
  px(g, 12, 4, 0xe6dcc3, 10, 4);
  px(g, 13, 3, 0xe6dcc3, 8, 1);
  px(g, 13, 6, load, 8, 2);
  // wheels
  px(g, 13, 12, 0x3a3a3a, 3, 3);
  px(g, 19, 12, 0x3a3a3a, 3, 3);
  px(g, 14, 13, 0x8a8a8a, 1, 1);
  px(g, 20, 13, 0x8a8a8a, 1, 1);
  return c;
}
