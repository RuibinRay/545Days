import type { RngState, TerrainLayer, WorldSettings } from "../types";
import { BIOME_INDEX, RESOURCE_INDEX } from "../types";
import { nextInt } from "../rng";
import { fbm, hash2 } from "./noise";

const B = {
  ocean: BIOME_INDEX.indexOf("ocean"),
  coast: BIOME_INDEX.indexOf("coast"),
  grassland: BIOME_INDEX.indexOf("grassland"),
  forest: BIOME_INDEX.indexOf("forest"),
  hills: BIOME_INDEX.indexOf("hills"),
  mountain: BIOME_INDEX.indexOf("mountain"),
  desert: BIOME_INDEX.indexOf("desert"),
} as const;

const R = {
  none: RESOURCE_INDEX.indexOf("none"),
  fertile: RESOURCE_INDEX.indexOf("fertile"),
  ore: RESOURCE_INDEX.indexOf("ore"),
  coal: RESOURCE_INDEX.indexOf("coal"),
  aquifer: RESOURCE_INDEX.indexOf("aquifer"),
} as const;

export const BIOME = B;
export const RESOURCE = R;

/** Rivers are 4-connected so a 16-tile autotile set can draw them without diagonal gaps. */
const CARDINAL: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const SHAPE = {
  continent: { landShare: 0.55, falloffStart: 0.55, falloffGain: 1.4, freq: 1 / 28, octaves: 5 },
  archipelago: { landShare: 0.4, falloffStart: 0.8, falloffGain: 3.0, freq: 1 / 9, octaves: 4 },
  islands: { landShare: 0.32, falloffStart: 0.8, falloffGain: 3.0, freq: 1 / 8, octaves: 4 },
} as const;

export function generateTerrain(
  width: number,
  height: number,
  seed: number,
  settings: WorldSettings,
  rng: RngState,
): TerrainLayer {
  const n = width * height;
  const shape = SHAPE[settings.terrain];
  const raw = new Float64Array(n);
  const cx = width / 2;
  const cy = height / 2;
  const rad = Math.min(cx, cy);

  // 1. elevation field with radial falloff so the map always has an ocean rim
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const e = fbm(x, y, seed, shape.octaves, shape.freq);
      const dx = (x - cx) / rad;
      const dy = (y - cy) / rad;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const fall = Math.max(0, dist - shape.falloffStart) * shape.falloffGain;
      raw[y * width + x] = e - fall;
    }
  }

  // 2. sea level by quantile so land share is predictable regardless of seed
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const sea = sorted[Math.floor(n * (1 - shape.landShare))];
  const top = sorted[n - 1];
  const elevation = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = raw[i] <= sea ? (raw[i] - sorted[0]) / Math.max(1e-9, sea - sorted[0]) * 0.4 : 0.4 + ((raw[i] - sea) / Math.max(1e-9, top - sea)) * 0.6;
    elevation[i] = Math.max(0, Math.min(255, Math.floor(v * 255)));
  }
  const SEA = 102; // 0.4 * 255

  // 3. moisture field
  const moisture = new Uint8Array(n);
  const climateMul = settings.climate === "dry" ? 0.6 : settings.climate === "mixed" ? 1 : 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = fbm(x + 100, y + 100, seed ^ 0x5151, 4, 1 / 18);
      if (settings.climate === "mixed") m = m * 0.6 + (x / width) * 0.4; // west dry → east wet
      moisture[y * width + x] = Math.max(0, Math.min(255, Math.floor(m * climateMul * 255)));
    }
  }

  // 4. biomes — mountain/hill thresholds are land-elevation quantiles so every map
  //    gets ~10 % mountains and ~18 % hills instead of whatever the noise happened to give
  const landElev: number[] = [];
  for (let i = 0; i < n; i++) if (elevation[i] > SEA) landElev.push(elevation[i]);
  landElev.sort((a, b) => a - b);
  const mountainAt = landElev[Math.floor(landElev.length * 0.9)] ?? 255;
  const hillAt = landElev[Math.floor(landElev.length * 0.72)] ?? 255;
  const biome = new Uint8Array(n);
  const isOcean = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && elevation[y * width + x] <= SEA;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (elevation[i] <= SEA) {
        biome[i] = B.ocean;
        continue;
      }
      if (isOcean(x - 1, y) || isOcean(x + 1, y) || isOcean(x, y - 1) || isOcean(x, y + 1)) biome[i] = B.coast;
      else if (elevation[i] >= mountainAt) biome[i] = B.mountain;
      else if (elevation[i] >= hillAt) biome[i] = B.hills;
      else if (moisture[i] < 80) biome[i] = B.desert;
      else if (moisture[i] > 165) biome[i] = B.forest;
      else biome[i] = B.grassland;
    }
  }

  // 5. rivers: from hill/mountain sources, always toward the sea.
  //    Each step must reduce BFS distance-to-ocean (so a river cannot strand itself in a
  //    basin), choosing the lowest such neighbour (so it still follows the valleys).
  const dist = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (biome[i] === B.ocean) { dist[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const x = c % width;
    const y = (c - x) / width;
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (dist[j] === -1) { dist[j] = dist[c] + 1; queue.push(j); }
    }
  }
  const river = new Uint8Array(n);
  const sources: number[] = [];
  for (let i = 0; i < n; i++) if ((biome[i] === B.hills || biome[i] === B.mountain) && dist[i] >= 12) sources.push(i);
  const riverCount = Math.max(1, Math.round((width * height) / 2304)); // 4 on 96×96
  for (let r = 0; r < riverCount && sources.length > 0; r++) {
    // keep sources apart so rivers don't merge at birth: up to 12 tries for a tile ≥ 14 from any river
    let cur = sources[nextInt(rng, 0, sources.length - 1)];
    for (let tries = 0; tries < 12; tries++) {
      const sx = cur % width;
      const sy = (cur - sx) / width;
      let clear = true;
      for (let i = 0; i < n && clear; i++) {
        if (!river[i]) continue;
        const rx = i % width;
        const ry = (i - rx) / width;
        if (Math.abs(rx - sx) < 14 && Math.abs(ry - sy) < 14) clear = false;
      }
      if (clear) break;
      cur = sources[nextInt(rng, 0, sources.length - 1)];
    }
    for (let steps = 0; steps < 1000; steps++) {
      if (biome[cur] === B.ocean) break;
      river[cur] = 1;
      const x = cur % width;
      const y = (cur - x) / width;
      let best = -1;
      let bestKey = Infinity;
      // Pass 1: wander — any non-river neighbour that does not move away from the sea,
      // lowest (elevation, distance) first, so the river follows valleys.
      // Pass 2 (fallback when boxed in): force a strictly seaward step, merging if needed.
      for (let pass = 0; pass < 2 && best < 0; pass++) {
        for (const [dx, dy] of CARDINAL) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (pass === 0 && (river[j] || dist[j] > dist[cur])) continue;
          if (pass === 1 && dist[j] >= dist[cur]) continue;
          const key = elevation[j] * 3 + (dist[j] - dist[cur] + 1) * 12 + (hash2(nx, ny, seed ^ 0x1e5) % 9);
          if (key < bestKey) { bestKey = key; best = j; }
        }
      }
      if (best < 0) break;
      if (river[best]) { break; } // merged into an existing river
      cur = best;
    }
  }

  // 6. river/coast moisture bonus and resources
  const nearRiver = (x: number, y: number, d: number) => {
    for (let dy = -d; dy <= d; dy++)
      for (let dx = -d; dx <= d; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (river[ny * width + nx]) return true;
      }
    return false;
  };
  const resource = new Uint8Array(n);
  const riverNear = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (biome[i] === B.ocean) continue;
      if (nearRiver(x, y, 2)) {
        moisture[i] = Math.min(255, moisture[i] + 60);
        riverNear[i] = 1;
      }
      if (biome[i] === B.coast) moisture[i] = Math.min(255, moisture[i] + 20);
      const h = hash2(x, y, seed ^ 0x7777);
      if (river[i]) continue;
      if ((biome[i] === B.grassland || biome[i] === B.forest) && moisture[i] > 140 && nearRiver(x, y, 2) && h % 3 === 0) resource[i] = R.fertile;
      else if ((biome[i] === B.hills || biome[i] === B.mountain) && h % 9 === 0) resource[i] = R.ore;
      else if (biome[i] === B.hills && h % 11 === 0) resource[i] = R.coal;
      else if (biome[i] === B.desert && h % 17 === 0) resource[i] = R.aquifer;
    }
  }

  return { width, height, biome, elevation, moisture, baseMoisture: moisture.slice(), resource, river, riverNear, owner: new Uint16Array(n) };
}
