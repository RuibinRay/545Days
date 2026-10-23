/**
 * Phase 2 — needs & health (stream: health) and phase 3 — decisions (stream: citizens).
 * See docs/03 §2. One action per citizen per day; buying food/energy is a household
 * routine handled by the market phase, not an action that competes with work.
 */
import { ECON } from "../data/economy";
import { clamp, clampPct, pow2 } from "../math";
import { chance, nextFloat, pick } from "../rng";
import type { Belief, Citizen, CitizenAction, Memory, WorldState } from "../types";
import { emit } from "./context";
import type { StepContext } from "./context";
import { bedridden } from "./health";

export const MEMORY_CAP = 24;

export function needsPhase(ctx: StepContext): void {
  const { s } = ctx;
  for (const c of s.citizens) {
    if (!c.alive) continue;
    // age in whole years on each anniversary of Day 0
    if (s.day % 360 === 0) c.age++;

    // eat
    if (c.foodStock >= ECON.foodPerDay) {
      c.foodStock -= ECON.foodPerDay;
      c.needs.food = 100;
      c.hungryDays = 0;
    } else {
      c.needs.food = clampPct(c.needs.food - ECON.needDecay.food);
      c.hungryDays++;
    }
    c.needs.shelter = clampPct(c.needs.shelter - (c.home >= 0 ? ECON.needDecay.shelter : ECON.needDecay.shelterHomeless));
    c.needs.belonging = clampPct(c.needs.belonging - ECON.needDecay.belonging);
    const st = s.settlements[c.settlement];
    c.needs.safety = clampPct(100 - Math.max(st?.unrest ?? 0, st?.fear ?? 0));

    // health
    if (c.hungryDays >= 2) c.health = clampPct(c.health + ECON.healthStarving);
    else if (c.needs.food > 50) c.health = clampPct(c.health + ECON.healthRecover);

    if (c.health <= 0) { die(ctx, c, "starvation"); continue; }
    // old age: a small daily chance past sixty that grows with the years (stream: health)
    if (c.age > 60 && nextFloat(s.rng.health) < 0.00005 * (c.age - 60)) die(ctx, c, "old age", ["citizen.age"]);
  }
}

/** Kills a citizen: frees the job, grieves the relationships, emits life.death. Rulers are succeeded in civPhase. */
export function die(ctx: StepContext, c: Citizen, cause: string, causes: string[] = [cause === "starvation" ? "needs.food" : cause]): void {
  const { s } = ctx;
  c.alive = false;
  c.action = "none";
  if (c.workplace >= 0) {
    const biz = s.businesses[c.workplace];
    biz.employees = biz.employees.filter((id) => id !== c.id);
    c.workplace = -1;
  }
  ctx.deaths++;
  emit(ctx, { type: "life.death", importance: 7, citizens: [c.id], settlement: c.settlement, data: { cause, age: c.age, occupation: c.occupation }, causes });
  for (const r of c.relationships) {
    const o = s.citizens[r.other];
    if (o?.alive) remember(o, { day: s.day, tag: "life.death", valence: -40 - Math.floor(r.affinity / 4), aboutCitizen: c.id });
  }
}

// ───────────────────────── decisions ─────────────────────────

const ACTIONS: CitizenAction[] = ["work", "seek_job", "rest", "socialize", "study", "start_business"];

function belief(c: Citizen, key: string): number {
  return c.beliefs.find((b) => b.key === key)?.strength ?? 50;
}

/** U(a) = w_income·I + w_needs·N + w_social·S − w_risk·R − w_cost·C, all on 0..100 (docs/03 §2). */
function utility(s: WorldState, c: Citizen, a: CitizenAction): number | null {
  const w = c.weights;
  const employed = c.workplace >= 0 && s.businesses[c.workplace]?.alive;
  const price = s.markets[c.settlement]?.price.food ?? ECON.basePrice.food;
  const wage = employed ? s.businesses[c.workplace].wage : 0;
  const civic = c.occupation === "ruler" || c.occupation === "official";
  const working = c.occupation !== "child" && c.occupation !== "retired";
  let I = 0, N = 0, S = 0, R = 0, C = 0;
  switch (a) {
    case "work":
      if (civic) { I = 60; N = 40; S = 15; C = 10; break; } // paid by the treasury: governing is their work
      if (!employed) return null;
      I = clamp(wage / 12, 0, 100);
      N = 45;
      S = 15;
      C = 10;
      break;
    case "seek_job":
      if (!working || civic) return null;
      // content with the current job unless it pays badly or has started missing payroll
      if (employed && wage >= Math.round(price * 1.2) && s.businesses[c.workplace].insolventDays < 3) return null;
      I = employed ? 40 : 70;
      N = 10;
      R = 10;
      C = 20;
      break;
    case "rest":
      N = 30 + (100 - c.needs.shelter) / 2;
      S = 5;
      break;
    case "socialize":
      S = 20 + (100 - c.needs.belonging);
      N = 10;
      C = 5;
      break;
    case "study":
      if (!working) return null;
      I = 25 + (c.goal === "research" || c.goal === "get_promoted" ? 15 : 0);
      C = 15;
      break;
    case "start_business": {
      if (!working || civic || c.wealth < ECON.startupCostCents) return null;
      // an opportunity exists when some good sells well above its base price
      const m = s.markets[c.settlement];
      const ratio = Math.max(m.price.food / ECON.basePrice.food, m.price.materials / ECON.basePrice.materials);
      if (ratio < 1.3 && c.goal !== "start_business") return null;
      I = clamp(70 + 30 * (ratio - 1), 0, 100);
      R = 40 * (1 + belief(c, "business_is_risky") / 100);
      C = 30;
      break;
    }
  }
  const g = c.goal;
  let bias = 0;
  if ((g === "save" && a === "work") || (g === "research" && a === "study") || (g === "lead" && a === "socialize")) bias = 15;
  if (a === "work" && belief(c, "work_pays") > 60) bias += 5;
  return (w.income * I + w.needs * N + w.social * S - w.risk * R - w.cost * C) / 100 + bias;
}

export function decidePhase(ctx: StepContext): void {
  const { s } = ctx;
  const rng = s.rng.citizens;
  for (const c of s.citizens) {
    if (!c.alive) continue;
    if (bedridden(c)) {
      c.action = "rest"; // the sick stay home
      applyAction(ctx, c);
      continue;
    }
    if (c.occupation === "child" || c.occupation === "retired") {
      c.action = chance(rng, 0.5) ? "socialize" : "rest";
      applyAction(ctx, c);
      continue;
    }
    const T = c.traits.includes("curious") || c.traits.includes("rebellious") ? ECON.temperatureCurious : ECON.temperature;
    const scored: { a: CitizenAction; w: number }[] = [];
    let max = -Infinity;
    for (const a of ACTIONS) {
      const u = utility(s, c, a);
      if (u === null) continue;
      scored.push({ a, w: u });
      if (u > max) max = u;
    }
    let total = 0;
    for (const e of scored) {
      e.w = pow2((e.w - max) / T); // softmax, shifted so the best action has weight 1
      total += e.w;
    }
    let r = nextFloat(rng) * total;
    let choice = scored[scored.length - 1].a;
    for (const e of scored) {
      r -= e.w;
      if (r <= 0) {
        choice = e.a;
        break;
      }
    }
    c.action = choice;
    applyAction(ctx, c);
  }
}

function applyAction(ctx: StepContext, c: Citizen): void {
  const { s } = ctx;
  const rng = s.rng.citizens;
  switch (c.action) {
    case "work":
      c.needs.belonging = clampPct(c.needs.belonging + 4); // colleagues count as company
      if (c.occupation === "soldier" && (s.day + c.id) % 5 === 0) c.skills.combat = clampPct(c.skills.combat + 1); // drill
      break;
    case "seek_job":
      ctx.jobSeekers.push(c.id);
      forage(s, c);
      break;
    case "start_business":
      ctx.founders.push(c.id);
      break;
    case "rest":
      c.needs.shelter = clampPct(c.needs.shelter + 10);
      c.health = clampPct(c.health + 1);
      forage(s, c);
      break;
    case "socialize": {
      c.needs.belonging = clampPct(c.needs.belonging + 40);
      const alive = s.citizens.filter((o) => o.alive && o.id !== c.id && o.settlement === c.settlement);
      if (alive.length === 0) break;
      const existing = c.relationships.length > 0 && chance(rng, 0.7) ? s.citizens[pick(rng, c.relationships).other] : pick(rng, alive);
      if (!existing?.alive) break;
      const rel = c.relationships.find((r) => r.other === existing.id);
      if (rel) rel.affinity = clamp(rel.affinity + 5, -100, 100);
      else c.relationships.push({ other: existing.id, affinity: 5, kind: "friend" });
      const back = existing.relationships.find((r) => r.other === c.id);
      if (back) back.affinity = clamp(back.affinity + 3, -100, 100);
      else existing.relationships.push({ other: c.id, affinity: 3, kind: "friend" });
      existing.needs.belonging = clampPct(existing.needs.belonging + 8);
      break;
    }
    case "study": {
      const key = c.workplace >= 0 ? skillFor(s.businesses[c.workplace].kind) : "trade";
      c.skills[key] = clampPct(c.skills[key] + 1);
      break;
    }
    default:
      break;
  }
}

/**
 * An adult with no job gathers half a unit of food a day from the commons: slow hunger, not death, when
 * welfare fails. In a drought the commons dry up too and yield a quarter of that (M7).
 */
function forage(s: WorldState, c: Citizen): void {
  if (c.occupation !== "unemployed") return;
  const every = s.climate.droughtDays > 0 ? 8 : 2;
  if ((s.day + c.id) % every === 0) c.foodStock += 1;
}

export function skillFor(kind: string): keyof Citizen["skills"] {
  switch (kind) {
    case "farm": return "farming";
    case "workshop": case "factory": case "power_plant": return "craft";
    case "lab": return "science";
    case "clinic": return "care";
    case "barracks": return "combat";
    default: return "trade";
  }
}

// ───────────────────────── memories → beliefs ─────────────────────────

export function remember(c: Citizen, m: Memory): void {
  c.memories.push(m);
  if (c.memories.length > MEMORY_CAP) {
    // drop the weakest old memory first
    let idx = 0;
    let weakest = Infinity;
    for (let i = 0; i < c.memories.length - 1; i++) {
      const v = Math.abs(c.memories[i].valence);
      if (v < weakest) {
        weakest = v;
        idx = i;
      }
    }
    c.memories.splice(idx, 1);
  }
}

export function shiftBelief(c: Citizen, key: string, delta: number): void {
  const b: Belief | undefined = c.beliefs.find((x) => x.key === key);
  if (b) b.strength = clampPct(b.strength + delta);
  else c.beliefs.push({ key, strength: clampPct(50 + delta) });
}

/** Phase 2b (run after the economy): today's memories become belief shifts; beliefs decay toward 50. */
export function beliefPhase(ctx: StepContext): void {
  const { s } = ctx;
  for (const c of s.citizens) {
    if (!c.alive) continue;
    for (const m of c.memories) {
      if (m.day !== s.day) continue;
      switch (m.tag) {
        case "econ.business_closed": shiftBelief(c, "business_is_risky", m.aboutCitizen === c.id ? 15 : 8); break;
        case "econ.business_opened": shiftBelief(c, "business_is_risky", -5); break;
        case "econ.wage_cut": shiftBelief(c, "work_pays", -10); break;
        case "econ.laid_off": shiftBelief(c, "work_pays", -15); shiftBelief(c, "business_is_risky", 10); break;
        case "econ.food_unavailable": shiftBelief(c, "food_is_scarce", 12); break;
        case "econ.price_spike": shiftBelief(c, "food_is_scarce", 6); break;
        case "life.death": shiftBelief(c, "food_is_scarce", 5); break;
        case "war.raid": shiftBelief(c, "world_is_dangerous", 15); shiftBelief(c, "government_is_fair", -5); break;
        case "civ.disappearance": shiftBelief(c, "world_is_dangerous", 10); break;
        case "civ.succession": shiftBelief(c, "government_is_fair", m.valence > 0 ? 5 : -10); break;
        default: break;
      }
    }
    for (const b of c.beliefs) b.strength += b.strength > 50 ? -1 : b.strength < 50 ? 1 : 0;
  }
}
