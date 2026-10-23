/**
 * Business lifecycle (M2, split out in M8): hiring and layoffs, closures, founding of businesses and
 * civic buildings, building sites, and the public businesses the treasury keeps open.
 */
import { BUILDING_BUSINESS, BUILDING_SIZE, BUSINESS_DEFAULTS, PUBLIC_BUSINESSES, STARTING_INVENTORY, zeroInventory } from "../../data/buildings";
import { ECON } from "../../data/economy";
import { business as bizRef, citizen as citRef, treasury as trRef } from "../../ledger";
import { clamp, clampPct, pct } from "../../math";
import type { Building, BuildingKind, Business, BusinessKind, Citizen, Good, MarketState, Occupation, WorldState } from "../../types";
import { GOODS } from "../../types";
import { buildable, findFootprint } from "../../worldgen/settlement";
import { remember, skillFor } from "../citizens";
import { emit } from "../context";
import type { StepContext } from "../context";
const OCC_FOR: Record<BusinessKind, Occupation> = {
  farm: "farmer", workshop: "worker", factory: "worker", market: "merchant", clinic: "doctor", lab: "scientist", power_plant: "engineer", barracks: "soldier",
};


function unemploy(s: WorldState, c: Citizen): void {
  c.workplace = -1;
  c.occupation = c.occupation === "child" || c.occupation === "retired" ? c.occupation : "unemployed";
  c.hiredDay = -1;
}

function closeBusiness(ctx: StepContext, b: Business, cause: string): void {
  const { s, ledger } = ctx;
  b.alive = false;
  const staff = b.employees.map((id) => s.citizens[id]).filter((c) => c.alive);
  b.employees = [];
  for (const c of staff) {
    unemploy(s, c);
    remember(c, { day: s.day, tag: "econ.business_closed", valence: -60, aboutCitizen: c.id, aboutBusiness: b.id });
    for (const r of c.relationships) {
      const o = s.citizens[r.other];
      if (o?.alive) remember(o, { day: s.day, tag: "econ.business_closed", valence: -25, aboutCitizen: c.id, aboutBusiness: b.id });
    }
  }
  // liquidation: cash to the owner, or to the treasury for a public business
  if (b.cash > 0) {
    const civ = s.settlements[b.settlement].civ;
    ledger.transfer(bizRef(b.id), b.owner >= 0 && s.citizens[b.owner].alive ? citRef(b.owner) : trRef(civ), b.cash, "liquidation");
  }
  // unsold stock goes to the public reserve, which sells it at the market
  const m = s.markets[b.settlement];
  for (const g of GOODS) {
    m.reserve[g] += b.inventory[g];
    b.inventory[g] = 0;
  }
  s.buildings[b.building].business = -1;
  emit(ctx, { type: "econ.business_closed", importance: 6, businesses: [b.id], citizens: staff.map((c) => c.id), settlement: b.settlement, data: { kind: b.kind, cause }, causes: [cause] });
}

function newBusiness(s: WorldState, kind: BusinessKind, buildingId: number, settlement: number, owner: number): Business {
  const tpl = BUSINESS_DEFAULTS[kind];
  const b: Business = {
    id: s.businesses.length,
    alive: true,
    kind,
    building: buildingId,
    settlement,
    owner,
    employees: [],
    wage: tpl.wage,
    cash: 0,
    inventory: zeroInventory(),
    baseOutput: tpl.baseOutput,
    produces: tpl.produces,
    inputs: { ...tpl.inputs },
    automation: 0,
    profit30: 0,
    insolventDays: 0,
    lastOutput: 0,
    staffTarget: tpl.staff,
    lastLayoffDay: -1,
    lastUpgradeDay: -1,
  };
  s.businesses.push(b);
  s.buildings[buildingId].business = b.id;
  return b;
}

/** Places a new building (and its business, if the kind has one) at (x, y). Returns the building id. */
export function founding(s: WorldState, kind: BuildingKind | "house" | "warehouse", x: number, y: number, settlement: number, owner: number): number {
  const size = BUILDING_SIZE[kind];
  const bld: Building = { id: s.buildings.length, alive: true, kind, x, y, settlement, condition: 100, tier: 1, capacity: kind === "house" ? 4 : 0, business: -1 };
  s.buildings.push(bld);
  for (let yy = y; yy < y + size.h; yy++) for (let xx = x; xx < x + size.w; xx++) s.terrain.owner[yy * s.terrain.width + xx] = settlement + 1;
  const bizKind = BUILDING_BUSINESS[kind];
  if (bizKind) {
    const b = newBusiness(s, bizKind, bld.id, settlement, owner);
    b.cash = 0;
    b.inventory = { ...zeroInventory(), ...(STARTING_INVENTORY[bizKind] ?? {}) };
  }
  return bld.id;
}

/** Where a new building of `kind` would go near a settlement's centre, or null if the town has no room. */
export function buildingSite(s: WorldState, kind: BuildingKind, settlement: number): { x: number; y: number } | null {
  const st = s.settlements[settlement];
  if (!st) return null;
  const size = BUILDING_SIZE[kind];
  return findFootprint(s.terrain, occupancy(s), st.cx, st.cy, size.w, size.h, 26);
}

function occupancy(s: WorldState): Uint8Array {
  const t = s.terrain;
  const occ = new Uint8Array(t.width * t.height);
  for (const bld of s.buildings) {
    if (!bld.alive) continue;
    const { w, h } = BUILDING_SIZE[bld.kind];
    for (let y = bld.y; y < bld.y + h; y++) for (let x = bld.x; x < bld.x + w; x++) occ[y * t.width + x] = 1;
  }
  return occ;
}

function hire(ctx: StepContext, b: Business, c: Citizen): void {
  const { s } = ctx;
  if (c.workplace >= 0) {
    const old = s.businesses[c.workplace];
    old.employees = old.employees.filter((id) => id !== c.id);
  }
  c.workplace = b.id;
  c.occupation = OCC_FOR[b.kind];
  c.hiredDay = s.day;
  b.employees.push(c.id);
  remember(c, { day: s.day, tag: "econ.hired", valence: 30, aboutBusiness: b.id });
  emit(ctx, { type: "life.hired", importance: 3, citizens: [c.id], businesses: [b.id], settlement: b.settlement, causes: ["citizen.seek_job"] });
}

export function lifecycle(ctx: StepContext): void {
  const { s, ledger } = ctx;

  // layoffs: a loss-making private business that cannot cover 20 days of payroll sheds its least skilled worker
  for (const b of s.businesses) {
    if (!b.alive || PUBLIC_BUSINESSES.includes(b.kind) || b.employees.length <= 1) continue;
    const realLoss = b.profit30 < -10 * b.wage;
    const thin = b.cash < b.wage * 10 * b.employees.length;
    if (realLoss && thin && s.day - b.lastLayoffDay >= 30) {
      b.lastLayoffDay = s.day;
      const key = skillFor(b.kind);
      const staff = b.employees.map((id) => s.citizens[id]).filter((c) => c.alive && c.id !== b.owner);
      if (staff.length === 0) continue;
      let worst = staff[0];
      for (const c of staff) if (c.skills[key] < worst.skills[key]) worst = c;
      b.employees = b.employees.filter((id) => id !== worst.id);
      unemploy(s, worst);
      remember(worst, { day: s.day, tag: "econ.laid_off", valence: -40, aboutBusiness: b.id });
      emit(ctx, { type: "econ.laid_off", importance: 4, businesses: [b.id], citizens: [worst.id], settlement: b.settlement, data: { kind: b.kind, profit30: b.profit30 }, causes: ["business.profit30", "market.price"] });
    }
  }

  // closures and upgrades
  for (const b of s.businesses) {
    if (!b.alive) continue;
    if (b.insolventDays >= ECON.insolventDaysToClose && !PUBLIC_BUSINESSES.includes(b.kind)) {
      closeBusiness(ctx, b, "econ.insolvent");
      continue;
    }
    const bld = s.buildings[b.building];
    const matured = s.day - Math.max(b.lastUpgradeDay, 0) >= 60;
    if (bld.tier < 3 && matured && b.profit30 > ECON.upgradeProfitDays * b.wage && b.cash >= ECON.upgradeCostCents + 30 * b.wage && b.employees.length >= b.staffTarget) {
      const civ = s.settlements[b.settlement].civ;
      const paid = ledger.transfer(bizRef(b.id), trRef(civ), ECON.upgradeCostCents, "upgrade permit");
      if (paid === ECON.upgradeCostCents) {
        bld.tier = (bld.tier + 1) as 1 | 2 | 3;
        b.staffTarget += 1;
        b.lastUpgradeDay = s.day; // capital expense: not counted against operating profit
        emit(ctx, { type: "econ.business_upgraded", importance: 4, businesses: [b.id], settlement: b.settlement, data: { kind: b.kind, tier: bld.tier }, causes: ["business.profit30"] });
      }
    }
  }

  // hiring: each business with an opening takes the most skilled seeker it can afford
  const seekers = ctx.jobSeekers.map((id) => s.citizens[id]).filter((c) => c.alive);
  for (const b of s.businesses) {
    if (!b.alive || b.employees.length >= b.staffTarget || b.cash < b.wage * 20) continue;
    const key = skillFor(b.kind);
    let best: Citizen | null = null;
    for (const c of seekers) {
      if (c.settlement !== b.settlement) continue; // jobs are where you live (colonies made this matter)
      if (c.workplace === b.id) continue;
      if (c.workplace >= 0 && s.businesses[c.workplace].wage >= b.wage) continue; // not a raise
      if (!best || c.skills[key] > best.skills[key]) best = c;
    }
    if (best) {
      hire(ctx, b, best);
      seekers.splice(seekers.indexOf(best), 1);
    }
  }

  // founding: the good with the highest price relative to base decides the kind
  for (const id of ctx.founders) {
    const c = s.citizens[id];
    if (!c.alive || c.wealth < ECON.startupCostCents) continue;
    const m = s.markets[c.settlement];
    const foodRatio = m.price.food / ECON.basePrice.food;
    const matRatio = m.price.materials / ECON.basePrice.materials;
    const kind: BusinessKind = foodRatio >= matRatio ? "farm" : "workshop";
    const buildingKind = kind;
    // reuse an empty building of the same kind first
    let bld = s.buildings.find((x) => x.alive && x.kind === buildingKind && x.business === -1 && x.settlement === c.settlement);
    let b: Business;
    if (!bld) {
      const st = s.settlements[c.settlement];
      const size = BUILDING_SIZE[buildingKind];
      const spot = findFootprint(s.terrain, occupancy(s), st.cx, st.cy, size.w, size.h, 14);
      if (!spot || !buildable(s.terrain, spot.x, spot.y)) continue;
      const id = founding(s, buildingKind, spot.x, spot.y, c.settlement, c.id);
      bld = s.buildings[id];
      b = s.businesses[bld.business];
    } else b = newBusiness(s, kind, bld.id, c.settlement, c.id);
    ledger.transfer(citRef(c.id), bizRef(b.id), ECON.startupCostCents, "startup capital");
    hire(ctx, b, c);
    remember(c, { day: s.day, tag: "econ.business_opened", valence: 40, aboutBusiness: b.id });
    for (const r of c.relationships) {
      const o = s.citizens[r.other];
      if (o?.alive) remember(o, { day: s.day, tag: "econ.business_opened", valence: 10, aboutCitizen: c.id, aboutBusiness: b.id });
    }
    emit(ctx, { type: "econ.business_opened", importance: 5, businesses: [b.id], citizens: [c.id], settlement: c.settlement, data: { kind, foodRatio: Math.round(foodRatio * 100), matRatio: Math.round(matRatio * 100) }, causes: ["citizen.start_business", "market.price"] });
  }
}

// ───────────────────────── itineraries (for the renderer only) ─────────────────────────

export function civicBuilding(s: WorldState, settlement: number, kind: "town_hall" | "lab" | "market"): number {
  for (const b of s.buildings) if (b.alive && b.settlement === settlement && b.kind === kind) return b.id;
  return -1;
}

