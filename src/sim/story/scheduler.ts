/**
 * Phase 6b — the story scheduler (docs/05), per civilization. RNG stream: story.
 *
 * for each civ, for each StoryEvent in stable order: skip if fired (once) or cancelled; skip before
 * its window; cancel (transitively) after it; skip if blocked or not required; roll; apply effects,
 * record, emit the event and its clues. Fired ids are `${event}@${civ}`. Engine milestones that
 * chains depend on (loss of control, conquest, coup) are recorded into `fired` the day they happen.
 */
import { clamp, clampPct } from "../math";
import { nextInt } from "../rng";
import type { Citizen, Civilization, WorldEvent, WorldState } from "../types";
import { STORY_ECON } from "../types";
import { rulerTitle } from "../worldgen/names";
import { shiftBelief } from "../systems/citizens";
import { emit } from "../systems/context";
import type { StepContext } from "../systems/context";
import { conscription } from "../systems/ruler";
import { crowded, foundColony } from "../systems/society";
import { STORY_EVENTS } from "./chains";
import { infect } from "../systems/health";
import { ECON } from "../data/economy";
import type { Condition, Effect, StoryEvent } from "./chains";

const MILESTONES = new Set(["research.loss_of_control", "war.conquest", "civ.coup"]);

function labLead(s: WorldState, civ: Civilization): Citizen | null {
  let best: Citizen | null = null;
  for (const b of s.businesses) {
    if (!b.alive || b.kind !== "lab" || !civ.settlements.includes(b.settlement)) continue;
    for (const id of b.employees) {
      const c = s.citizens[id];
      if (c.alive && (!best || c.skills.science > best.skills.science)) best = c;
    }
  }
  return best;
}

function path(civ: Civilization, p: string): number | string {
  const parts = p.split(".");
  let v: unknown = civ;
  for (const k of parts) v = (v as Record<string, unknown>)[k];
  return v as number | string;
}

function cmp(a: number | string, op: string, b: number | string): boolean {
  switch (op) {
    case "<": return a < b;
    case "<=": return a <= b;
    case "==": return a === b;
    case "!=": return a !== b;
    case ">=": return a >= b;
    case ">": return a > b;
  }
  return false;
}

function firedDay(s: WorldState, id: string, civ: number): number | null {
  for (let i = s.story.fired.length - 1; i >= 0; i--) if (s.story.fired[i].id === `${id}@${civ}`) return s.story.fired[i].day;
  return null;
}

function inCiv(s: WorldState, e: WorldEvent, civ: Civilization): boolean {
  if (e.civ !== undefined) return e.civ === civ.id;
  if (e.settlement !== undefined) return civ.settlements.includes(e.settlement);
  return false;
}

export function holds(s: WorldState, civ: Civilization, c: Condition): boolean {
  switch (c.kind) {
    case "civ": return cmp(path(civ, c.path), c.op, c.value);
    case "fired": {
      const d = firedDay(s, c.event, civ.id);
      return d !== null && (c.withinDays === undefined || s.day - d <= c.withinDays);
    }
    case "notFired": return firedDay(s, c.event, civ.id) === null;
    case "rulerTrait": {
      const r = civ.ruler >= 0 ? s.citizens[civ.ruler] : null;
      return (r?.traits.includes(c.trait) ?? false) === c.has;
    }
    case "hasLead": { const l = labLead(s, civ); return !!l && l.skills.science >= c.minScience; }
    case "recent": return s.story.recent.some((e) => e.type === c.type && s.day - e.day <= c.withinDays && inCiv(s, e, civ) && (!c.occupation || e.data?.occupation === c.occupation) && (!c.cause || (e.causes ?? []).some((x) => x.startsWith(c.cause!))));
    case "atWar": return (Object.keys(civ.wars).length > 0) === c.value;
    case "climate": return cmp(s.climate[c.path], c.op, c.value);
    case "sickShare": {
      let sick = 0; let n = 0;
      for (const z of s.citizens) if (z.alive && civ.settlements.includes(z.settlement)) { n++; if (z.infection === "sick" || z.infection === "incubating") sick++; }
      return cmp(n ? Math.round((100 * sick) / n) : 0, c.op, c.value);
    }
    case "sickTowns": {
      const per = new Map<number, number>();
      for (const z of s.citizens) if (z.alive && z.infection === "sick") per.set(z.settlement, (per.get(z.settlement) ?? 0) + 1);
      let towns = 0;
      for (const v of per.values()) if (v >= c.min) towns++;
      return cmp(towns, c.op, c.value);
    }
    case "foodRatio": { const m = s.markets[civ.settlements[0]]; return !!m && cmp(Math.round((100 * m.price.food) / ECON.basePrice.food), c.op, c.value); }
    case "reserveDays": { const m = s.markets[civ.settlements[0]]; const st = s.settlements[civ.settlements[0]]; return !!m && cmp(Math.floor(m.reserve.food / Math.max(1, st.population)), c.op, c.value); }
    case "popShare": { const st = s.settlements[civ.settlements[0]]; const start = s.story.startPopulation[st.id] || 1; return cmp(Math.round((100 * st.population) / start), c.op, c.value); }
    case "disasters": { const rank = { off: 0, low: 1, normal: 2, chaotic: 3 }; return rank[s.story.disasters] >= rank[c.atLeast]; }
    case "hasBuilding": return s.buildings.some((b) => b.alive && b.kind === c.building && civ.settlements.includes(b.settlement)) === c.value;
    case "irrigated": return civ.irrigated === c.value;
    case "crowded": return civ.settlements.some((id) => s.settlements[id]?.alive && crowded(s, s.settlements[id])) === c.value;
    case "othersClosed": return s.civs.some((o) => o.alive && o.id !== civ.id && o.policies.borders >= 100) === c.value;
    case "colonyPop": { const col = newestColony(s, civ); return cmp(col ? col.population : 0, c.op, c.value); }
    case "all": return c.of.every((x) => holds(s, civ, x));
    case "any": return c.of.some((x) => holds(s, civ, x));
    case "not": return !holds(s, civ, c.c);
  }
}

function apply(ctx: StepContext, civ: Civilization, ef: Effect): void {
  const { s } = ctx;
  const people = () => s.citizens.filter((c) => c.alive && civ.settlements.includes(c.settlement));
  switch (ef.kind) {
    case "civ.policy.delta": civ.policies[ef.key] = Math.max(0, civ.policies[ef.key] + ef.delta); civ.basePolicies[ef.key] = Math.max(0, civ.basePolicies[ef.key] + ef.delta); break;
    case "civ.policy.set": civ.policies[ef.key] = ef.value; civ.basePolicies[ef.key] = ef.value; break;
    case "civ.tech.delta": civ.tech[ef.field] = clampPct(civ.tech[ef.field] + ef.delta); break;
    case "civ.legitimacy.delta": civ.legitimacy = clampPct(civ.legitimacy + ef.delta); break;
    case "civ.form.set": civ.form = ef.form; break;
    case "civ.attitude.delta": for (const k of Object.keys(civ.attitude)) civ.attitude[Number(k)] = clamp(civ.attitude[Number(k)] + ef.delta, -100, 100); break;
    case "civ.research.pool": civ.researchPool = Math.max(0, civ.researchPool + ef.delta); break;
    case "lead.belief.delta": { const l = labLead(s, civ); if (l) shiftBelief(l, ef.key, ef.delta); break; }
    case "engineers.belief.delta": for (const c of people()) if (c.occupation === "engineer") shiftBelief(c, ef.key, ef.delta); break;
    case "people.belief.delta": for (const c of people()) shiftBelief(c, ef.key, ef.delta); break;
    case "conscript": conscription(ctx, civ, { force: true, max: ef.count }); break;
    case "civ.ceasefire.set": civ.ceasefireUntil = Math.min(civ.ceasefireUntil, s.day + ef.days); break;
    case "infect": {
      const pool = people().filter((c) => c.infection === "none" && (!ef.occupation || c.occupation === ef.occupation));
      const fallback = people().filter((c) => c.infection === "none");
      const from = pool.length ? pool : fallback;
      for (let i = 0; i < ef.count && from.length; i++) {
        const c = from.splice(nextInt(s.rng.story, 0, from.length - 1), 1)[0];
        if (infect(s, c)) emit(ctx, { type: "health.outbreak", importance: 6, civ: civ.id, settlement: c.settlement, citizens: [c.id], data: { name: c.name, occupation: c.occupation }, causes: ["story.rp.index", "trade.contact"] });
      }
      break;
    }
    case "climate.rainfall.delta": s.climate.rainfall = clampPct(s.climate.rainfall + ef.delta); break;
    case "climate.drought.set": s.climate.droughtDays = Math.max(s.climate.droughtDays, ef.days); emit(ctx, { type: "env.drought_begins", importance: 6, settlement: civ.settlements[0], data: { days: s.climate.droughtDays, intensity: ef.days - 20 }, causes: ["story.gd.chain", "climate.rainfall"] }); break;
    case "civ.irrigated.set": civ.irrigated = ef.value; break;
    case "market.food.multiply": { const m = s.markets[civ.settlements[0]]; if (m) m.price.food = Math.round(m.price.food * ef.factor); break; }
    case "granary.delta": { const m = s.markets[civ.settlements[0]]; if (m) m.reserve.food = Math.max(0, m.reserve.food + ef.units); break; }
    case "civ.colony.found": {
      const from = civ.settlements.map((id) => s.settlements[id]).filter((st) => st.alive).sort((a, b) => b.housingShortage - a.housingShortage || b.population - a.population)[0];
      if (!from) break;
      try { foundColony(ctx, civ, from, "story.co.founding"); } catch { /* no land or no money: the chain's clue stands, the town stays where it is */ }
      break;
    }
    case "energy.cut": for (const b of s.businesses) if (b.alive && b.kind === "power_plant" && civ.settlements.includes(b.settlement)) b.inventory.energy = Math.floor(b.inventory.energy * (1 - ef.share)); break;
  }
}

/** The civ's most recently founded settlement other than its first, or null. */
function newestColony(s: WorldState, civ: Civilization) {
  let best = null as null | WorldState["settlements"][number];
  for (const id of civ.settlements.slice(1)) { const st = s.settlements[id]; if (st?.alive && (!best || st.foundedDay > best.foundedDay)) best = st; }
  return best;
}

function fill(s: WorldState, civ: Civilization, text: string): string {
  const lead = labLead(s, civ);
  const ruler = civ.ruler >= 0 ? s.citizens[civ.ruler] : null;
  return text
    .replace(/\{colony\}/g, newestColony(s, civ)?.name ?? "the new town")
    .replace(/\{migrantsOut\}/g, String(civ.migrantsOut))
    .replace(/\{civ\}/g, civ.name)
    .replace(/\{town\}/g, s.settlements[civ.settlements[0]]?.name ?? civ.name)
    .replace(/\{lead\}/g, lead?.name ?? "the lab's lead")
    .replace(/\{ruler\}/g, ruler?.name ?? "the ruler")
    .replace(/\{title\}/g, rulerTitle(civ.disposition))
    .replace(/\{budget\}/g, `$${(civ.policies.researchBudget / 100).toFixed(0)}`)
    .replace(/\{automation\}/g, String(civ.tech.automation))
    .replace(/\{risk\}/g, String(civ.tech.machineAutonomyRisk))
    .replace(/\{oversight\}/g, String(civ.policies.oversight))
    .replace(/\{sick\}/g, String(s.citizens.reduce((a, c) => a + (c.alive && civ.settlements.includes(c.settlement) && c.infection === "sick" ? 1 : 0), 0)))
    .replace(/\{foodPrice\}/g, `$${((s.markets[civ.settlements[0]]?.price.food ?? 0) / 100).toFixed(2)}`)
    .replace(/\{reserve\}/g, String(s.markets[civ.settlements[0]]?.reserve.food ?? 0));
}

function cancel(s: WorldState, ev: StoryEvent, civ: number): void {
  const key = `${ev.id}@${civ}`;
  if (s.story.cancelled.includes(key)) return;
  s.story.cancelled.push(key);
  for (const next of ev.onCancel ?? []) {
    const e2 = STORY_EVENTS.find((x) => x.id === next);
    if (e2) cancel(s, e2, civ);
  }
}

export function storyPhase(ctx: StepContext): void {
  const { s } = ctx;
  // keep the recent-event log (today's notable events are appended by the engine after this phase)
  s.story.recent = s.story.recent.filter((e) => s.day - e.day <= 90);
  // milestones from the systems become fired ids
  for (const e of ctx.events) if (MILESTONES.has(e.type) && e.civ !== undefined) s.story.fired.push({ id: `${e.type}@${e.civ}`, day: s.day });

  for (const civ of s.civs) {
    if (!civ.alive) continue;
    for (const ev of STORY_EVENTS) {
      const key = `${ev.id}@${civ.id}`;
      if (s.story.cancelled.includes(key)) continue;
      if (ev.once && firedDay(s, ev.id, civ.id) !== null) continue;
      if (s.day < ev.earliestDay) continue;
      if (s.day > ev.latestDay) { cancel(s, ev, civ.id); continue; }
      if (ev.blockedBy.some((c) => holds(s, civ, c))) continue;
      if (!ev.required.every((c) => holds(s, civ, c))) continue;
      if (nextInt(s.rng.story, 0, 999) >= ev.probability) continue;
      for (const ef of ev.effects) apply(ctx, civ, ef);
      s.story.fired.push({ id: key, day: s.day });
      const clueIds: string[] = [];
      for (const [i, t] of ev.clues.entries()) {
        const id = `${key}#${i}`;
        s.story.clues.push({ id, day: s.day, grade: t.grade, text: fill(s, civ, t.text), refs: { event: ev.id, citizen: labLead(s, civ)?.id } });
        clueIds.push(id);
        s.story.knowledge += t.grade === "evidence" ? STORY_ECON.revealKnowledgeEvidence : 0;
      }
      emit(ctx, { type: `story.${ev.id}`, importance: ev.importance, civ: civ.id, settlement: civ.settlements[0], data: { title: ev.title, chain: ev.chain, clues: clueIds.length }, causes: ev.required.flatMap((c) => (c.kind === "fired" ? [`story.${c.event}`] : c.kind === "recent" ? [c.type] : [])).concat(["story.chain"]) });
    }
  }
}

/** Called by the engine after metrics: today's notable events join the story log. */
export function logRecent(s: WorldState, events: WorldEvent[]): void {
  for (const e of events) if (e.importance >= 5) s.story.recent.push({ ...e });
}
