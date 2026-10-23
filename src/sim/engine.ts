import type { DailyMetrics, Intervention, InterventionSpec, LedgerEntry, Mission, Policies, WorldEvent, WorldState } from "./types";
import { STORY_ECON } from "./types";
import { logRecent, storyPhase } from "./story/scheduler";
import { computeMetrics } from "./metrics";
import { Ledger, treasury as trRef } from "./ledger";
import type { StepContext } from "./systems/context";
import { emit } from "./systems/context";
import { environmentPhase } from "./systems/environment";
import { healthPhase } from "./systems/health";
import { migrationPhase } from "./systems/migration";
import { beliefPhase, decidePhase, die, needsPhase, remember, shiftBelief } from "./systems/citizens";
import { buildingSite, economyPhase, founding } from "./systems/economy";
import { civPhase } from "./systems/civ";
import { researchPhase } from "./systems/research";
import { rulerPhase, succession } from "./systems/ruler";
import { makePeace, ruinBuilding, warPhase } from "./systems/war";
import { missionsPhase, resolveMission } from "./systems/missions";
import { expansionPhase, foundColony, relocateHousehold, societyPhase } from "./systems/society";
import { tradePhase } from "./systems/trade";
import { checkInvariants } from "./invariants";
import { resolveEnding } from "./story/endings";
import type { EndingResult } from "./story/endings";
import { BUILD_COST } from "./data/buildings";
import { CIV } from "./data/economy";
import { clamp, clampPct } from "./math";

export interface StepResult {
  events: WorldEvent[];
  metrics: DailyMetrics;
  ledger: LedgerEntry[];
}

export const DAYS = 545;

export interface StepOptions {
  /** Run invariant checks after the step and throw on violation (tests, dev builds). */
  strict?: boolean;
}

/**
 * Advances the world by one day, in place (docs/03 phase order, "M4 as built"):
 * 0 interventions · 1 environment · 2 needs · 2a health · 2c migration · 2d society · 3 decide · 4 economy ·
 * 4c trade · 4b research · 5 civ · 5a ruler · 5b war · 5c colonies · 6 missions & procedural events · 6b story ·
 * 2b beliefs · 7 metrics · 8 terminal checks.
 */
export function step(state: WorldState, interventions: Intervention[] = [], opts: StepOptions = {}): StepResult {
  state.day += 1;
  const ctx: StepContext = {
    s: state,
    day: state.day,
    ledger: new Ledger(state, state.day),
    events: [],
    jobSeekers: [],
    founders: [],
    visitedMarket: new Set(),
    produced: new Map(),
    wagesPaid: 0,
    deaths: 0,
    births: 0,
    tradeArrived: 0,
    marching: new Set(),
  };

  // phase 0 — interventions
  for (const iv of interventions) applyIntervention(ctx, iv);

  environmentPhase(ctx);   // 1
  needsPhase(ctx);         // 2
  healthPhase(ctx);        // 2a: disease
  migrationPhase(ctx);     // 2c: the hungry leave
  societyPhase(ctx);       // 2d: households, births, coming of age
  decidePhase(ctx);        // 3
  economyPhase(ctx);       // 4
  tradePhase(ctx);         // 4c: caravans between towns
  researchPhase(ctx);      // 4b
  civPhase(ctx);           // 5
  rulerPhase(ctx);         // 5a
  warPhase(ctx);           // 5b
  expansionPhase(ctx);     // 5c: colonies
  missionsPhase(ctx);      // 6
  storyPhase(ctx);         // 6b: story chains
  // 6c: Influence regenerates (one point every other day; the cap is 30)
  if (state.day % STORY_ECON.influenceEveryDays === 0) state.story.influence = Math.min(STORY_ECON.influenceCap, state.story.influence + STORY_ECON.influenceRegen);
  beliefPhase(ctx);        // 2b: tonight's memories become beliefs

  const metrics = computeMetrics(state, { wagesPaid: ctx.wagesPaid, deaths: ctx.deaths, births: ctx.births, trade: ctx.tradeArrived, produced: ctx.produced }); // 7

  // 8 — terminal checks: the resolver (story/endings.ts) runs on these events in the Worker / run()
  if (metrics.population === 0 && ctx.deaths > 0) emit(ctx, { type: "story.extinction", importance: 10, data: { day: state.day }, causes: ["life.death"] });
  if (state.day === DAYS) emit(ctx, { type: "story.countdown_end", importance: 10, data: { day: state.day }, causes: [] });
  logRecent(state, ctx.events);
  if (opts.strict) {
    const bad = checkInvariants(state);
    if (bad.length) throw new Error(`invariants violated on day ${state.day}:\n${bad.slice(0, 10).join("\n")}`);
  }
  return { events: ctx.events, metrics, ledger: ctx.ledger.entries };
}

/** Influence a spec costs; a mission costs the sum of its effects. */
export function interventionCost(spec: InterventionSpec | Intervention, missions?: Mission[]): number {
  if (spec.type === "mission") {
    if (!spec.accept) return 0;
    const m = missions?.[spec.mission];
    return m ? m.effects.reduce((a, e) => a + (STORY_ECON.cost[e.type] ?? 0), 0) : 0;
  }
  return STORY_ECON.cost[spec.type] ?? 0;
}

const POLICY_RANGE: Record<keyof Policies, [number, number]> = {
  taxRate: [0, 60], researchBudget: [0, 50000], oversight: [0, 100], foodReserveDays: [0, 90], healthBudget: [0, 50000],
  welfare: [0, 5000], pension: [0, 5000], officialWage: [0, 10000], militaryBudget: [0, 50000], quarantine: [0, 100], borders: [0, 100], exportBan: [0, 100],
};

/** Phase 0. Every implemented intervention is recorded in `story.interventions` and emits a `player.*`-caused event. */
export function applyIntervention(ctx: StepContext, iv: Intervention, charge = true): void {
  const { s } = ctx;
  if (charge) {
    const cost = interventionCost(iv, s.story.missions);
    if (cost > s.story.influence) throw new Error(`not enough Influence: ${iv.type} costs ${cost}, you have ${s.story.influence}`);
    s.story.influence -= cost;
  }
  switch (iv.type) {
    case "disaster": {
      if (iv.kind !== "drought") throw new Error(`disaster ${iv.kind} is not implemented yet`);
      s.climate.droughtDays = Math.max(s.climate.droughtDays, Math.round(20 + iv.intensity));
      emit(ctx, { type: "env.drought_begins", importance: 6, settlement: iv.settlement, data: { days: s.climate.droughtDays, intensity: iv.intensity }, causes: ["player.disaster"] });
      break;
    }
    case "remove_citizen": {
      const c = s.citizens[iv.citizen];
      if (!c?.alive) throw new Error(`citizen ${iv.citizen} is not alive`);
      const civ = s.civs[s.settlements[c.settlement].civ];
      const prominent = c.occupation === "ruler" || c.occupation === "official" || c.occupation === "scientist";
      const was = c.occupation;
      die(ctx, c, "disappeared", ["player.remove_citizen"]);
      if (prominent) civ.legitimacy = clampPct(civ.legitimacy - 5);
      // colleagues lose faith in the place they work
      if (c.workplace < 0) for (const o of s.citizens) if (o.alive && o.settlement === c.settlement && o.relationships.some((r) => r.other === c.id)) remember(o, { day: s.day, tag: "civ.disappearance", valence: -30, aboutCitizen: c.id });
      emit(ctx, { type: "civ.disappearance", importance: 7, civ: civ.id, settlement: c.settlement, citizens: [c.id], data: { name: c.name, occupation: was }, causes: ["player.remove_citizen"] });
      if (was === "ruler") succession(ctx, civ, "civ.disappearance");
      break;
    }
    case "destroy_building": {
      const b = s.buildings[iv.building];
      if (!b?.alive || b.kind === "ruin") throw new Error(`building ${iv.building} cannot be destroyed`);
      ruinBuilding(ctx, b.id, "player.destroy_building");
      const civ = s.civs[s.settlements[b.settlement].civ];
      civ.legitimacy = clampPct(civ.legitimacy - 3);
      s.settlements[b.settlement].fear = clampPct(Math.max(s.settlements[b.settlement].fear, 40));
      break;
    }
    case "build": {
      const st = s.settlements[iv.settlement];
      if (!st?.alive) throw new Error(`settlement ${iv.settlement} does not exist`);
      const civ = s.civs[st.civ];
      const cost = BUILD_COST[iv.kind];
      if (cost === undefined) throw new Error(`cannot build a ${iv.kind}`);
      if (civ.treasury < cost) throw new Error(`${civ.name} cannot afford a ${iv.kind} (${cost} needed)`);
      const spot = buildingSite(s, iv.kind, st.id);
      if (!spot) throw new Error(`no room for a ${iv.kind} near ${st.name}`);
      ctx.ledger.transfer(trRef(civ.id), { kind: "burn" }, cost, `build ${iv.kind}`);
      const id = founding(s, iv.kind, spot.x, spot.y, st.id, -1);
      emit(ctx, { type: "world.built", importance: 6, civ: civ.id, settlement: st.id, data: { building: id, kind: iv.kind, cost }, causes: ["player.build"] });
      break;
    }
    case "set_policy": {
      const civ = s.civs[iv.civ];
      if (!civ?.alive) throw new Error(`civ ${iv.civ} does not exist`);
      const [lo, hi] = POLICY_RANGE[iv.key];
      const v = Math.round(clamp(iv.value, lo, hi));
      const before = civ.policies[iv.key];
      civ.policies[iv.key] = v;
      civ.basePolicies[iv.key] = v;
      // a decree on a gate (quarantine, borders, grain exports) ties the ruler's hands for a season
      if (iv.key === "quarantine" || iv.key === "borders" || iv.key === "exportBan") civ.policyLock[iv.key] = s.day + CIV.policyLockDays;
      emit(ctx, { type: "civ.policy_set", importance: 5, civ: civ.id, data: { key: iv.key, before, after: v }, causes: ["player.set_policy"] });
      break;
    }
    case "set_attitude": {
      const a = s.civs[iv.civ];
      const b = s.civs[iv.other];
      if (!a?.alive || !b?.alive) throw new Error("both civilizations must exist");
      a.attitude[b.id] = clamp(Math.round(iv.value), -100, 100);
      emit(ctx, { type: "civ.attitude_set", importance: 5, civ: a.id, data: { a: a.name, b: b.name, otherCiv: b.id, value: a.attitude[b.id] }, causes: ["player.set_attitude"] });
      if (b.id in a.wars && a.attitude[b.id] >= CIV.peaceAt && (b.attitude[a.id] ?? 0) >= CIV.peaceAt) makePeace(ctx, a, b, "player.set_attitude");
      break;
    }
    case "nudge_belief": {
      const c = s.citizens[iv.citizen];
      if (!c?.alive) throw new Error(`citizen ${iv.citizen} is not alive`);
      shiftBelief(c, iv.key, c.traits.includes("loyal") ? Math.round(iv.delta / 2) : iv.delta);
      remember(c, { day: s.day, tag: "player.nudge", valence: 0 });
      emit(ctx, { type: "civ.belief_nudged", importance: 3, citizens: [c.id], settlement: c.settlement, data: { key: iv.key, delta: iv.delta }, causes: ["player.nudge_belief"] });
      break;
    }
    case "mission": {
      resolveMission(ctx, iv.mission, iv.accept, (inner) => applyIntervention(ctx, inner, false));
      break;
    }
    case "reveal": {
      const key = `${iv.target === "citizen" ? "c" : "b"}${iv.id}`;
      const last = s.story.revealLog[key];
      if (last !== undefined && s.day - last < STORY_ECON.revealCooldownDays) throw new Error(`already investigated ${STORY_ECON.revealCooldownDays - (s.day - last)} days too recently`);
      const clue = investigate(s, iv.target, iv.id);
      if (!clue) throw new Error("nothing to learn there");
      s.story.revealLog[key] = s.day;
      s.story.clues.push({ id: `reveal.${key}@${s.day}`, day: s.day, grade: clue.grade, text: clue.text, refs: iv.target === "citizen" ? { citizen: iv.id } : { business: s.buildings[iv.id]?.business } });
      const gained = clue.grade === "evidence" ? STORY_ECON.revealKnowledgeEvidence : STORY_ECON.revealKnowledgeRumor;
      s.story.knowledge += gained;
      emit(ctx, { type: "story.clue", importance: 4, citizens: iv.target === "citizen" ? [iv.id] : [], settlement: clue.settlement, data: { grade: clue.grade, text: clue.text, knowledge: gained }, causes: ["player.reveal"] });
      break;
    }
    case "set_focus": {
      const civ = s.civs[iv.civ];
      if (!civ?.alive) throw new Error(`civ ${iv.civ} does not exist`);
      if (civ.researchFocus !== iv.field) { civ.researchFocus = iv.field; civ.researchPool = Math.floor(civ.researchPool / 2); }
      civ.focusLockedUntil = s.day + 120;
      emit(ctx, { type: "civ.research_focus", importance: 4, civ: civ.id, data: { field: iv.field }, causes: ["player.set_focus"] });
      break;
    }
    case "found_colony": {
      const civ = s.civs[iv.civ];
      const from = s.settlements[iv.from];
      if (!civ?.alive || !from?.alive || from.civ !== civ.id) throw new Error("that town does not belong to that civilization");
      foundColony(ctx, civ, from, "player.found_colony");
      break;
    }
    case "relocate_citizen": {
      const c = s.citizens[iv.citizen];
      const to = s.settlements[iv.settlement];
      if (!c?.alive) throw new Error(`citizen ${iv.citizen} is not alive`);
      if (!to?.alive) throw new Error(`settlement ${iv.settlement} does not exist`);
      if (c.settlement === to.id) throw new Error(`${c.name} already lives in ${to.name}`);
      if (c.occupation === "ruler") throw new Error("a ruler stays with the court");
      const toCiv = s.civs[to.civ];
      if (toCiv.id !== s.settlements[c.settlement].civ && toCiv.policies.borders >= 100) throw new Error(`${toCiv.name} has closed its borders`);
      relocateHousehold(ctx, c, to, "player.relocate_citizen", "life.migrated", -5);
      break;
    }
    case "reveal_vision": {
      if (s.story.revealedVisions.includes(iv.vision)) throw new Error("already revealed");
      if (s.story.knowledge < STORY_ECON.visionRevealCost) throw new Error(`not enough Knowledge: ${STORY_ECON.visionRevealCost} needed, you have ${s.story.knowledge}`);
      s.story.knowledge -= STORY_ECON.visionRevealCost;
      s.story.revealedVisions.push(iv.vision);
      emit(ctx, { type: "story.vision_revealed", importance: 4, data: { vision: iv.vision }, causes: ["player.reveal_vision"] });
      break;
    }
    default:
      // fund/defund_project, nudge_trait, relocate, paint_terrain, reveal arrive with the systems they need (M5+)
      throw new Error(`intervention ${iv.type} is not implemented yet`);
  }
  s.story.interventions.push(iv);
}

const MEMORY_PHRASE: Record<string, string> = {
  "war.declared": "the day war was declared", "war.raid": "the raid", "war.conquered": "the day the town fell", "econ.wage_cut": "the wage cut", "econ.laid_off": "being laid off",
  "econ.business_closed": "the closure", "econ.food_unavailable": "not being able to buy food", "econ.price_spike": "the price of food", "life.death": "a death in the family",
  "life.homeless": "losing a home", "civ.succession": "the succession", "civ.conscripted": "being conscripted", "civ.disappearance": "the disappearance", "world.bandits": "the bandits",
  "life.migrated": "leaving home", "life.settled": "settling the new town", "life.birth": "the day the child was born",
};

/**
 * What investigating a target teaches. Buildings yield evidence read from state; people yield a
 * rumor from what they remember and believe (true to them, not necessarily to the world).
 */
function investigate(s: WorldState, target: "citizen" | "building" | "project", id: number): { grade: "rumor" | "evidence"; text: string; settlement?: number } | null {
  if (target === "building") {
    const b = s.buildings[id];
    if (!b?.alive) return null;
    const st = s.settlements[b.settlement];
    const civ = s.civs[st.civ];
    const biz = b.business >= 0 ? s.businesses[b.business] : null;
    switch (b.kind) {
      case "lab": {
        const lead = biz?.employees.map((x) => s.citizens[x]).filter((c) => c.alive).sort((a, c) => c.skills.science - a.skills.science)[0];
        return { grade: "evidence", settlement: st.id, text: `Lab ledger, ${st.name}: ${civ.name} pays $${(civ.policies.researchBudget / 100).toFixed(0)} a day; the work is ${civ.researchFocus} (level ${civ.tech[civ.researchFocus]}); automation stands at ${civ.tech.automation}, machine risk at ${civ.tech.machineAutonomyRisk}${lead ? `; the lead is ${lead.name} (science ${lead.skills.science})` : ""}.` };
      }
      case "barracks": {
        const soldiers = biz?.employees.filter((x) => s.citizens[x].alive).length ?? 0;
        const foes = Object.keys(civ.attitude).map(Number).filter((o) => (civ.attitude[o] ?? 0) <= -30).map((o) => s.civs[o].name);
        return { grade: "evidence", settlement: st.id, text: `Muster roll, ${st.name}: ${soldiers} soldiers, military tech ${civ.tech.military}, budget $${(civ.policies.militaryBudget / 100).toFixed(0)} a day${Object.keys(civ.wars).length ? `; at war with ${Object.keys(civ.wars).map((o) => s.civs[Number(o)].name).join(", ")}` : foes.length ? `; the officers speak ill of ${foes.join(" and ")}` : "; no enemy named"}.` };
      }
      case "town_hall": {
        const ruler = civ.ruler >= 0 ? s.citizens[civ.ruler] : null;
        const worst = Object.keys(civ.attitude).map(Number).sort((a, c) => (civ.attitude[a] ?? 0) - (civ.attitude[c] ?? 0))[0];
        return { grade: "evidence", settlement: st.id, text: `Council minutes, ${st.name}: treasury $${Math.round(civ.treasury / 100).toLocaleString()}, legitimacy ${civ.legitimacy}, tax ${civ.policies.taxRate} %, oversight ${civ.policies.oversight}${ruler ? `; ${ruler.name} (${ruler.traits.join(", ")}) presides` : "; nobody presides"}${worst !== undefined ? `; coldest toward ${s.civs[worst].name} (${civ.attitude[worst]})` : ""}.` };
      }
      case "market": {
        const m = s.markets[st.id];
        return { grade: "evidence", settlement: st.id, text: `Market book, ${st.name}: food $${(m.price.food / 100).toFixed(2)}, materials $${(m.price.materials / 100).toFixed(2)}, energy $${(m.price.energy / 100).toFixed(2)}; granary ${m.reserve.food} units against a target of ${civ.policies.foodReserveDays * st.population}.` };
      }
      case "farm": case "workshop": case "factory": case "power_plant": case "clinic": {
        if (!biz) return null;
        return { grade: "evidence", settlement: st.id, text: `${b.kind.replace("_", " ")} #${b.id}, ${st.name}: ${biz.employees.length} of ${biz.staffTarget} posts filled, wage $${(biz.wage / 100).toFixed(2)}, cash $${Math.round(biz.cash / 100)}, ${biz.insolventDays ? `${biz.insolventDays} days behind on payroll` : "payroll met"}${biz.automation ? `, automation ${biz.automation} %` : ""}.` };
      }
      default: return null;
    }
  }
  if (target === "citizen") {
    const c = s.citizens[id];
    if (!c?.alive) return null;
    const st = s.settlements[c.settlement];
    const civ = s.civs[st.civ];
    const strongest = [...c.beliefs].sort((a, b) => Math.abs(b.strength - 50) - Math.abs(a.strength - 50))[0];
    const lastBad = [...c.memories].reverse().find((m) => m.valence <= -20);
    const lines: string[] = [];
    if (c.occupation === "ruler") {
      const worst = Object.keys(civ.attitude).map(Number).sort((a, b) => (civ.attitude[a] ?? 0) - (civ.attitude[b] ?? 0))[0];
      lines.push(worst !== undefined && (civ.attitude[worst] ?? 0) <= -30 ? `${c.name} does not hide it: ${s.civs[worst].name} is the problem, and soldiers are the answer.` : `${c.name} talks of granaries and taxes, not of neighbours.`);
    } else if (c.occupation === "scientist") lines.push(civ.tech.automation >= 40 ? `${c.name} says the relays will run the whole town one day, and smiles when saying it.` : `${c.name} says the lab is short of money and long on ideas.`);
    else if (c.occupation === "soldier") lines.push(Object.keys(civ.wars).length ? `${c.name} has marched already and expects to march again.` : `${c.name} drills every morning and has not been told why.`);
    if (strongest && Math.abs(strongest.strength - 50) >= 15) lines.push(`${c.name} ${strongest.strength > 50 ? "believes" : "doubts"} that ${strongest.key.replace(/_/g, " ")}.`);
    if (lastBad) lines.push(`${c.name} still talks about day ${lastBad.day}: ${MEMORY_PHRASE[lastBad.tag] ?? lastBad.tag.replace(/^\w+\./, "").replace(/_/g, " ")}.`);
    if (lines.length === 0) lines.push(`${c.name} has little to say: work, home, the market.`);
    return { grade: "rumor", settlement: st.id, text: lines.join(" ") };
  }
  return null;
}

/** True once a terminal event has fired (Day 545 reached, or everyone is dead). */
export function isTerminal(e: WorldEvent): boolean {
  return e.type === "story.countdown_end" || e.type === "story.extinction";
}

/**
 * Runs up to `days` steps headless with optional scheduled interventions, stopping early at a
 * terminal event. Resolves the ending when one is reached. Used by tests, the Oracle and forecasts.
 */
export function run(
  state: WorldState,
  days: number,
  opts: StepOptions & { interventions?: Intervention[]; stopAtTerminal?: boolean } = {},
): { events: WorldEvent[]; metrics: DailyMetrics[]; ending: EndingResult | null } {
  const events: WorldEvent[] = [];
  const metrics: DailyMetrics[] = [];
  const byDay = new Map<number, Intervention[]>();
  for (const iv of opts.interventions ?? []) byDay.set(iv.day, [...(byDay.get(iv.day) ?? []), iv]);
  let ending: EndingResult | null = null;
  for (let d = 0; d < days; d++) {
    const r = step(state, byDay.get(state.day + 1) ?? [], opts);
    events.push(...r.events);
    metrics.push(r.metrics);
    if (r.events.some(isTerminal)) {
      ending = resolveEnding(state, events, metrics);
      if (opts.stopAtTerminal) break;
    }
  }
  return { events, metrics, ending };
}

