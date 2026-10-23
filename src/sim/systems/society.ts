/**
 * Phase 2d — society (M7). RNG stream: citizens (households, births) and civ (colonies).
 *
 * Households: two adults under one roof who like each other become partners; partners and their
 * children move together (migration, relocation, settling a colony). Children come of age at 16.
 * Births: a partnered couple of child-bearing age with a roof, food in the pantry and no fever in
 * the house has a small daily chance of a child — about one birth per hundred people every two
 * months in a fed town, none in a starving one. The newborn is a citizen like any other: a name,
 * traits, a home, a family.
 *
 * Colonies: a civilization whose town is full (people sleeping outside, or a quarter more people
 * than houses were built for) and whose treasury can pay for it founds a second town a day's walk
 * away: three houses, two farms, a market, and a dozen settlers — the homeless and the jobless
 * first, with their households. The colony is a settlement of the same civ: it shares policies,
 * ruler and treasury, trades with its parent, and can be raided or conquered like any town.
 */
import { BUILDING_SIZE, BUSINESS_DEFAULTS } from "../data/buildings";
import { ECON, SOCIETY } from "../data/economy";
import { business as bizRef, treasury as trRef } from "../ledger";
import { clampPct } from "../math";
import { chance, nextFloat, nextGaussian, nextInt, pick } from "../rng";
import type { Citizen, Civilization, MarketState, Settlement, Trait, WorldState } from "../types";
import { zeroInventory } from "../data/buildings";
import { personName, townName } from "../worldgen/names";
import { buildable, chooseColonySite, findFootprint } from "../worldgen/settlement";
import { layRoad } from "../worldgen/roads";
import { BIOME } from "../worldgen/terrain";
import { remember } from "./citizens";
import { emit } from "./context";
import type { StepContext } from "./context";
import { founding } from "./economy";

const TRAITS: Trait[] = ["ambitious", "cautious", "generous", "greedy", "curious", "secretive", "loyal", "rebellious", "frugal", "social"];

// ───────────────────────── households ─────────────────────────

/** The citizens who live with `c` and would move with them: partner and children under their roof. */
export function household(s: WorldState, c: Citizen): Citizen[] {
  const out = [c];
  if (c.partner >= 0) {
    const p = s.citizens[c.partner];
    if (p?.alive && p.home === c.home) out.push(p);
  }
  for (const r of c.relationships) {
    if (r.kind !== "family") continue;
    const k = s.citizens[r.other];
    if (k?.alive && k.occupation === "child" && k.home === c.home && !out.includes(k)) out.push(k);
  }
  return out;
}

function occupancy(s: WorldState): Map<number, number> {
  const occ = new Map<number, number>();
  for (const c of s.citizens) if (c.alive && c.home >= 0) occ.set(c.home, (occ.get(c.home) ?? 0) + 1);
  return occ;
}

/** A free bed in `settlement` with room for `n` people, else any free bed, else -1 (the street). */
export function findHome(s: WorldState, settlement: number, n: number, occ: Map<number, number>): number {
  let any = -1;
  for (const h of s.buildings) {
    if (!h.alive || h.kind !== "house" || h.settlement !== settlement) continue;
    const used = occ.get(h.id) ?? 0;
    if (used + n <= h.capacity) return h.id;
    if (any < 0 && used < h.capacity) any = h.id;
  }
  return any;
}

/**
 * Moves a citizen and their household to another settlement. Jobs are left behind; everyone arrives
 * jobless and takes a bed where one is free. Returns the people who moved.
 */
export function relocateHousehold(ctx: StepContext, c: Citizen, to: Settlement, cause: string, tag = "life.migrated", valence = -20): Citizen[] {
  const { s } = ctx;
  const people = household(s, c);
  const from = s.settlements[c.settlement];
  const fromCiv = s.civs[from.civ];
  const toCiv = s.civs[to.civ];
  const occ = occupancy(s);
  for (const p of people) if (p.home >= 0) occ.set(p.home, Math.max(0, (occ.get(p.home) ?? 1) - 1));
  const home = findHome(s, to.id, people.length, occ);
  for (const p of people) {
    if (p.workplace >= 0) {
      const biz = s.businesses[p.workplace];
      biz.employees = biz.employees.filter((id) => id !== p.id);
      p.workplace = -1;
    }
    if (p.occupation !== "child" && p.occupation !== "retired") p.occupation = "unemployed";
    p.hiredDay = -1;
    p.settlement = to.id;
    p.home = home >= 0 && (occ.get(home) ?? 0) < s.buildings[home].capacity ? home : findHome(s, to.id, 1, occ);
    if (p.home >= 0) occ.set(p.home, (occ.get(p.home) ?? 0) + 1);
    p.itinerary = [p.home, p.home, p.home, p.home];
    remember(p, { day: s.day, tag, valence });
  }
  if (fromCiv.id !== toCiv.id) {
    fromCiv.migrantsOut += people.length;
    toCiv.migrantsIn += people.length;
  }
  emit(ctx, { type: tag, importance: people.length > 1 ? 5 : 4, citizens: people.map((p) => p.id), settlement: to.id, civ: toCiv.id, data: { from: from.name, to: to.name, fromCiv: fromCiv.id, toCiv: toCiv.id, homeless: people.filter((p) => p.home < 0).length, household: people.length }, causes: [cause] });
  return people;
}

// ───────────────────────── births, partners, coming of age ─────────────────────────

function usedNames(s: WorldState): Set<string> {
  const used = new Set<string>();
  for (const c of s.citizens) used.add(c.name);
  return used;
}

export function societyPhase(ctx: StepContext): void {
  const { s } = ctx;
  const rng = s.rng.citizens;

  // coming of age: on the anniversary that makes them 16, children become adults and look for work
  if (s.day % 360 === 0) {
    for (const c of s.citizens) {
      if (!c.alive || c.occupation !== "child" || c.age < 16) continue;
      c.occupation = "unemployed";
      c.goal = pick(rng, ["survive", "save", "save", "start_business", "get_promoted", "research"] as const);
      emit(ctx, { type: "life.adult", importance: 3, citizens: [c.id], settlement: c.settlement, data: { name: c.name, age: c.age }, causes: ["citizen.age"] });
    }
  }

  // partners: every ten days, two single adults who share a roof and like each other pair up
  if (s.day % 10 === 0) {
    const byHome = new Map<number, Citizen[]>();
    for (const c of s.citizens) if (c.alive && c.home >= 0 && c.partner < 0 && c.occupation !== "child" && c.occupation !== "retired" && c.age >= 18 && c.age <= 55) byHome.set(c.home, [...(byHome.get(c.home) ?? []), c]);
    for (const singles of byHome.values()) {
      if (singles.length < 2) continue;
      const [a, b] = singles;
      const like = a.relationships.find((r) => r.other === b.id);
      if (!like || like.affinity < 25 || !chance(rng, 0.3)) continue;
      a.partner = b.id;
      b.partner = a.id;
      like.kind = "partner";
      const back = b.relationships.find((r) => r.other === a.id);
      if (back) back.kind = "partner";
      else b.relationships.push({ other: a.id, affinity: like.affinity, kind: "partner" });
      emit(ctx, { type: "life.partnered", importance: 3, citizens: [a.id, b.id], settlement: a.settlement, data: { a: a.name, b: b.name }, causes: ["citizen.socialize"] });
    }
  }

  // births
  const occ = occupancy(s);
  const seen = new Set<number>();
  let used: Set<string> | null = null;
  for (const c of s.citizens) {
    if (!c.alive || c.partner < 0 || seen.has(c.id)) continue;
    const p = s.citizens[c.partner];
    seen.add(c.id);
    seen.add(c.partner);
    if (!p?.alive || p.home !== c.home || c.home < 0) continue;
    if (c.age > SOCIETY.maxParentAge || p.age > SOCIETY.maxParentAge || c.age < 18 || p.age < 18) continue;
    const roof = s.buildings[c.home];
    if ((occ.get(c.home) ?? 0) >= roof.capacity + 1) continue; // no room for a cradle
    if (c.hungryDays > 0 || p.hungryDays > 0 || c.foodStock + p.foodStock < 4) continue;
    if (c.infection === "sick" || p.infection === "sick") continue;
    const price = s.markets[c.settlement]?.price.food ?? ECON.basePrice.food;
    if (price > ECON.basePrice.food * 2) continue; // nobody plans a child in a famine
    if (nextFloat(rng) >= SOCIETY.birthChance) continue;
    // a child is born
    used ??= usedNames(s);
    const traits: Trait[] = [pick(rng, TRAITS)];
    if (chance(rng, 0.5) && !traits.includes(c.traits[0])) traits.push(c.traits[0]);
    const kid: Citizen = {
      id: s.citizens.length,
      alive: true,
      name: personName(rng, used),
      age: 0,
      traits,
      settlement: c.settlement,
      home: c.home,
      workplace: -1,
      occupation: "child",
      skills: {
        farming: clampPct(nextGaussian(rng, 5, 3)), craft: clampPct(nextGaussian(rng, 5, 3)), science: clampPct(nextGaussian(rng, 5, 3)),
        trade: clampPct(nextGaussian(rng, 5, 3)), care: clampPct(nextGaussian(rng, 5, 3)), combat: clampPct(nextGaussian(rng, 3, 2)),
      },
      wealth: 0,
      foodStock: 2,
      health: clampPct(nextGaussian(rng, 90, 5)),
      infection: "none",
      infectionDay: -1,
      origin: c.settlement,
      partner: -1,
      born: s.day,
      needs: { food: 100, shelter: 90, safety: 80, belonging: 90 },
      weights: {
        income: clampPct(nextGaussian(rng, (c.weights.income + p.weights.income) / 2, 10)),
        needs: clampPct(nextGaussian(rng, 60, 10)),
        social: clampPct(nextGaussian(rng, (c.weights.social + p.weights.social) / 2, 10)),
        risk: clampPct(nextGaussian(rng, (c.weights.risk + p.weights.risk) / 2, 10)),
        cost: clampPct(nextGaussian(rng, 50, 10)),
      },
      goal: "survive",
      memories: [],
      beliefs: [],
      relationships: [
        { other: c.id, affinity: 70, kind: "family" },
        { other: p.id, affinity: 70, kind: "family" },
      ],
      itinerary: [c.home, c.home, c.home, c.home],
      action: "none",
      hungryDays: 0,
      hiredDay: -1,
    };
    s.citizens.push(kid);
    occ.set(c.home, (occ.get(c.home) ?? 0) + 1);
    for (const parent of [c, p]) {
      parent.relationships.push({ other: kid.id, affinity: 80, kind: "family" });
      remember(parent, { day: s.day, tag: "life.birth", valence: 50, aboutCitizen: kid.id });
      parent.needs.belonging = clampPct(parent.needs.belonging + 20);
    }
    // a parent gives the child a week of food from the pantry
    const share = Math.min(3, Math.max(c.foodStock, p.foodStock) - 1);
    if (share > 0) { if (c.foodStock >= p.foodStock) c.foodStock -= share; else p.foodStock -= share; kid.foodStock += share; }
    const civ = s.civs[s.settlements[c.settlement].civ];
    civ.births++;
    ctx.births++;
    emit(ctx, { type: "life.birth", importance: 4, citizens: [kid.id, c.id, p.id], settlement: c.settlement, civ: civ.id, data: { name: kid.name, a: c.name, b: p.name }, causes: ["citizen.partner", "needs.food"] });
  }
}

// ───────────────────────── colonies ─────────────────────────

/** True when a town is full: people sleeping outside, or grown by a handful with under three beds to spare. */
export function crowded(s: WorldState, st: Settlement): boolean {
  let beds = 0;
  for (const h of s.buildings) if (h.alive && h.kind === "house" && h.settlement === st.id) beds += h.capacity;
  const start = s.story.startPopulation[st.id] || st.population || 1;
  return st.housingShortage >= SOCIETY.colonyHomeless || (st.population >= start + SOCIETY.colonyGrowth && beds - st.population <= 2);
}

/** Where a colony of `from` would go, or null. */
export function colonySite(s: WorldState, from: Settlement): { x: number; y: number } | null {
  const taken = s.settlements.filter((x) => x.alive).map((x) => ({ x: x.cx, y: x.cy }));
  return chooseColonySite(s.terrain, { x: from.cx, y: from.cy }, taken, SOCIETY.colonyMinDist, SOCIETY.colonyMaxDist);
}

/** Founds a colony of `from` for its civ: buildings, market, settlers. Throws when it cannot be done. */
export function foundColony(ctx: StepContext, civ: Civilization, from: Settlement, cause: string): Settlement {
  const { s, ledger } = ctx;
  if (civ.treasury < SOCIETY.colonyCost) throw new Error(`${civ.name} cannot afford a colony ($${SOCIETY.colonyCost / 100} needed)`);
  if (civ.settlements.length >= SOCIETY.maxSettlements) throw new Error(`${civ.name} already holds ${civ.settlements.length} towns`);
  const site = colonySite(s, from);
  if (!site) throw new Error(`no land for a colony of ${from.name}`);
  const t = s.terrain;
  const id = s.settlements.length;
  const name = townName(s.rng.civ);
  const st: Settlement = { id, alive: true, name, civ: civ.id, cx: site.x, cy: site.y, population: 0, unrest: 0, unrestStreak: 0, housingShortage: 0, fear: 0, raidedDay: -1, lostRaids: 0, parent: from.id, foundedDay: s.day };
  s.settlements.push(st);
  const market: MarketState = { settlement: id, price: { ...s.markets[from.id].price }, supplied: zeroInventory(), demanded: zeroInventory(), reserve: zeroInventory(), spikeDay: { food: -1, materials: -1, energy: -1 } };
  s.markets.push(market);
  civ.settlements.push(id);
  civ.lastColonyDay = s.day;
  ledger.transfer(trRef(civ.id), { kind: "burn" }, SOCIETY.colonyCost - SOCIETY.colonyCapital, "colony works");

  // claim the land
  const R = 5;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const x = site.x + dx;
      const y = site.y + dy;
      if (x < 0 || y < 0 || x >= t.width || y >= t.height || dx * dx + dy * dy > R * R) continue;
      const i = y * t.width + x;
      if (t.biome[i] !== BIOME.ocean && t.owner[i] === 0) t.owner[i] = id + 1;
    }
  // buildings: a market, two farms, three houses
  const occ = new Uint8Array(t.width * t.height);
  for (const b of s.buildings) {
    if (!b.alive) continue;
    const { w, h } = BUILDING_SIZE[b.kind];
    for (let y = b.y; y < b.y + h; y++) for (let x = b.x; x < b.x + w; x++) occ[y * t.width + x] = 1;
  }
  const place = (kind: "market" | "farm" | "house"): number => {
    const size = BUILDING_SIZE[kind];
    const spot = findFootprint(t, occ, site.x, site.y, size.w, size.h, kind === "farm" ? 12 : 10);
    if (!spot || !buildable(t, spot.x, spot.y)) return -1;
    for (let y = spot.y; y < spot.y + size.h; y++) for (let x = spot.x; x < spot.x + size.w; x++) occ[y * t.width + x] = 1;
    return founding(s, kind, spot.x, spot.y, id, -1);
  };
  const marketId = place("market");
  const farms = [place("farm"), place("farm")].filter((b) => b >= 0);
  const houses = [place("house"), place("house"), place("house")].filter((b) => b >= 0);
  // the treasury capitalises the colony's businesses so they can hire on arrival
  const businesses = [marketId, ...farms].filter((b) => b >= 0).map((b) => s.businesses[s.buildings[b].business]);
  for (const b of businesses) {
    const share = Math.floor(SOCIETY.colonyCapital / businesses.length);
    ledger.transfer(trRef(civ.id), bizRef(b.id), share, "colony capital");
    b.inventory.food += b.kind === "farm" ? 40 : 20;
    b.wage = BUSINESS_DEFAULTS[b.kind].wage;
  }
  // settlers: the homeless first, then the jobless, with their households, up to the beds built
  const beds = houses.length * 4;
  const candidates = s.citizens.filter((c) => c.alive && c.settlement === from.id && c.occupation !== "child" && c.occupation !== "retired" && c.occupation !== "ruler" && c.occupation !== "official" && c.occupation !== "soldier" && c.occupation !== "scientist" && c.occupation !== "doctor");
  candidates.sort((a, b) => (a.home < 0 ? 0 : 1) - (b.home < 0 ? 0 : 1) || (a.occupation === "unemployed" ? 0 : 1) - (b.occupation === "unemployed" ? 0 : 1) || a.id - b.id);
  const moved: Citizen[] = [];
  for (const c of candidates) {
    if (moved.length >= beds) break;
    if (moved.includes(c)) continue;
    const hh = household(s, c);
    if (moved.length + hh.length > beds) continue;
    moved.push(...relocateHousehold(ctx, c, st, cause, "life.settled", 15));
  }
  st.population = moved.length;
  s.story.startPopulation[id] = Math.max(moved.length, 1);
  // roads: to the parent, and to the nearest other town on the same land
  const parentRoad = layRoad(t, from, st);
  if (parentRoad) s.roads.push(parentRoad);
  const others = s.settlements.filter((o) => o.alive && o.id !== id && o.id !== from.id).sort((p, q) => (p.cx - st.cx) ** 2 + (p.cy - st.cy) ** 2 - ((q.cx - st.cx) ** 2 + (q.cy - st.cy) ** 2));
  for (const o of others) { const r = layRoad(t, o, st); if (r) { s.roads.push(r); break; } }
  s.story.fired.push({ id: `civ.colony@${civ.id}`, day: s.day });
  emit(ctx, { type: "civ.colony_founded", importance: 8, civ: civ.id, settlement: id, citizens: moved.map((c) => c.id), data: { name, from: from.name, settlers: moved.length, farms: farms.length, houses: houses.length, cost: SOCIETY.colonyCost }, causes: [cause, "settlement.crowded"] });
  return st;
}

/** Phase 5c: a crowded, solvent civilization founds a colony on its own (every 10 days; stream: civ). */
export function expansionPhase(ctx: StepContext): void {
  const { s } = ctx;
  if (s.day % 10 !== 5) return;
  for (const civ of s.civs) {
    if (!civ.alive || civ.settlements.length >= SOCIETY.maxSettlements) continue;
    if (s.day - civ.lastColonyDay < SOCIETY.colonyEveryDays && civ.lastColonyDay >= 0) continue;
    if (civ.treasury < SOCIETY.colonyCost * 1.5) continue; // leave something in the chest
    if (Object.keys(civ.wars).length > 0) continue;
    const full = civ.settlements.map((id) => s.settlements[id]).filter((st) => st.alive && crowded(s, st));
    if (full.length === 0) continue;
    const from = full.sort((a, b) => b.housingShortage - a.housingShortage || b.population - a.population)[0];
    if (!colonySite(s, from)) continue;
    if (nextInt(s.rng.civ, 0, 99) >= SOCIETY.colonyChancePct) continue;
    foundColony(ctx, civ, from, "civ.ruler");
  }
}
