/**
 * Frame assembly for the sim Worker (split out of sim.worker.ts in M8): WorldInfo once per world,
 * a RenderFrame per day. Pure functions of the state plus what the main thread already knows.
 */
import type { DailyMetrics, Intervention, SavedWorld, Snapshot, WorldEvent, WorldSettings, WorldState } from "../sim/types";
import { computeMetrics } from "../sim/metrics";
import { hashHex } from "../sim/hash";
import { ECON } from "../sim/data/economy";
import { soldiersOf, strength } from "../sim/systems/war";
import { rulerTitle } from "../sim/worldgen/names";
import { ACTIONS, BD, BUILDING_KINDS, BUSINESS_KINDS, BZ, CZ, INFECTIONS, OCCUPATIONS } from "./protocol";
import type { CivSnapshot, RenderFrame, SettlementSnapshot, WorldDelta, WorldInfo } from "./protocol";

/** WorldInfo is announced from this state, so this is what the main thread knows afterwards. */
export interface Known { citizens: number; settlements: number; ownerDirty: boolean; roads: number }

export function knownOf(s: WorldState): Known {
  return { citizens: s.citizens.length, settlements: s.settlements.length, ownerDirty: false, roads: s.roads.length };
}

export function worldInfo(r: { state: WorldState; id: string; name: string; settings: WorldSettings; createdAt: number; forkedFrom: SavedWorld["forkedFrom"]; snapshots: Snapshot[] }): WorldInfo {
  const s = r.state;
  const t = s.terrain;
  return {
    seed: s.seed,
    settings: r.settings,
    width: t.width,
    height: t.height,
    biome: t.biome.slice(),
    elevation: t.elevation.slice(),
    moisture: t.moisture.slice(),
    resource: t.resource.slice(),
    river: t.river.slice(),
    owner: t.owner.slice(),
    settlements: s.settlements.map((x) => ({ id: x.id, name: x.name, cx: x.cx, cy: x.cy, civName: s.civs[x.civ].name, civ: x.civ })),
    roads: s.roads.map((r) => ({ ...r, tiles: [...r.tiles] })),
    civs: s.civs.map((c) => ({ id: c.id, name: c.name, disposition: c.disposition, color: c.color, title: rulerTitle(c.disposition) })),
    citizens: s.citizens.map((c) => ({ id: c.id, name: c.name, traits: c.traits, home: c.home, goal: c.goal, settlement: c.settlement })),
    initialHash: r.snapshots[0] ? hashHex(r.snapshots[0].state) : hashHex(s),
    id: r.id,
    name: r.name,
    forkedFrom: r.forkedFrom,
  };
}

export interface FrameOptions {
  stepMs: number;
  events: WorldEvent[];
  metrics: DailyMetrics | null;
  snapshotDays: number[];
  applied?: Intervention[];
  /** What the main thread already knows about this run; when given, the frame carries a delta of what grew. */
  known?: Known;
}

/** Packs a WorldState into the typed arrays and snapshots the renderer reads (docs/04). */
export function buildFrame(s: WorldState, opts: FrameOptions): RenderFrame {
  const { stepMs, events, metrics, snapshotDays } = opts;
  const applied = opts.applied ?? [];
  const cz = new Int32Array(s.citizens.length * CZ.STRIDE);
  s.citizens.forEach((c, i) => {
    const o = i * CZ.STRIDE;
    cz[o + CZ.id] = c.id;
    cz[o + CZ.it0] = c.itinerary[0] ?? -1;
    cz[o + CZ.it1] = c.itinerary[1] ?? -1;
    cz[o + CZ.it2] = c.itinerary[2] ?? -1;
    cz[o + CZ.it3] = c.itinerary[3] ?? -1;
    cz[o + CZ.occ] = OCCUPATIONS.indexOf(c.occupation);
    cz[o + CZ.alive] = c.alive ? 1 : 0;
    cz[o + CZ.food] = c.needs.food;
    cz[o + CZ.shelter] = c.needs.shelter;
    cz[o + CZ.safety] = c.needs.safety;
    cz[o + CZ.belonging] = c.needs.belonging;
    cz[o + CZ.health] = c.health;
    cz[o + CZ.foodStock] = c.foodStock;
    cz[o + CZ.wealth] = c.wealth;
    cz[o + CZ.workplaceBuilding] = c.workplace >= 0 ? s.businesses[c.workplace].building : c.occupation === "official" || c.occupation === "ruler" ? c.itinerary[1] : -1;
    cz[o + CZ.action] = ACTIONS.indexOf(c.action);
    cz[o + CZ.age] = c.age;
    cz[o + CZ.settlement] = c.settlement;
    cz[o + CZ.infection] = INFECTIONS.indexOf(c.infection);
  });
  const bd = new Int32Array(s.buildings.length * BD.STRIDE);
  s.buildings.forEach((b, i) => {
    const o = i * BD.STRIDE;
    bd[o + BD.id] = b.id;
    bd[o + BD.kind] = BUILDING_KINDS.indexOf(b.kind);
    bd[o + BD.x] = b.x;
    bd[o + BD.y] = b.y;
    bd[o + BD.tier] = b.tier;
    bd[o + BD.condition] = b.condition;
    bd[o + BD.alive] = b.alive ? 1 : 0;
    bd[o + BD.business] = b.business;
    bd[o + BD.settlement] = b.settlement;
  });
  const bz = new Int32Array(s.businesses.length * BZ.STRIDE);
  s.businesses.forEach((b, i) => {
    const o = i * BZ.STRIDE;
    bz[o + BZ.id] = b.id;
    bz[o + BZ.alive] = b.alive ? 1 : 0;
    bz[o + BZ.kind] = BUSINESS_KINDS.indexOf(b.kind);
    bz[o + BZ.building] = b.building;
    bz[o + BZ.cash] = b.cash;
    bz[o + BZ.wage] = b.wage;
    bz[o + BZ.employees] = b.employees.length;
    bz[o + BZ.staffTarget] = b.staffTarget;
    bz[o + BZ.profit30] = b.profit30;
    bz[o + BZ.lastOutput] = b.lastOutput;
    bz[o + BZ.invFood] = b.inventory.food;
    bz[o + BZ.invMat] = b.inventory.materials;
    bz[o + BZ.invEnergy] = b.inventory.energy;
    bz[o + BZ.owner] = b.owner;
    bz[o + BZ.insolventDays] = b.insolventDays;
  });
  const civs: CivSnapshot[] = s.civs.map((c) => ({
    id: c.id,
    name: c.name,
    alive: c.alive,
    disposition: c.disposition,
    form: c.form,
    title: rulerTitle(c.disposition),
    rulerId: c.ruler,
    rulerName: c.ruler >= 0 ? s.citizens[c.ruler].name : "—",
    legitimacy: c.legitimacy,
    treasury: c.treasury,
    policies: { ...c.policies },
    tech: { ...c.tech },
    attitude: { ...c.attitude },
    wars: Object.keys(c.wars).map(Number),
    ceasefireUntil: c.ceasefireUntil,
    soldiers: soldiersOf(s, c).length,
    strength: strength(s, c),
    population: s.citizens.reduce((a, z) => a + (z.alive && c.settlements.includes(z.settlement) ? 1 : 0), 0),
    researchFocus: c.researchFocus,
    settlements: [...c.settlements],
    conquests: c.conquests.length,
    color: c.color,
    sick: s.citizens.reduce((a, z) => a + (z.alive && c.settlements.includes(z.settlement) && (z.infection === "sick" || z.infection === "incubating") ? 1 : 0), 0),
    recovered: s.citizens.reduce((a, z) => a + (z.alive && c.settlements.includes(z.settlement) && z.infection === "recovered" ? 1 : 0), 0),
    quarantine: c.policies.quarantine >= 100,
    irrigated: c.irrigated,
    migrantsIn: c.migrantsIn,
    migrantsOut: c.migrantsOut,
    births: c.births,
    tradeIn: c.tradeIn,
    tradeOut: c.tradeOut,
    borders: c.policies.borders >= 100,
    exportBan: c.policies.exportBan >= 100,
    closedDays: c.closedDays,
    quarantineDays: c.quarantineDays,
    policyLock: { ...c.policyLock },
  }));
  const homelessBy = new Map<number, number>();
  const sickBy = new Map<number, number>();
  for (const c of s.citizens) {
    if (!c.alive) continue;
    if (c.home < 0) homelessBy.set(c.settlement, (homelessBy.get(c.settlement) ?? 0) + 1);
    if (c.infection === "sick" || c.infection === "incubating") sickBy.set(c.settlement, (sickBy.get(c.settlement) ?? 0) + 1);
  }
  const settlements: SettlementSnapshot[] = s.settlements.map((st) => ({
    id: st.id, name: st.name, civ: st.civ, population: st.population, unrest: st.unrest, fear: st.fear, cx: st.cx, cy: st.cy,
    parent: st.parent, foundedDay: st.foundedDay, homeless: homelessBy.get(st.id) ?? 0,
    foodRatio: Math.round((100 * (s.markets[st.id]?.price.food ?? ECON.basePrice.food)) / ECON.basePrice.food), sick: sickBy.get(st.id) ?? 0,
  }));
  const caravans = s.caravans.map((cv) => ({ id: cv.id, from: cv.from, to: cv.to, good: cv.good, qty: cv.qty, departDay: cv.departDay, arriveDay: cv.arriveDay }));
  // what the main thread does not know yet
  let delta: WorldDelta | undefined;
  if (opts.known) {
    const k = opts.known;
    if (events.some((e) => e.type === "civ.colony_founded" || e.type === "war.conquest")) k.ownerDirty = true;
    if (s.citizens.length > k.citizens || s.settlements.length > k.settlements || k.ownerDirty || s.roads.length > k.roads) {
      delta = {
        citizens: s.citizens.slice(k.citizens).map((c) => ({ id: c.id, name: c.name, traits: c.traits, home: c.home, goal: c.goal, settlement: c.settlement })),
        settlements: s.settlements.slice(k.settlements).map((x) => ({ id: x.id, name: x.name, cx: x.cx, cy: x.cy, civName: s.civs[x.civ].name, civ: x.civ })),
        owner: k.ownerDirty ? s.terrain.owner.slice() : null,
        roads: s.roads.length > k.roads ? s.roads.map((r) => ({ ...r, tiles: [...r.tiles] })) : null,
      };
      k.citizens = s.citizens.length;
      k.settlements = s.settlements.length;
      k.ownerDirty = false;
      k.roads = s.roads.length;
    }
  }
  return {
    day: s.day,
    season: s.climate.season,
    citizens: cz,
    buildings: bd,
    businesses: bz,
    markets: s.markets.map((m) => ({ settlement: m.settlement, price: { ...m.price }, supplied: { ...m.supplied }, demanded: { ...m.demanded }, reserve: { ...m.reserve } })),
    civs,
    settlements,
    caravans,
    routes: s.story.fired.filter((f) => f.id.startsWith("trade.route@")).map((f) => f.id.slice("trade.route@".length).split("-").map(Number) as [number, number]),
    delta,
    applied,
    missions: s.story.missions.map((m) => ({ ...m, targets: { ...m.targets }, effects: m.effects.map((e) => ({ ...e })) })),
    story: { influence: s.story.influence, knowledge: s.story.knowledge, clues: s.story.clues.map((c) => ({ ...c, refs: { ...c.refs } })), revealedVisions: [...s.story.revealedVisions], revealLog: { ...s.story.revealLog } },
    climate: { droughtDays: s.climate.droughtDays, pollution: s.climate.pollution, rainfall: s.climate.rainfall },
    events: events.filter((e) => e.importance >= 2),
    metrics: metrics ?? computeMetrics(s),
    stepMs,
    hash: hashHex(s),
    snapshotDays,
  };
}

