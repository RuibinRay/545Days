/**
 * Phase 2a — disease (docs/07 #07 Red Plague). RNG stream: health.
 *
 * States: none → incubating (5 days) → sick (12 days) → recovered (immune) or dead.
 * Transmission: each day a susceptible citizen catches it with probability
 *   0.03 × (sick people who shared a building with them today) × (1 − clinic coverage) × crowding
 * where "shared a building" means home, workplace or the market they visited (from itineraries),
 * crowding is residents / capacity at home, and coverage = treated sick / sick. Between towns the
 * disease travels with merchants: a town with sick merchants infects one person a day in each
 * neighbour it is not quarantined from, with probability 0.05 per incubating merchant; caravans (trade.ts) carry it too.
 * Death at the end of the sick phase: 0.08 + (100 − health) / 500 − 0.06 × treated, halved after a cure.
 * The sick do not work (economy.ts reads `action`), which is the economic coupling.
 */
import { clampPct } from "../math";
import { nextFloat, nextInt } from "../rng";
import type { Citizen, Civilization, WorldState } from "../types";
import { die, remember } from "./citizens";
import { emit } from "./context";
import type { StepContext } from "./context";

export const PLAGUE = {
  incubationDays: 7,
  sickDays: 14,
  contactRate: 0.01,
  travelRate: 0.05,
  baseDeath: 0.22,
  treatedDeathCut: 0.1,
  /** A doctor can look after this many plague patients a day (more than clinic walk-ins: it is triage, not treatment). */
  patientsPerDoctor: 10,
} as const;

/** Working doctors × patients per doctor, per settlement. */
function clinicSlots(s: WorldState, settlement: number): number {
  let slots = 0;
  for (const b of s.businesses) {
    if (!b.alive || b.kind !== "clinic" || b.settlement !== settlement) continue;
    for (const id of b.employees) if (s.citizens[id].alive && s.citizens[id].action !== "rest") slots += PLAGUE.patientsPerDoctor;
  }
  return slots;
}

export function cured(s: WorldState, civ: Civilization): boolean {
  return s.story.fired.some((f) => f.id === `rp.cure@${civ.id}`);
}

/** Puts one citizen at the start of the incubation period. Returns false if immune or already infected. */
export function infect(s: WorldState, c: Citizen): boolean {
  if (!c.alive || c.infection !== "none") return false;
  c.infection = "incubating";
  c.infectionDay = s.day;
  return true;
}

export function healthPhase(ctx: StepContext): void {
  const { s } = ctx;
  const rng = s.rng.health;
  const anyInfected = s.citizens.some((c) => c.alive && c.infection !== "none" && c.infection !== "recovered");
  if (!anyInfected) return;

  // who is sick where, and who shared a building with them yesterday
  const sickByBuilding = new Map<number, number>();
  const sickBySettlement = new Map<number, number>();
  const sickMerchants = new Map<number, number>();
  // the sick (at home, weight 1) and the incubating (still out and about, weight ½) both pass it on
  for (const c of s.citizens) {
    if (!c.alive || (c.infection !== "sick" && c.infection !== "incubating")) continue;
    const w = c.infection === "sick" ? 1 : 0.5;
    if (c.infection === "sick") sickBySettlement.set(c.settlement, (sickBySettlement.get(c.settlement) ?? 0) + 1);
    if (c.occupation === "merchant" && c.infection === "incubating") sickMerchants.set(c.settlement, (sickMerchants.get(c.settlement) ?? 0) + 1);
    for (const b of new Set(c.itinerary.filter((x) => x >= 0))) sickByBuilding.set(b, (sickByBuilding.get(b) ?? 0) + w);
  }
  const coverage = new Map<number, number>();
  for (const [st, sick] of sickBySettlement) coverage.set(st, sick > 0 ? Math.min(1, clinicSlots(s, st) / sick) : 1);
  const residents = new Map<number, number>();
  for (const c of s.citizens) if (c.alive && c.home >= 0) residents.set(c.home, (residents.get(c.home) ?? 0) + 1);

  // progression and death
  for (const c of s.citizens) {
    if (!c.alive) continue;
    if (c.infection === "incubating" && s.day - c.infectionDay >= PLAGUE.incubationDays) {
      c.infection = "sick";
      c.infectionDay = s.day;
      remember(c, { day: s.day, tag: "health.fell_ill", valence: -30 });
    } else if (c.infection === "sick" && s.day - c.infectionDay >= PLAGUE.sickDays) {
      const civ = s.civs[s.settlements[c.settlement].civ];
      const treated = coverage.get(c.settlement) ?? 0;
      let p = PLAGUE.baseDeath + (100 - c.health) / 400 - PLAGUE.treatedDeathCut * treated;
      if (cured(s, civ)) p /= 2;
      if (nextFloat(rng) < Math.max(0.01, p)) {
        die(ctx, c, "plague", ["health.outbreak"]);
        continue;
      }
      c.infection = "recovered";
      c.infectionDay = s.day;
      c.health = clampPct(c.health - 10);
    }
    if (c.infection === "sick") c.health = clampPct(c.health - 1);
  }

  // transmission inside towns
  for (const c of s.citizens) {
    if (!c.alive || c.infection !== "none") continue;
    // a person meets a handful of people in any one place, however crowded it is
    let contacts = 0;
    for (const b of new Set(c.itinerary.filter((x) => x >= 0))) contacts += Math.min(3, sickByBuilding.get(b) ?? 0);
    if (contacts === 0) continue;
    const civ = s.civs[s.settlements[c.settlement].civ];
    const home = s.buildings[c.home];
    const crowding = home && home.capacity > 0 ? Math.max(0.5, (residents.get(c.home) ?? 1) / home.capacity) : 1;
    let p = PLAGUE.contactRate * contacts * (1 - (coverage.get(c.settlement) ?? 0) * 0.5) * crowding;
    if (cured(s, civ)) p /= 2;
    if (nextFloat(rng) < Math.min(0.4, p)) infect(s, c);
  }

  // transmission between towns: merchants carry it, unless either side is quarantined or at war
  for (const [fromSt, merchants] of sickMerchants) {
    const fromCiv = s.civs[s.settlements[fromSt].civ];
    if (fromCiv.policies.quarantine >= 100) continue;
    for (const st of s.settlements) {
      if (!st.alive || st.id === fromSt) continue;
      const toCiv = s.civs[st.civ];
      if (toCiv.policies.quarantine >= 100 || (toCiv.id !== fromCiv.id && (toCiv.id in fromCiv.wars))) continue;
      if (nextFloat(rng) >= PLAGUE.travelRate * merchants) continue;
      const people = s.citizens.filter((c) => c.alive && c.settlement === st.id && c.infection === "none");
      if (people.length === 0) continue;
      const victim = people[nextInt(rng, 0, people.length - 1)];
      if (infect(s, victim)) emit(ctx, { type: "health.carried", importance: 4, settlement: st.id, civ: toCiv.id, citizens: [victim.id], data: { from: s.settlements[fromSt].name }, causes: ["health.outbreak", "trade.contact"] });
    }
  }
}

/** Sick people stay home; called from the decision phase. */
export function bedridden(c: Citizen): boolean {
  return c.infection === "sick";
}
