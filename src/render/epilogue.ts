/**
 * Epilogue scenes (M10): one procedural vignette per ending family, drawn from the same tile,
 * building and citizen art the map uses, at native pixel size and scaled up by the ending screen.
 * Every scene is original by construction and deterministic for an ending id — the same world
 * ends with the same picture.
 */
import { hash2 } from "../sim/worldgen/noise";
import type { EndingResult } from "../sim/types";
import { TILE, makeBuilding, makeCaravan, makeCitizen, makeRiver, makeRoad, makeTile } from "./art";
import type { TileName } from "./art";
import { PAL, hex } from "./palette";

export const EPILOGUE_W = 320;
export const EPILOGUE_H = 112;
const COLS = EPILOGUE_W / TILE; // 20
const ROWS = EPILOGUE_H / TILE; // 7

type Ctx = CanvasRenderingContext2D;

function ground(g: Ctx, name: TileName, seed: number, alt?: TileName, altEvery = 0): void {
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const v = hash2(x, y, seed) % 4;
      const useAlt = alt && altEvery > 0 && hash2(x, y, seed + 1) % altEvery === 0;
      g.drawImage(makeTile(useAlt ? alt! : name, v), x * TILE, y * TILE);
    }
}

function river(g: Ctx, col: number, dry = false): void {
  for (let y = 0; y < ROWS; y++) {
    const mask = (y > 0 ? 1 : 0) | (y < ROWS - 1 ? 4 : 0);
    g.drawImage(makeRiver(mask), col * TILE, y * TILE);
    if (dry) { g.fillStyle = "rgba(201, 162, 74, 0.75)"; g.fillRect(col * TILE + 3, y * TILE, 10, TILE); if (y % 3 === 1) { g.fillStyle = hex(PAL.river); g.fillRect(col * TILE + 6, y * TILE + 4, 4, 6); } }
  }
}

function road(g: Ctx, row: number, from = 0, to = COLS): void {
  for (let x = from; x < to; x++) g.drawImage(makeRoad(16 | (x > from ? 8 : 0) | (x < to - 1 ? 2 : 0)), x * TILE, row * TILE);
}

/** A building whose foot stands on the road row (its bottom edge at row 5). */
function building(g: Ctx, kind: Parameters<typeof makeBuilding>[0], tier: number, x: number, _y: number, civColor?: number): void {
  const c = makeBuilding(kind, tier, civColor);
  g.drawImage(c, x * TILE, 5 * TILE - c.height);
}

function person(g: Ctx, occ: Parameters<typeof makeCitizen>[0], id: number, x: number, y: number, tint?: string): void {
  const c = makeCitizen(occ, id, (id % 2) as 0 | 1);
  if (tint) {
    const t = document.createElement("canvas");
    t.width = c.width; t.height = c.height;
    const tg = t.getContext("2d")!;
    tg.drawImage(c, 0, 0);
    tg.globalCompositeOperation = "source-atop";
    tg.fillStyle = tint;
    tg.fillRect(0, 0, t.width, t.height);
    g.drawImage(t, x, y - c.height);
  } else g.drawImage(c, x, y - c.height);
}

function veil(g: Ctx, color: string): void {
  g.fillStyle = color;
  g.fillRect(0, 0, EPILOGUE_W, EPILOGUE_H);
}

function stars(g: Ctx, seed: number, n: number, maxY: number): void {
  for (let i = 0; i < n; i++) g.fillStyle = hash2(i, seed, 3) % 3 ? "#e8ecf2" : "#f2c14e", g.fillRect(hash2(i, seed, 1) % EPILOGUE_W, hash2(i, seed, 2) % maxY, 1, 1);
}

/** Draws the scene for `ending` into a fresh canvas of EPILOGUE_W × EPILOGUE_H. */
export function drawEpilogue(ending: Pick<EndingResult, "id" | "family">): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = EPILOGUE_W;
  c.height = EPILOGUE_H;
  const g = c.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  const id = ending.id;
  const seed = [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

  switch (ending.family) {
    case "technology": {
      ground(g, "grassland", seed);
      road(g, 5, 2, 18);
      building(g, "power_plant", 3, 3, 4);
      building(g, "lab", 3, 8, 4, 0xf2c14e);
      building(g, "factory", 3, 13, 4);
      building(g, "house", 2, 17, 4);
      for (let i = 0; i < 5; i++) person(g, i % 2 ? "engineer" : "scientist", i + 3, 60 + i * 44, 96);
      // night, relay lights across the sky
      veil(g, id.includes("accord") ? "rgba(11, 20, 55, 0.35)" : "rgba(11, 20, 55, 0.6)");
      stars(g, seed, 40, 40);
      for (let i = 0; i < 12; i++) { g.fillStyle = id.includes("dominion") ? "#c0512f" : "#6fa0d4"; g.fillRect(20 + i * 24, 18 + (hash2(i, seed, 5) % 6), 2, 2); }
      if (id.includes("divided")) { g.fillStyle = "#223052"; g.fillRect(EPILOGUE_W / 2 - 1, 0, 3, EPILOGUE_H); }
      break;
    }
    case "disease": {
      ground(g, "grassland", seed, "forest", 7);
      road(g, 5, 0, COLS);
      building(g, "clinic", 2, 8, 4);
      building(g, "house", 1, 2, 4);
      building(g, "house", 1, 5, 4);
      building(g, "house", 2, 13, 4);
      building(g, "market", 1, 16, 4, 0xc0512f);
      const cured = id.includes("cure");
      for (let i = 0; i < 6; i++) person(g, i === 2 ? "doctor" : i % 3 ? "farmer" : "merchant", i + 11, 30 + i * 46, 96, cured || i === 2 || i === 4 ? undefined : "rgba(120, 200, 120, 0.45)");
      if (id.includes("quarantine") || id.includes("famine")) { g.fillStyle = "#5a3a28"; g.fillRect(0, 5 * TILE + 2, 6, 12); g.fillRect(EPILOGUE_W - 6, 5 * TILE + 2, 6, 12); g.fillStyle = "#8a5a3a"; g.fillRect(0, 5 * TILE + 6, EPILOGUE_W, 2); }
      veil(g, cured ? "rgba(242, 193, 78, 0.12)" : "rgba(60, 90, 60, 0.35)");
      break;
    }
    case "climate": {
      const green = id.includes("green");
      ground(g, green ? "grassland" : "grassland_dry", seed, green ? "forest" : "hills_dry", 6);
      river(g, 9, !green);
      building(g, "farm", green ? 3 : 1, 2, 4);
      building(g, "farm", green ? 2 : 1, 5, 4);
      building(g, "warehouse", 2, 12, 4);
      building(g, "house", 1, 16, 4);
      if (green) for (let x = 2; x < 9; x++) { g.fillStyle = hex(PAL.river); g.fillRect(x * TILE, 3 * TILE + 7, TILE, 2); }
      for (let i = 0; i < 4; i++) person(g, "farmer", i + 21, 40 + i * 70, 96);
      veil(g, green ? "rgba(143, 209, 138, 0.12)" : "rgba(201, 162, 74, 0.25)");
      if (!green) { g.fillStyle = "rgba(255, 230, 160, 0.5)"; g.beginPath(); g.arc(280, 18, 10, 0, Math.PI * 2); g.fill(); }
      break;
    }
    case "politics": {
      ground(g, "grassland", seed, "hills", 9);
      road(g, 5, 0, COLS);
      building(g, "town_hall", 3, 2, 4, 0xf2c14e);
      building(g, "town_hall", 3, 15, 4, 0x6fa0d4);
      building(g, "market", 2, 8, 4, 0xf2c14e);
      if (id.includes("iron")) { g.fillStyle = hex(PAL.stoneDark); g.fillRect(EPILOGUE_W / 2 - 4, 2 * TILE, 8, 5 * TILE); g.fillStyle = hex(PAL.stone); g.fillRect(EPILOGUE_W / 2 - 4, 2 * TILE, 8, 3); }
      if (id.includes("merchant")) { g.drawImage(makeCaravan("food"), 120, 86); g.drawImage(makeCaravan("materials"), 200, 86); }
      if (id.includes("broken")) building(g, "ruin", 1, 11, 4);
      for (let i = 0; i < 4; i++) person(g, i === 0 ? "ruler" : i === 3 ? "official" : "soldier", i + 31, 50 + i * 60, 96);
      veil(g, id.includes("peace") || id.includes("merchant") ? "rgba(242, 193, 78, 0.1)" : "rgba(34, 48, 82, 0.35)");
      break;
    }
    case "society": {
      ground(g, "grassland", seed, "forest", 8);
      road(g, 5, 0, COLS);
      building(g, "house", 2, 1, 4);
      building(g, "market", 2, 4, 4, 0x8fd18a);
      building(g, "house", 1, 14, 4);
      building(g, "farm", 1, 17, 4);
      const exodus = id.includes("exodus");
      for (let i = 0; i < 6; i++) person(g, i % 2 ? "unemployed" : "farmer", i + 41, exodus ? 200 + i * 18 : 30 + i * 50, 96);
      if (!exodus) { g.drawImage(makeCaravan("food"), 140, 86); g.drawImage(makeCaravan("materials"), 230, 86); }
      veil(g, exodus ? "rgba(192, 81, 47, 0.2)" : "rgba(242, 193, 78, 0.1)");
      break;
    }
    case "cosmic": {
      ground(g, "grassland", seed);
      building(g, "lab", 2, 9, 4);
      veil(g, "rgba(11, 20, 55, 0.6)");
      stars(g, seed, 80, 70);
      break;
    }
    default: {
      // the unfinished age: a town at dusk, the people going home
      ground(g, "grassland", seed, "forest", 10);
      road(g, 5, 0, COLS);
      building(g, "house", 1, 1, 4);
      building(g, "house", 2, 4, 4);
      building(g, "town_hall", 1, 8, 4);
      building(g, "market", 1, 12, 4);
      building(g, "farm", 1, 16, 4);
      for (let i = 0; i < 5; i++) person(g, (["farmer", "worker", "merchant", "child", "retired"] as const)[i], i + 51, 40 + i * 56, 96);
      veil(g, "rgba(192, 81, 47, 0.12)");
    }
  }
  if (id.includes("scorched")) {
    // the scorched border: ruins and a barracks under a red sky
    ground(g, "hills_dry", seed, "forest_dry", 5);
    road(g, 5, 0, COLS);
    building(g, "ruin", 1, 3, 4);
    building(g, "ruin", 1, 7, 4);
    building(g, "barracks", 2, 12, 4, 0xc0512f);
    building(g, "house", 1, 17, 4, 0xc0512f);
    for (let i = 0; i < 4; i++) person(g, "soldier", i + 61, 60 + i * 60, 96);
    veil(g, "rgba(192, 81, 47, 0.28)");
  }
  return c;
}
