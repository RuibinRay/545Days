/**
 * Phase 4b — research (M4). Labs turn their scientists' skill into points for the civ's
 * `researchFocus`; points buy tech levels at a rising cost. Tech feeds back into output
 * (economy.ts techFactor), medicine (needs/clinics), military strength (war.ts) and the
 * machine-autonomy risk that the technology endings read. No RNG: research is deterministic
 * given who worked.
 */
import { CIV } from "../data/economy";
import { clampPct } from "../math";
import type { Civilization, ResearchField, WorldState } from "../types";
import { emit } from "./context";
import type { StepContext } from "./context";

export const RESEARCH_FIELDS: ResearchField[] = ["agriculture", "industry", "medicine", "automation", "military"];

/** Points a civ's labs produce today. */
export function researchOutput(s: WorldState, civ: Civilization): number {
  let points = 0;
  for (const b of s.businesses) {
    if (!b.alive || b.kind !== "lab" || !civ.settlements.includes(b.settlement)) continue;
    const tier = s.buildings[b.building].tier;
    let skill = 0;
    for (const id of b.employees) {
      const c = s.citizens[id];
      if (c.alive && c.action === "work") skill += c.skills.science;
    }
    // a lab with no energy runs cold
    const powered = b.inventory.energy > 0 ? 1 : 0.5;
    points += Math.floor((skill / CIV.researchDivisor) * (1 + 0.25 * (tier - 1)) * powered);
  }
  // oversight slows automation work specifically (reviews, audits)
  if (civ.researchFocus === "automation") points = Math.floor(points * (1 - civ.policies.oversight / 200));
  return points;
}

export function researchPhase(ctx: StepContext): void {
  const { s } = ctx;
  for (const civ of s.civs) {
    if (!civ.alive) continue;
    const points = researchOutput(s, civ);
    civ.researchPool += points;
    const field = civ.researchFocus;
    let cost = CIV.researchLevelBase + civ.tech[field];
    while (civ.researchPool >= cost && civ.tech[field] < 100) {
      civ.researchPool -= cost;
      civ.tech[field] = clampPct(civ.tech[field] + 1);
      cost = CIV.researchLevelBase + civ.tech[field];
      if (civ.tech[field] % 10 === 0) {
        emit(ctx, { type: "research.level", importance: 5, civ: civ.id, data: { field, level: civ.tech[field] }, causes: ["lab.output", "civ.researchFocus"] });
      }
    }

    // automation beyond 50 reaches the factory floor: machines replace people, and the risk grows
    if (civ.tech.automation >= 50) {
      const target = Math.min(80, (civ.tech.automation - 50) * 2);
      for (const b of s.businesses) {
        if (!b.alive || !civ.settlements.includes(b.settlement) || (b.kind !== "factory" && b.kind !== "workshop")) continue;
        if (b.automation < target && s.day % 10 === b.id % 10) {
          b.automation = clampPct(Math.min(target, b.automation + 10));
          // every 25 points of automation removes one post
          const tpl = Math.max(1, b.staffTarget - Math.floor(b.automation / 25));
          if (tpl < b.staffTarget) {
            b.staffTarget = tpl;
            emit(ctx, { type: "econ.automated", importance: 5, businesses: [b.id], settlement: b.settlement, civ: civ.id, data: { automation: b.automation, staffTarget: b.staffTarget }, causes: ["research.level", "civ.tech.automation"] });
          }
        }
      }
      if (s.day % 10 === 0) {
        const growth = (civ.tech.automation - 45) / 5 - civ.policies.oversight / 25;
        const before = civ.tech.machineAutonomyRisk;
        civ.tech.machineAutonomyRisk = clampPct(civ.tech.machineAutonomyRisk + growth);
        if (before < 85 && civ.tech.machineAutonomyRisk >= 85)
          emit(ctx, { type: "research.loss_of_control", importance: 9, civ: civ.id, data: { risk: civ.tech.machineAutonomyRisk, automation: civ.tech.automation, oversight: civ.policies.oversight }, causes: ["civ.tech.automation", "policy.oversight"] });
      }
    } else if (civ.tech.machineAutonomyRisk > 0 && s.day % 10 === 0) {
      civ.tech.machineAutonomyRisk = clampPct(civ.tech.machineAutonomyRisk - 1);
    }
  }
}

/** The ruler's research choice, re-evaluated every 30 days from the civ's situation. */
export function chooseFocus(s: WorldState, civ: Civilization): ResearchField {
  const atWar = Object.keys(civ.wars).length > 0;
  if (atWar && civ.tech.military < 90) return "military";
  let hungry = false;
  let sick = false;
  let plague = 0;
  for (const c of s.citizens) if (c.alive && civ.settlements.includes(c.settlement) && (c.infection === "sick" || c.infection === "incubating")) plague++;
  if (plague >= 3 && civ.tech.medicine < 90) return "medicine";
  for (const stId of civ.settlements) {
    const m = s.markets[stId];
    if (m && m.price.food >= 450) hungry = true;
    const st = s.settlements[stId];
    let h = 0;
    let n = 0;
    for (const c of s.citizens) if (c.alive && c.settlement === st.id) { h += c.health; n++; }
    if (n && h / n < 60) sick = true;
  }
  if (hungry && civ.tech.agriculture < 90) return "agriculture";
  if (sick && civ.tech.medicine < 90) return "medicine";
  switch (civ.disposition) {
    case "agrarian": return civ.tech.agriculture < 80 ? "agriculture" : "medicine";
    case "scholarly": return civ.tech.automation < 90 ? "automation" : "industry";
    case "martial": return civ.tech.military < 80 ? "military" : "industry";
  }
}
