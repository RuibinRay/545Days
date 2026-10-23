/** Phase 1 — environment (docs/03 §1). RNG stream: weather (unused until seasonal rain lands). */
import { BIOME } from "../worldgen/terrain";
import { clamp } from "../math";
import { emit } from "./context";
import type { StepContext } from "./context";

export function environmentPhase(ctx: StepContext): void {
  const { s } = ctx;
  const t = s.terrain;
  s.climate.season = (Math.floor((s.day % 360) / 90) & 3) as 0 | 1 | 2 | 3;

  const drought = s.climate.droughtDays > 0;
  if (drought) {
    s.climate.droughtDays--;
    if (s.climate.droughtDays === 0) emit(ctx, { type: "env.drought_ends", importance: 4, causes: ["env.drought_begins"] });
  }

  // moisture: drought dries non-river tiles; otherwise recover toward the per-tile base
  const n = t.width * t.height;
  const recover = Math.max(1, Math.round(s.climate.rainfall / 50));
  for (let i = 0; i < n; i++) {
    if (t.biome[i] === BIOME.ocean) continue;
    const m = t.moisture[i];
    if (drought) {
      // river-fed land dries slowly (3/day); everything else dries 8 points a day
      t.moisture[i] = Math.max(0, m - (t.riverNear[i] ? 3 : 8));
    } else if (m < t.baseMoisture[i]) {
      t.moisture[i] = Math.min(t.baseMoisture[i], m + (t.riverNear[i] ? 4 : recover * 2));
    }
  }

  // pollution: +1 per operating factory or power plant, −2 natural decay
  let sources = 0;
  for (const b of s.businesses) if (b.alive && (b.kind === "factory" || b.kind === "power_plant") && b.employees.length > 0) sources++;
  s.climate.pollution = clamp(s.climate.pollution + sources - 2, 0, 100);
}

