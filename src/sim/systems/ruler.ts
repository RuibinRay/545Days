/**
 * The ruler agent (M4). Each civilization has one ruler citizen. When the ruler dies the civ
 * picks a successor and pays for it in legitimacy; a succession under collapsing legitimacy turns
 * the civ autocratic and martial (a faction can change character mid-run). Every 10 days the
 * ruler adjusts budgets by disposition and situation; every 30 days the research focus.
 * No RNG: the ruler's choices are a function of the civ's state.
 */
import { CIV, ECON } from "../data/economy";
import { clampPct } from "../math";
import type { Citizen, Civilization, WorldState } from "../types";
import { remember } from "./citizens";
import { emit } from "./context";
import type { StepContext } from "./context";
import { chooseFocus } from "./research";
import { strength } from "./war";

function civCitizens(s: WorldState, civ: Civilization): Citizen[] {
  return s.citizens.filter((c) => c.alive && civ.settlements.includes(c.settlement));
}

/** An official if one exists, else the most ambitious well-connected adult. */
function pickSuccessor(s: WorldState, civ: Civilization): Citizen | null {
  const people = civCitizens(s, civ).filter((c) => c.occupation !== "child" && c.occupation !== "retired");
  const official = people.find((c) => c.occupation === "official");
  if (official) return official;
  let best: Citizen | null = null;
  let bestScore = -1;
  for (const c of people) {
    const score = c.skills.trade + c.relationships.length * 5 + (c.traits.includes("ambitious") ? 30 : 0) + (c.traits.includes("loyal") ? 10 : 0);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

export function succession(ctx: StepContext, civ: Civilization, cause: string): void {
  const { s } = ctx;
  const old = civ.ruler >= 0 ? s.citizens[civ.ruler] : null;
  const next = pickSuccessor(s, civ);
  civ.ruler = next ? next.id : -1;
  const assassinated = cause === "civ.disappearance";
  civ.legitimacy = clampPct(civ.legitimacy + CIV.successionLegitimacy + (assassinated ? CIV.assassinationLegitimacy : 0));
  // a ruler's death halts the civ's wars for a while
  for (const otherId of Object.keys(civ.wars)) {
    const other = s.civs[Number(otherId)];
    delete civ.wars[Number(otherId)];
    delete other.wars[civ.id];
    other.ceasefireUntil = Math.max(other.ceasefireUntil, s.day + CIV.ceasefireDays / 2);
    emit(ctx, { type: "war.peace", importance: 7, civ: civ.id, data: { a: civ.name, b: other.name, otherCiv: other.id, days: 0 }, causes: ["civ.succession"] });
  }
  civ.ceasefireUntil = Math.max(civ.ceasefireUntil, s.day + CIV.ceasefireDays);
  if (next) {
    if (next.workplace >= 0) {
      const biz = s.businesses[next.workplace];
      biz.employees = biz.employees.filter((id) => id !== next.id);
      next.workplace = -1;
    }
    next.occupation = "ruler";
    next.goal = "lead";
    next.hiredDay = s.day;
  }
  let coup = 0;
  if (civ.legitimacy < 35 && civ.form !== "autocracy") {
    // a weak succession is seized by the strong: the civ turns autocratic and martial
    civ.form = "autocracy";
    civ.disposition = "martial";
    civ.policies.militaryBudget = Math.max(civ.policies.militaryBudget, 6000);
    civ.basePolicies.militaryBudget = civ.policies.militaryBudget;
    coup = 1;
  }
  for (const c of civCitizens(s, civ)) remember(c, { day: s.day, tag: "civ.succession", valence: coup ? -25 : -10 });
  emit(ctx, {
    type: coup ? "civ.coup" : "civ.succession", importance: 8, civ: civ.id, citizens: next ? [next.id] : [],
    data: { old: old?.name ?? "nobody", next: next?.name ?? "nobody", legitimacy: civ.legitimacy, form: civ.form },
    causes: [cause, "civ.legitimacy"],
  });
}

/**
 * The army is as big as the budget: each barracks' headcount target is its share of the military
 * budget divided by the soldier's wage. At war or under threat, empty posts are filled by
 * conscription — the unemployed first, then the least skilled farmers.
 */
export function conscription(ctx: StepContext, civ: Civilization, opts: { force?: boolean; max?: number } = {}): void {
  const { s } = ctx;
  const barracks = s.businesses.filter((b) => b.alive && b.kind === "barracks" && civ.settlements.includes(b.settlement));
  if (barracks.length === 0) return;
  const atWar = Object.keys(civ.wars).length > 0;
  const threatened = s.civs.some((o) => o.alive && o.id !== civ.id && (o.attitude[civ.id] ?? 0) <= -30);
  for (const b of barracks) {
    // the army is as big as the budget allows, but never more than a quarter of the town's adults
    const adults = civCitizens(s, civ).filter((c) => c.settlement === b.settlement && c.occupation !== "child" && c.occupation !== "retired").length;
    b.staffTarget = Math.max(2, Math.min(Math.floor(adults / 4 / barracks.length), Math.floor(civ.policies.militaryBudget / barracks.length / Math.max(1, b.wage))));
    if (!atWar && !threatened && !opts.force) continue;
    if (opts.force) b.staffTarget = Math.max(b.staffTarget, b.employees.length + (opts.max ?? 1));
    let open = b.staffTarget - b.employees.length;
    if (open <= 0) continue;
    const farmers = civCitizens(s, civ).filter((c) => c.occupation === "farmer" && c.settlement === b.settlement).length;
    const farmersSpare = Math.max(0, farmers - Math.ceil(civCitizens(s, civ).filter((c) => c.settlement === b.settlement).length * 0.3)); // keep three farmers per ten mouths
    const rank = (c: Citizen) => (c.occupation === "unemployed" ? 0 : c.occupation === "worker" || c.occupation === "merchant" ? 1 : c.occupation === "farmer" ? 2 : 3);
    const people = civCitizens(s, civ).filter((c) => c.settlement === b.settlement && c.occupation !== "child" && c.occupation !== "retired" && c.occupation !== "ruler" && c.occupation !== "official" && c.occupation !== "soldier" && c.occupation !== "doctor" && c.occupation !== "scientist" && c.occupation !== "engineer" && c.age < 50);
    people.sort((x, y) => rank(x) - rank(y) || x.skills.farming - y.skills.farming);
    const taken: number[] = [];
    let farmersTaken = 0;
    for (const c of people) {
      if (open <= 0 || taken.length >= (opts.max ?? 1)) break;
      if (c.occupation === "farmer") { if (farmersTaken >= farmersSpare) continue; farmersTaken++; }
      if (c.workplace >= 0) {
        const old = s.businesses[c.workplace];
        old.employees = old.employees.filter((id) => id !== c.id);
      }
      c.workplace = b.id;
      c.occupation = "soldier";
      c.hiredDay = s.day;
      b.employees.push(c.id);
      remember(c, { day: s.day, tag: "civ.conscripted", valence: -15 });
      taken.push(c.id);
      open--;
    }
    if (taken.length) emit(ctx, { type: "civ.conscription", importance: 5, civ: civ.id, settlement: b.settlement, citizens: taken, businesses: [b.id], data: { soldiers: b.employees.length, target: b.staffTarget }, causes: [opts.force ? "story.bb.reprisal" : atWar ? "war.declared" : "civ.threatened"] });
  }
}

/** Policy adjustments by disposition and situation. Budgets move 10 % at a time within 0.6–2× of base. */
export function rulerPhase(ctx: StepContext): void {
  const { s } = ctx;
  for (const civ of s.civs) {
    if (!civ.alive) continue;
    if (civ.policies.borders >= 100) civ.closedDays++; // counted daily, whoever shut the gate
    if (civ.policies.quarantine >= 100) civ.quarantineDays++;
    const rulerGone = civ.ruler >= 0 && (!s.citizens[civ.ruler].alive || s.citizens[civ.ruler].occupation !== "ruler");
    if (rulerGone || (civ.ruler < 0 && s.day % 30 === 0)) succession(ctx, civ, rulerGone && !s.citizens[civ.ruler].alive ? "life.death" : "civ.no_ruler");
    if (s.day % 30 === 0 && s.day >= civ.focusLockedUntil) {
      const f = chooseFocus(s, civ);
      if (f !== civ.researchFocus) {
        civ.researchFocus = f;
        civ.researchPool = Math.floor(civ.researchPool / 2); // retooling the lab wastes half the work in hand
        emit(ctx, { type: "civ.research_focus", importance: 4, civ: civ.id, data: { field: f }, causes: ["civ.situation", `civ.${civ.disposition}`] });
      }
    }
    if (s.day % 10 !== 0) continue;
    const p = civ.policies;
    const base = civ.basePolicies;
    conscription(ctx, civ);
    const move = (key: "militaryBudget" | "welfare" | "healthBudget" | "researchBudget", dir: 1 | -1, step = 1.1, cap = 2) => {
      const lo = Math.floor(base[key] * 0.6);
      const hi = base[key] * cap;
      p[key] = Math.max(lo, Math.min(hi, Math.floor(p[key] * (dir > 0 ? step : 1 / step)) + dir));
    };
    // taxes follow the books: raise when under 30 days of spending in hand, ease when over 200
    const dailySpend = p.researchBudget + p.healthBudget + p.militaryBudget + p.officialWage * 3 + p.pension * 8 + p.welfare * 10;
    const daysInHand = dailySpend > 0 ? civ.treasury / dailySpend : 999;
    if (daysInHand < 30 && p.taxRate < 40) { p.taxRate += 5; emit(ctx, { type: "civ.tax_change", importance: 4, civ: civ.id, data: { taxRate: p.taxRate, daysInHand: Math.round(daysInHand) }, causes: ["civ.treasury"] }); }
    else if (daysInHand > 200 && p.taxRate > base.taxRate) { p.taxRate -= 5; emit(ctx, { type: "civ.tax_change", importance: 3, civ: civ.id, data: { taxRate: p.taxRate, daysInHand: Math.round(daysInHand) }, causes: ["civ.treasury"] }); }
    const atWar = Object.keys(civ.wars).length > 0;
    const threatened = s.civs.some((o) => o.alive && o.id !== civ.id && (o.attitude[civ.id] ?? 0) <= -30 && strength(s, o) > strength(s, civ));
    // a threatened or embattled civ arms fast (25 % every 10 days, up to 3× / 4× its base budget) while it can pay
    const canPay = daysInHand > 20;
    // what a civ is willing to spend on soldiers depends on what it is: scholars arm reluctantly
    const warCap = civ.disposition === "martial" ? 3 : civ.disposition === "agrarian" ? 2.5 : 2;
    const threatCap = civ.disposition === "martial" ? 2 : civ.disposition === "agrarian" ? 2 : 1.75;
    if (atWar && canPay) move("militaryBudget", 1, 1.25, warCap);
    else if (threatened && canPay) move("militaryBudget", 1, 1.25, threatCap);
    else if (!atWar && !threatened && civ.disposition !== "martial" && p.militaryBudget > base.militaryBudget) move("militaryBudget", -1);
    if (civ.disposition === "martial" && !atWar && !threatened && canPay) {
      const weaker = s.civs.some((o) => o.alive && o.id !== civ.id && strength(s, o) < strength(s, civ));
      if (weaker) move("militaryBudget", 1, 1.1, 1.5);
    }
    let unrest = 0;
    for (const id of civ.settlements) unrest = Math.max(unrest, s.settlements[id].unrest);
    if (unrest > 50) move("welfare", 1);
    else if (unrest < 20 && p.welfare > base.welfare) move("welfare", -1);
    if (civ.disposition === "agrarian") {
      const food = s.markets[civ.settlements[0]]?.price.food ?? 300;
      p.foodReserveDays = food >= 400 ? Math.min(40, p.foodReserveDays + 5) : Math.max(base.foodReserveDays, p.foodReserveDays - 5);
    }
    if (civ.disposition === "scholarly" && civ.treasury > 90 * (p.researchBudget + p.healthBudget + p.militaryBudget)) move("researchBudget", 1);
    // plague: fund the clinic while people are sick; close the town when a tenth of it is; reopen when it passes
    const people = civCitizens(s, civ);
    const sick = people.filter((c) => c.infection === "sick" || c.infection === "incubating").length;
    const sickShare = people.length ? (100 * sick) / people.length : 0;
    if (sickShare >= 5 && canPay) move("healthBudget", 1, 1.15, 2.5);
    else if (sickShare === 0 && p.healthBudget > base.healthBudget) move("healthBudget", -1);
    const locked = (k: "quarantine" | "borders" | "exportBan") => (civ.policyLock[k] ?? -1) > s.day;
    if (sickShare >= 15 && p.quarantine < 100 && !locked("quarantine")) { p.quarantine = 100; emit(ctx, { type: "civ.quarantine", importance: 6, civ: civ.id, data: { on: 1, sick }, causes: ["health.outbreak"] }); }
    else if (sickShare < 2 && p.quarantine >= 100 && base.quarantine < 100 && !locked("quarantine")) { p.quarantine = 0; /* a quarantine the player decreed stays until the player lifts it */ emit(ctx, { type: "civ.quarantine", importance: 4, civ: civ.id, data: { on: 0, sick }, causes: ["health.recovered"] }); }
    // borders: a town with people sleeping outside or a third of its adults idle turns migrants away;
    // the gate reopens when the houses have room again — unless the player decreed it shut
    let homeless = 0;
    let adults = 0;
    let idle = 0;
    for (const c of people) {
      if (c.home < 0) homeless++;
      if (c.occupation !== "child" && c.occupation !== "retired") { adults++; if (c.occupation === "unemployed") idle++; }
    }
    const idleShare = adults ? (100 * idle) / adults : 0;
    if ((homeless >= 4 || idleShare >= 35) && p.borders < 100 && civ.migrantsIn > 0 && !locked("borders")) { p.borders = 100; emit(ctx, { type: "civ.borders", importance: 5, civ: civ.id, data: { on: 1, homeless, idle: Math.round(idleShare) }, causes: ["settlement.housing", "civ.unemployment"] }); }
    else if (homeless === 0 && idleShare < 15 && p.borders >= 100 && base.borders < 100 && !locked("borders")) { p.borders = 0; emit(ctx, { type: "civ.borders", importance: 4, civ: civ.id, data: { on: 0, homeless, idle: Math.round(idleShare) }, causes: ["settlement.housing"] }); }
    // grain: when bread is dear in any of its towns the ruler forbids food exports (its own colonies excepted);
    // the ban lifts when prices settle — unless the player decreed either way
    let dearest = 0;
    for (const id of civ.settlements) { const m = s.markets[id]; if (m && s.settlements[id].alive) dearest = Math.max(dearest, (100 * m.price.food) / ECON.basePrice.food); }
    if (dearest >= CIV.exportBanAt && p.exportBan < 100 && !locked("exportBan")) { p.exportBan = 100; emit(ctx, { type: "civ.export_ban", importance: 5, civ: civ.id, data: { on: 1, foodRatio: Math.round(dearest) }, causes: ["market.price", "civ.ruler"] }); }
    else if (dearest < CIV.exportBanLiftAt && p.exportBan >= 100 && base.exportBan < 100 && !locked("exportBan")) { p.exportBan = 0; emit(ctx, { type: "civ.export_ban", importance: 4, civ: civ.id, data: { on: 0, foodRatio: Math.round(dearest) }, causes: ["market.price"] }); }
    // the clinic hires as the budget allows (one doctor per $12 a day)
    for (const b of s.businesses) if (b.alive && b.kind === "clinic" && civ.settlements.includes(b.settlement)) b.staffTarget = Math.max(2, Math.floor(p.healthBudget / 1200));
  }
}
