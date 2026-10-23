/**
 * Phase 4 — produce → pay → trade → tax → lifecycle (docs/03 §3). RNG stream: market.
 * All money moves through the Ledger. Quantities are integers. Rationing is proportional
 * with floor; leftovers go to buyers/sellers in id order so results are deterministic.
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
import { dailyCost, dailyRevenue, addCost, addRev } from "./books";
import { clear } from "./market";
import { lifecycle } from "./lifecycle";
import { civicBuilding } from "./lifecycle";
export { civicBuilding, founding, buildingSite } from "./lifecycle";

export function economyPhase(ctx: StepContext): void {
  dailyRevenue.clear();
  dailyCost.clear();
  produce(ctx);
  payWages(ctx);
  publicPayments(ctx);
  for (const m of ctx.s.markets) for (const good of GOODS) clear(ctx, m, good);
  lifecycle(ctx);
  houseTiers(ctx);
  itineraries(ctx);
  dividends(ctx);
  for (const b of ctx.s.businesses) {
    if (!b.alive) continue;
    const daily = (dailyRevenue.get(b.id) ?? 0) - (dailyCost.get(b.id) ?? 0);
    // ~30-day rolling profit: add today's, forget 1/30 of the running total (steady state ≈ 30 × daily)
    b.profit30 = b.profit30 + daily - Math.round(b.profit30 / 30);
  }
}

/** Homes grow with their households: a house whose residents hold over 600 / 2500 days of food money becomes tier 2 / 3. */

function houseTiers(ctx: StepContext): void {
  const { s } = ctx;
  if (s.day % 30 !== 0) return;
  const wealth = new Map<number, number>();
  for (const c of s.citizens) if (c.alive && c.home >= 0) wealth.set(c.home, (wealth.get(c.home) ?? 0) + c.wealth);
  for (const h of s.buildings) {
    if (!h.alive || h.kind !== "house") continue;
    const w = wealth.get(h.id) ?? 0;
    const food = s.markets[h.settlement]?.price.food ?? ECON.basePrice.food;
    const want: 1 | 2 | 3 = w >= food * 2500 ? 3 : w >= food * 600 ? 2 : 1;
    if (want > h.tier) {
      h.tier = want;
      emit(ctx, { type: "life.house_improved", importance: 2, settlement: h.settlement, data: { building: h.id, tier: want }, causes: ["citizen.wealth"] });
    }
  }
}

/** A private business holding more than 60 days of payroll pays half the excess to its owner every 10 days. */
function dividends(ctx: StepContext): void {
  const { s, ledger } = ctx;
  if (s.day % 10 !== 0) return;
  for (const b of s.businesses) {
    if (!b.alive || b.owner < 0 || !s.citizens[b.owner].alive) continue;
    const buffer = b.wage * Math.max(1, b.employees.length) * 60;
    const excess = b.cash - buffer;
    if (excess > 1000) {
      const paid = ledger.transfer(bizRef(b.id), citRef(b.owner), Math.floor(excess / 2), "dividend");
      addCost(b.id, paid);
    }
  }
}

// ───────────────────────── produce ─────────────────────────

function farmMoisture(s: WorldState, b: Business): number {
  const bld = s.buildings[b.building];
  const t = s.terrain;
  const { w, h } = BUILDING_SIZE[bld.kind];
  let sum = 0;
  let n = 0;
  for (let y = bld.y; y < bld.y + h; y++)
    for (let x = bld.x; x < bld.x + w; x++) {
      sum += t.moisture[y * t.width + x];
      n++;
    }
  return n ? sum / (n * 255) : 0.5;
}

/** Tech multiplier relative to the Day-0 tuning level of 30: +1 % output per 2 levels above it. */
function techFactor(s: WorldState, b: Business): number {
  const tech = s.civs[s.settlements[b.settlement].civ].tech;
  const level = b.kind === "farm" ? tech.agriculture : b.kind === "workshop" || b.kind === "factory" || b.kind === "power_plant" ? tech.industry : 30;
  return 1 + (level - 30) / 200;
}

export function productivity(s: WorldState, b: Business, workers: Citizen[]): number {
  const bld = s.buildings[b.building];
  const skill = workers.length ? workers.reduce((a, c) => a + c.skills[skillFor(b.kind)], 0) / workers.length : 0;
  let f = (0.5 + skill / 200) * (1 + b.automation / 100) * (0.5 + bld.condition / 200) * (1 + 0.15 * (bld.tier - 1)) * techFactor(s, b);
  if (b.kind === "farm") {
    // a parched field grows a quarter crop — a tenth once a drought has run fifty days and the
    // subsoil is gone (M8); an irrigated civilization keeps three quarters either way
    const m = farmMoisture(s, b);
    const irrigated = s.civs[s.settlements[b.settlement].civ].irrigated;
    const floor = s.climate.droughtDays > 50 ? 0.15 : 0.25;
    f *= irrigated ? Math.max(0.75, floor + (1 - floor) * m) : floor + (1 - floor) * m;
  }
  return f;
}

function produce(ctx: StepContext): void {
  const { s } = ctx;
  for (const b of s.businesses) {
    if (!b.alive) continue;
    // food spoils: 3 % of stock a day, so nobody can corner the market by hoarding
    if (b.inventory.food > 0) b.inventory.food -= Math.floor(b.inventory.food * 0.03);
    // wear: every building loses a point of condition each 10 days; repairs buy materials at the market
    if (s.day % 10 === b.id % 10) s.buildings[b.building].condition = clampPct(s.buildings[b.building].condition - 1);
    const workers = b.employees.map((id) => s.citizens[id]).filter((c) => c.alive && c.action === "work");
    if (b.produces === "service" || workers.length === 0) {
      b.lastOutput = 0;
      continue;
    }
    let output = Math.floor(b.baseOutput * workers.length * productivity(s, b, workers));
    // inputs cap the output
    for (const good of GOODS) {
      const per = b.inputs[good] ?? 0;
      if (per > 0) output = Math.min(output, Math.floor(b.inventory[good] / per));
    }
    const wanted = Math.floor(b.baseOutput * workers.length * productivity(s, b, workers));
    if (output < wanted && s.day % 10 === b.id % 10)
      emit(ctx, { type: "econ.input_shortage", importance: 2, businesses: [b.id], settlement: b.settlement, data: { wanted, output }, causes: ["market.supply"] });
    for (const good of GOODS) {
      const per = b.inputs[good] ?? 0;
      if (per > 0) b.inventory[good] -= per * output;
    }
    b.inventory[b.produces] += output;
    b.lastOutput = output;
    ctx.produced.set(b.id, output);
  }
}

// ───────────────────────── wages & public money ─────────────────────────

function payWages(ctx: StepContext): void {
  const { s, ledger } = ctx;
  for (const b of s.businesses) {
    if (!b.alive) continue;
    const civ = s.civs[s.settlements[b.settlement].civ];
    const workers = b.employees.map((id) => s.citizens[id]).filter((c) => c.alive && c.action === "work");
    if (workers.length === 0) {
      b.insolventDays = 0;
      continue;
    }
    const needed = b.wage * workers.length;
    const available = Math.min(needed, b.cash);
    const perWorker = Math.floor(available / workers.length);
    let shortfall = perWorker < b.wage;
    for (const c of workers) {
      const tax = pct(perWorker, civ.policies.taxRate);
      const net = perWorker - tax;
      const paidNet = ledger.transfer(bizRef(b.id), citRef(c.id), net, "wage");
      const paidTax = ledger.transfer(bizRef(b.id), trRef(civ.id), tax, "income tax");
      addCost(b.id, paidNet + paidTax);
      ctx.wagesPaid += paidNet + paidTax;
      if (paidNet + paidTax < perWorker) shortfall = true;
      // a steady wage builds the belief directly; a daily memory would crowd out everything else
      const wp = c.beliefs.find((x) => x.key === "work_pays");
      if (wp) wp.strength = clampPct(wp.strength + 1);
      else c.beliefs.push({ key: "work_pays", strength: 51 });
    }
    if (shortfall) {
      b.insolventDays++;
      const cut = Math.max(ECON.basePrice.food * 2, Math.floor(b.wage * 0.95));
      if (cut < b.wage && b.insolventDays >= 5 && b.insolventDays % 10 === 5) {
        b.wage = cut;
        emit(ctx, { type: "econ.wage_cut", importance: 4, businesses: [b.id], citizens: workers.map((c) => c.id), settlement: b.settlement, data: { wage: b.wage }, causes: ["business.cash"] });
        for (const c of workers) remember(c, { day: s.day, tag: "econ.wage_cut", valence: -25, aboutBusiness: b.id });
      }
    } else {
      b.insolventDays = 0;
      // a healthy business with open posts raises wages to attract staff (capped at 1.5× template)
      const cap = Math.floor(BUSINESS_DEFAULTS[b.kind].wage * 1.5);
      if (!PUBLIC_BUSINESSES.includes(b.kind) && b.employees.length < b.staffTarget && b.profit30 > 30 * b.wage && s.day % 10 === 0 && b.wage < cap) b.wage = Math.min(cap, Math.floor(b.wage * 1.03));
    }
  }
}

function publicPayments(ctx: StepContext): void {
  const { s, ledger } = ctx;
  for (const civ of s.civs) {
    if (!civ.alive) continue;
    const inCiv = (b: Business) => b.alive && civ.settlements.includes(b.settlement);
    const clinics = s.businesses.filter((b) => inCiv(b) && b.kind === "clinic");
    const labs = s.businesses.filter((b) => inCiv(b) && b.kind === "lab");
    const barracks = s.businesses.filter((b) => inCiv(b) && b.kind === "barracks");
    for (const b of barracks) {
      const got = ledger.transfer(trRef(civ.id), bizRef(b.id), Math.floor(civ.policies.militaryBudget / barracks.length), "military budget");
      addRev(b.id, got);
    }
    for (const c of clinics) {
      const got = ledger.transfer(trRef(civ.id), bizRef(c.id), Math.floor(civ.policies.healthBudget / clinics.length), "health budget");
      addRev(c.id, got);
    }
    for (const l of labs) {
      const got = ledger.transfer(trRef(civ.id), bizRef(l.id), Math.floor(civ.policies.researchBudget / labs.length), "research budget");
      addRev(l.id, got);
    }
    // clinic visits: a working doctor treats up to N patients a day who can pay the fee
    for (const cl of clinics) {
      const doctors = cl.employees.filter((id) => s.citizens[id].alive && s.citizens[id].action === "work").length;
      let slots = doctors * ECON.clinicPatientsPerDoctor;
      for (const c of s.citizens) {
        if (slots <= 0) break;
        if (!c.alive || c.settlement !== cl.settlement || c.health >= 70 || c.wealth < ECON.clinicFeeCents) continue;
        const paid = ledger.transfer(citRef(c.id), bizRef(cl.id), ECON.clinicFeeCents, "clinic fee");
        if (paid === ECON.clinicFeeCents) {
          c.health = clampPct(c.health + ECON.clinicHealthGain);
          addRev(cl.id, paid);
          slots--;
          ctx.visitedMarket.add(c.id); // the renderer routes them through town
        }
      }
    }
    // public businesses return cash above 30 days of payroll to the treasury every 10 days
    if (s.day % 10 === 0) {
      for (const b of s.businesses) {
        if (!b.alive || !inCiv(b) || !PUBLIC_BUSINESSES.includes(b.kind)) continue;
        const excess = b.cash - b.wage * Math.max(1, b.employees.length) * 30;
        if (excess > 0) { const got = ledger.transfer(bizRef(b.id), trRef(civ.id), excess, "public surplus"); addCost(b.id, got); }
      }
      // wealth tax: 1 % of savings above 100 days of food, every 10 days — money that sits is money that circulates
      for (const c of s.citizens) {
        if (!c.alive || !civ.settlements.includes(c.settlement)) continue;
        const threshold = (s.markets[c.settlement]?.price.food ?? ECON.basePrice.food) * 100;
        if (c.wealth > threshold) ledger.transfer(citRef(c.id), trRef(civ.id), Math.floor((c.wealth - threshold) / 100), "wealth tax");
      }
    }
    for (const c of s.citizens) {
      if (!c.alive || !civ.settlements.includes(c.settlement)) continue;
      if (c.occupation === "official") ledger.transfer(trRef(civ.id), citRef(c.id), civ.policies.officialWage, "official wage");
      else if (c.occupation === "ruler") ledger.transfer(trRef(civ.id), citRef(c.id), civ.policies.officialWage * 2, "ruler's stipend");
      else if (c.occupation === "retired") ledger.transfer(trRef(civ.id), citRef(c.id), civ.policies.pension, "pension");
      // means-tested safety net: anyone else with under ten days of food money gets the welfare payment
      else if (c.wealth < s.markets[c.settlement].price.food * 10) ledger.transfer(trRef(civ.id), citRef(c.id), civ.policies.welfare, "welfare");
    }
  }
}

// ───────────────────────── market clearing ─────────────────────────

/** Richest adult per home, computed once per clearing so a child's purchase is O(1). */

function itineraries(ctx: StepContext): void {
  const { s } = ctx;
  const civic = s.settlements.map((st) => ({
    townHall: civicBuilding(s, st.id, "town_hall"),
    lab: civicBuilding(s, st.id, "lab"),
    market: civicBuilding(s, st.id, "market"),
  }));
  for (const c of s.citizens) {
    if (!c.alive) continue;
    if (ctx.marching.has(c.id)) continue; // war.ts already routed this soldier to the enemy town
    if (c.infection === "sick") { c.itinerary = [c.home, c.home, c.home, c.home]; continue; } // the sick keep to their beds
    const { townHall, lab, market } = civic[c.settlement] ?? { townHall: -1, lab: -1, market: -1 };
    let mid = c.home;
    switch (c.action) {
      case "work": mid = c.workplace >= 0 ? s.businesses[c.workplace].building : c.home; break;
      case "seek_job": case "start_business": mid = townHall; break;
      case "study": mid = lab >= 0 ? lab : townHall; break;
      case "socialize": {
        const f = c.relationships.length ? s.citizens[c.relationships[0].other] : null;
        mid = f?.alive && f.home >= 0 ? f.home : market;
        break;
      }
      default: mid = c.home;
    }
    const shop = ctx.visitedMarket.has(c.id) ? market : mid;
    c.itinerary = [c.home, mid, shop, c.home];
  }
}

