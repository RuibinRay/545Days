/**
 * The Future Oracle (docs/06). At Day 0 the Worker runs the world to Day 545 with no
 * interventions — the baseline — and keeps its ending, its notable events, its metrics and a hash
 * every 30 days. From that it writes the visions the player is shown, and later measures how far
 * the real run has departed from what was foreseen. Everything here is pure: same state in, same
 * baseline out, which is what makes "the Oracle was right about this world" a checkable claim.
 */
import { DAYS, run } from "../engine";
import { hashHex } from "../hash";
import { cloneState } from "../snapshot";
import type { DailyMetrics, WorldEvent, WorldState, WorldSettings } from "../types";
import { resolveEnding } from "./endings";

export interface Baseline {
  /** Ending id and title the untouched world reaches. */
  endingId: string;
  endingTitle: string;
  endingDay: number;
  /** Events with importance ≥ 5 (the vision material and the divergence record). */
  events: WorldEvent[];
  metrics: DailyMetrics[];
  /** State hash at every 30-day mark (and the final day), for the determinism check. */
  hashes: { day: number; hash: string }[];
  /** Per-civ facts at the end, by civ id. */
  civs: { id: number; name: string; alive: boolean; population: number; risk: number; automation: number; military: number; rulerName: string; conquests: number }[];
  ms: number;
}

/** Runs a copy of `state` to Day 545 with no interventions. ~0.6 s at 300 citizens. */
export function computeBaseline(state: WorldState): Baseline {
  const t0 = performance.now();
  const s = cloneState(state);
  const hashes: { day: number; hash: string }[] = [];
  const all: WorldEvent[] = [];
  const metrics: DailyMetrics[] = [];
  let terminal = false;
  while (s.day < DAYS && !terminal) {
    const to = Math.min(DAYS, s.day + 30);
    const r = run(s, to - s.day, { stopAtTerminal: true });
    all.push(...r.events);
    metrics.push(...r.metrics);
    hashes.push({ day: s.day, hash: hashHex(s) });
    terminal = r.ending !== null;
  }
  // the resolver reads the whole record, not the last chunk's
  const ending = resolveEnding(s, all, metrics);
  const events = all.filter((e) => e.importance >= 5);
  return {
    endingId: ending.id,
    endingTitle: ending.title,
    endingDay: s.day,
    events,
    metrics,
    hashes,
    civs: s.civs.map((c) => ({
      id: c.id, name: c.name, alive: c.alive,
      population: s.citizens.reduce((a, z) => a + (z.alive && c.settlements.includes(z.settlement) ? 1 : 0), 0),
      risk: c.tech.machineAutonomyRisk, automation: c.tech.automation, military: c.tech.military,
      rulerName: c.ruler >= 0 ? s.citizens[c.ruler].name : "nobody", conquests: c.conquests.length,
    })),
    ms: Math.round(performance.now() - t0),
  };
}

// ───────────────────────── visions ─────────────────────────

export interface Vision {
  /** Which baseline event or fact this comes from (for the "what changed" screen). */
  source: { type: string; day: number } | { type: "ending" };
  /** The cryptic line (what the player sees by default). */
  cryptic: string;
  /** The plain line (settings.endingPreview = "clear", or revealed later). */
  clear: string;
}

const ENDING_VISIONS: Record<string, { cryptic: string; clear: (b: Baseline) => string }> = {
  "tech.machine_dominion": { cryptic: "Lamps burn in a town with no one left to light them. The relays answer to no one.", clear: (b) => `The machines of ${b.civs.sort((x, y) => y.risk - x.risk)[0]?.name ?? "a civilization"} stop answering: Machine Dominion.` },
  "war.scorched_border": { cryptic: "A banner comes down over a town square. Where it fell, the ground is black.", clear: (b) => `A town is conquered: The Scorched Border (${b.civs.filter((c) => c.conquests > 0).map((c) => c.name).join(", ") || "a conqueror"}).` },
  "politics.long_peace": { cryptic: "Three roads meet at a market and nobody is carrying a spear.", clear: () => "No war is ever declared: The Long Peace." },
  "fallback.plenty": { cryptic: "Full granaries, tall houses, and the count ends with nothing decided.", clear: () => "No special ending: an age of plenty." },
  "fallback.hard": { cryptic: "More graves than houses were built this year.", clear: () => "No special ending: a hard age, with many dead." },
  "fallback.fragile": { cryptic: "The peace holds, but the soldiers never go home.", clear: () => "No special ending: a fragile peace." },
  "fallback.quiet": { cryptic: "The count ends and the valley is much as it was.", clear: () => "No special ending: a quiet age." },
  "fallback.empty": { cryptic: "The houses stand. Nobody is in them.", clear: () => "Everyone dies: The Empty Valley." },
};

function townOf(state: WorldState, e: WorldEvent): string {
  return (e.settlement !== undefined && state.settlements[e.settlement]?.name) || (e.civ !== undefined && state.settlements[state.civs[e.civ]?.settlements[0] ?? -1]?.name) || "a town";
}

/** Three to five visions: the ending plus the baseline's most dramatic moments, earliest first. */
export function visionFragments(baseline: Baseline, state: WorldState, mode: WorldSettings["endingPreview"] = "cryptic"): Vision[] {
  if (mode === "off") return [];
  const out: Vision[] = [];
  const end = ENDING_VISIONS[baseline.endingId] ?? ENDING_VISIONS["fallback.quiet"];
  const picks: { e: WorldEvent; score: number }[] = [];
  const scoreOf: Record<string, number> = { "war.conquest": 100, "research.loss_of_control": 95, "civ.coup": 80, "war.declared": 60, "civ.succession": 50, "econ.price_spike": 40, "war.raid": 35, "civ.riot": 45, "world.building_destroyed": 30, "story.mission_offered": 0 };
  const seenTypes = new Set<string>();
  for (const e of baseline.events) {
    const sc = scoreOf[e.type] ?? 0;
    if (sc === 0 || seenTypes.has(e.type)) continue; // one of each kind, the first occurrence
    seenTypes.add(e.type);
    picks.push({ e, score: sc + (e.day < 200 ? 5 : 0) });
  }
  picks.sort((a, b) => b.score - a.score);
  const chosen = picks.slice(0, 3).sort((a, b) => a.e.day - b.e.day);
  for (const { e } of chosen) {
    const town = townOf(state, e);
    const d = e.data ?? {};
    let cryptic = "";
    let clear = "";
    switch (e.type) {
      case "war.conquest": cryptic = `Strangers' banners over ${town}. The old council hall has a new name on the door.`; clear = `Day ${e.day}: ${d.conqueror} takes ${d.town}.`; break;
      case "research.loss_of_control": cryptic = `Every light in ${town} comes on at once, and nobody touched a switch.`; clear = `Day ${e.day}: the relays of ${state.civs[e.civ ?? 0]?.name} stop answering (risk ${d.risk}).`; break;
      case "civ.coup": cryptic = `A crown passes in ${town}, and not by right.`; clear = `Day ${e.day}: ${d.next} seizes power in ${state.civs[e.civ ?? 0]?.name}.`; break;
      case "civ.succession": cryptic = `A funeral in ${town}; the mourners are already arguing.`; clear = `Day ${e.day}: ${d.old} dies; ${d.next} rules ${state.civs[e.civ ?? 0]?.name}.`; break;
      case "war.declared": cryptic = `Spears cross the river. ${d.aggressor} has counted ${d.target}'s soldiers and liked the number.`; clear = `Day ${e.day}: ${d.aggressor} declares war on ${d.target}.`; break;
      case "war.raid": cryptic = `Smoke over ${town} at midday. The granary door is open.`; clear = `Day ${e.day}: ${d.attacker} raids ${town}.`; break;
      case "econ.price_spike": cryptic = `Empty stalls in ${town}; a loaf costs what a day's work used to.`; clear = `Day ${e.day}: ${d.good} in ${town} reaches more than double its price.`; break;
      case "civ.riot": cryptic = `Broken glass in ${town} and nobody sweeping it.`; clear = `Day ${e.day}: a riot in ${town}.`; break;
      case "world.building_destroyed": cryptic = `A roof in ${town} that is not there any more.`; clear = `Day ${e.day}: the ${String(d.kind).replace("_", " ")} in ${town} is destroyed.`; break;
      default: continue;
    }
    out.push({ source: { type: e.type, day: e.day }, cryptic, clear });
  }
  out.push({ source: { type: "ending" }, cryptic: end.cryptic, clear: end.clear(baseline) });
  return mode === "clear" ? out.map((v) => ({ ...v, cryptic: v.clear })) : out;
}

// ───────────────────────── divergence ─────────────────────────

export interface Divergence {
  day: number;
  /** 0..100: how far the live world has moved from the foreseen one by this day. */
  score: number;
  /** Human-readable differences at this day. */
  notes: string[];
  /** Foreseen events up to this day that have not happened. */
  missing: WorldEvent[];
  /** Events that happened but were not foreseen. */
  unforeseen: WorldEvent[];
}

const KEY_EVENTS = new Set(["war.declared", "war.conquest", "war.peace", "research.loss_of_control", "civ.coup", "civ.succession", "civ.disappearance", "world.building_destroyed", "econ.price_spike"]);

function sameEvent(a: WorldEvent, b: WorldEvent): boolean {
  if (a.type !== b.type) return false;
  if (Math.abs(a.day - b.day) > 20) return false;
  const ka = `${a.civ ?? ""}|${a.settlement ?? ""}|${a.data?.otherCiv ?? ""}`;
  const kb = `${b.civ ?? ""}|${b.settlement ?? ""}|${b.data?.otherCiv ?? ""}`;
  return ka === kb;
}

/** Compares the live run (its metrics and events) with the baseline up to `day`. */
export function divergence(baseline: Baseline, metrics: DailyMetrics[], events: WorldEvent[], day: number): Divergence {
  const live = metrics.find((m) => m.day === day) ?? metrics[metrics.length - 1];
  const seen = baseline.metrics.find((m) => m.day === day) ?? baseline.metrics[Math.min(day, baseline.metrics.length) - 1];
  const notes: string[] = [];
  let score = 0;
  if (live && seen) {
    const pop = Math.abs(live.population - seen.population);
    if (pop > 0) { notes.push(`${live.population} people alive, ${seen.population} foreseen`); score += Math.min(30, pop * 2); }
    const risk = Math.abs(live.machineAutonomyRisk - seen.machineAutonomyRisk);
    if (risk >= 5) { notes.push(`machine risk ${live.machineAutonomyRisk} against ${seen.machineAutonomyRisk} foreseen`); score += Math.min(25, risk / 2); }
    const unrest = Math.abs(live.unrest - seen.unrest);
    if (unrest >= 10) { notes.push(`unrest ${live.unrest} against ${seen.unrest} foreseen`); score += Math.min(10, unrest / 5); }
    const price = Math.abs(live.priceIndex - seen.priceIndex);
    if (price >= 100) { notes.push(`prices ${(live.priceIndex / 10).toFixed(0)} % against ${(seen.priceIndex / 10).toFixed(0)} % of Day 0`); score += Math.min(10, price / 50); }
  }
  const liveKey = events.filter((e) => e.day <= day && KEY_EVENTS.has(e.type));
  const seenKey = baseline.events.filter((e) => e.day <= day && KEY_EVENTS.has(e.type));
  const missing = seenKey.filter((b) => !liveKey.some((l) => sameEvent(l, b)));
  const unforeseen = liveKey.filter((l) => !seenKey.some((b) => sameEvent(l, b)) && !l.causes?.some((c) => c.startsWith("player.")));
  score += Math.min(25, missing.length * 6) + Math.min(25, unforeseen.length * 6);
  return { day, score: Math.min(100, Math.round(score)), notes, missing, unforeseen };
}
