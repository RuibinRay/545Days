/**
 * Phase 5b — diplomacy and war (M4). RNG stream: civ.
 *
 * Attitudes (-100..100) drift by disposition and events. At or below CIV.warAt a civ with the
 * soldiers to back it declares war; while at war each side raids every CIV.raidEveryDays. A raid
 * is resolved by strength (soldiers × skill × military tech, defenders ×1.25): the losers take
 * casualties, a won raid loots food and damages buildings, and a town with no soldiers that loses
 * its third raid in a row is conquered. Peace returns when attitude recovers above CIV.peaceAt or
 * one side can no longer field a soldier. A ruler's death imposes a ceasefire (ruler.ts).
 */
import { CIV } from "../data/economy";
import { treasury as trRef } from "../ledger";
import { clamp, clampPct } from "../math";
import { nextFloat, nextInt } from "../rng";
import type { Citizen, Civilization, Settlement, WorldState } from "../types";
import { GOODS } from "../types";
import { die, remember } from "./citizens";
import { civicBuilding } from "./economy";
import { emit } from "./context";
import type { StepContext } from "./context";

export function soldiersOf(s: WorldState, civ: Civilization): Citizen[] {
  const out: Citizen[] = [];
  for (const c of s.citizens) if (c.alive && c.occupation === "soldier" && civ.settlements.includes(c.settlement)) out.push(c);
  return out;
}

/** Fighting strength: each soldier counts (40 + combat) / 100, scaled by military tech. ×100 integer. */
export function strength(s: WorldState, civ: Civilization): number {
  let sum = 0;
  for (const c of soldiersOf(s, civ)) sum += 40 + c.skills.combat;
  return Math.floor(sum * (1 + civ.tech.military / 100));
}

function alivePairs(s: WorldState): [Civilization, Civilization][] {
  const out: [Civilization, Civilization][] = [];
  for (const a of s.civs) for (const b of s.civs) if (a.alive && b.alive && a.id !== b.id) out.push([a, b]);
  return out;
}

export function warPhase(ctx: StepContext): void {
  const { s } = ctx;
  for (const st of s.settlements) if (st.alive && st.fear > 0) st.fear = clampPct(st.fear - 2);
  diplomacy(ctx);
  for (const [a, b] of alivePairs(s)) {
    if (!(b.id in a.wars)) continue;
    // only a side that outguns the other in the field marches; the weaker side holds its walls
    if (s.day - a.lastRaidDay >= CIV.raidEveryDays && (s.day + a.id * 5) % CIV.raidEveryDays === 0 && strength(s, a) >= strength(s, b) * 1.2) raid(ctx, a, b);
  }
  // peace
  for (const [a, b] of alivePairs(s)) {
    if (!(b.id in a.wars) || a.id > b.id) continue;
    const exhausted = soldiersOf(s, a).length === 0 || soldiersOf(s, b).length === 0;
    const mended = a.attitude[b.id] >= CIV.peaceAt && b.attitude[a.id] >= CIV.peaceAt;
    if ((exhausted && s.day - a.wars[b.id] >= 70) || mended) makePeace(ctx, a, b, exhausted ? "war.exhaustion" : "civ.attitude");
  }
}

function diplomacy(ctx: StepContext): void {
  const { s } = ctx;
  if (s.day % 5 !== 0) return;
  for (const [a, b] of alivePairs(s)) {
    let d = 0;
    const atWar = b.id in a.wars;
    if (atWar) {
      // wars cool as they drag on: weariness grows a point per three weeks of fighting
      d += 2 + Math.floor((s.day - a.wars[b.id]) / 20);
      if (strength(s, a) > strength(s, b) * 1.3) d -= 1; // a strong aggressor stays angry longer
    } else {
      // peacetime drift toward a resting point set by disposition and, for a martial civ, by who rules it
      let rest = a.disposition === "martial" ? -40 : a.disposition === "scholarly" ? 15 : 25;
      if (a.disposition === "martial") {
        const ruler = a.ruler >= 0 ? s.citizens[a.ruler] : null;
        if (ruler?.traits.includes("cautious")) rest += 20;
        if (ruler?.traits.includes("ambitious")) rest -= 10;
        if (a.legitimacy < 50) rest += 10; // a shaky crown cannot afford adventures
      }
      d += Math.sign(rest - a.attitude[b.id]);
      // a martial civ that clearly outguns a neighbour grows ambitious — the stronger, the faster;
      // a cautious ruler needs a much bigger edge before the itch starts
      if (a.disposition === "martial") {
        const ruler = a.ruler >= 0 ? s.citizens[a.ruler] : null;
        const ratio = strength(s, a) / Math.max(1, strength(s, b));
        const edge = ruler?.traits.includes("cautious") ? 1 : 0;
        if (ratio > 2.5 + edge) d -= 3;
        else if (ratio > 1.5 + edge) d -= 2;
      }
      // anyone threatened by an armed, hostile neighbour hardens toward it
      if ((b.attitude[a.id] ?? 0) <= -30 && b.disposition === "martial") d -= 1;
    }
    a.attitude[b.id] = clamp(a.attitude[b.id] + d, -100, 100);
    a.relations[b.id] = atWar ? "embargo" : a.attitude[b.id] >= CIV.tradeAt ? "trade" : "neutral";
  }
  // declarations: the ruler's temperament sets the threshold, weak legitimacy forbids it, and even
  // then a council takes a few weeks to agree (25 % per 5 days once eligible)
  for (const [a, b] of alivePairs(s)) {
    if (b.id in a.wars || s.day < a.ceasefireUntil || Object.keys(a.wars).length > 0) continue; // one war at a time
    const ruler = a.ruler >= 0 ? s.citizens[a.ruler] : null;
    const threshold = CIV.warAt + (ruler?.traits.includes("cautious") ? -15 : 0) + (ruler?.traits.includes("ambitious") ? 8 : 0);
    if (a.attitude[b.id] > threshold || a.legitimacy < 40) continue;
    const sa = strength(s, a);
    const sb = strength(s, b);
    if (soldiersOf(s, a).length < 3 || sa < sb * 0.8) continue;
    if (nextFloat(s.rng.civ) > 0.25) continue;
    a.wars[b.id] = s.day;
    b.wars[a.id] = s.day;
    a.lastRaidDay = s.day;
    b.lastRaidDay = s.day;
    b.attitude[a.id] = clamp(Math.min(b.attitude[a.id], -60), -100, 100);
    emit(ctx, { type: "war.declared", importance: 8, civ: a.id, data: { aggressor: a.name, target: b.name, otherCiv: b.id, strength: sa, enemyStrength: sb, attitude: a.attitude[b.id] }, causes: ["civ.attitude", "civ.strength", `civ.${a.disposition}`] });
    for (const c of s.citizens) if (c.alive && (a.settlements.includes(c.settlement) || b.settlements.includes(c.settlement))) remember(c, { day: s.day, tag: "war.declared", valence: -20 });
  }
}

export function makePeace(ctx: StepContext, a: Civilization, b: Civilization, cause: string): void {
  const { s } = ctx;
  const began = a.wars[b.id];
  delete a.wars[b.id];
  delete b.wars[a.id];
  a.ceasefireUntil = Math.max(a.ceasefireUntil, s.day + CIV.ceasefireDays);
  b.ceasefireUntil = Math.max(b.ceasefireUntil, s.day + CIV.ceasefireDays);
  a.attitude[b.id] = Math.max(a.attitude[b.id], 0);
  b.attitude[a.id] = Math.max(b.attitude[a.id], 0);
  emit(ctx, { type: "war.peace", importance: 7, civ: a.id, data: { a: a.name, b: b.name, otherCiv: b.id, days: s.day - began }, causes: [cause] });
}

/** Attacker `a` marches on `b`'s first settlement. */
function raid(ctx: StepContext, a: Civilization, b: Civilization): void {
  const { s } = ctx;
  const rng = s.rng.civ;
  const target: Settlement | undefined = s.settlements[b.settlements[0]];
  if (!target || !target.alive) return;
  const attackers = soldiersOf(s, a);
  if (attackers.length === 0) return;
  const defenders = soldiersOf(s, b);
  a.lastRaidDay = s.day;
  const A = strength(s, a);
  // defenders fight at home; a town with no soldiers still has a militia of its working adults
  let D = Math.floor(strength(s, b) * 1.5);
  if (defenders.length === 0) {
    let adults = 0;
    for (const c of s.citizens) if (c.alive && c.settlement === target.id && c.occupation !== "child" && c.occupation !== "retired") adults++;
    D = Math.floor(adults * 6 * (1 + b.tech.military / 100));
  }
  const pWin = A / Math.max(1, A + D);
  const won = nextFloat(rng) < pWin;

  // soldiers march: the renderer draws them walking to the enemy town hall and back
  const hall = civicBuilding(s, target.id, "town_hall");
  for (const c of attackers) {
    c.itinerary = [c.home, hall >= 0 ? hall : c.home, hall >= 0 ? hall : c.home, c.home];
    ctx.marching.add(c.id);
  }

  // casualties: the losing side loses up to casualtyShare of its soldiers, scaled by how badly it lost
  const lossA = (won ? 0.4 : 1) * CIV.casualtyShare * (D / Math.max(1, A + D));
  const lossB = (won ? 1 : 0.4) * CIV.casualtyShare * (A / Math.max(1, A + D));
  let deadA = 0;
  let deadB = 0;
  for (const c of attackers) if (nextFloat(rng) < lossA) { die(ctx, c, "battle", ["war.raid"]); deadA++; }
  for (const c of defenders) if (nextFloat(rng) < lossB) { die(ctx, c, "battle", ["war.raid"]); deadB++; }

  let looted = 0;
  const hit: number[] = [];
  if (won) {
    // loot: a share of the town's granary (the public reserve) to the attacker's reserve
    const from = s.markets[target.id];
    const to = s.markets[a.settlements[0]];
    looted = Math.floor(from.reserve.food * CIV.lootShare);
    from.reserve.food -= looted;
    if (to) to.reserve.food += looted;
    // damage: 1–3 buildings lose condition; a building at 0 becomes a ruin
    const candidates = s.buildings.filter((bl) => bl.alive && bl.settlement === target.id && bl.kind !== "ruin");
    const n = Math.min(candidates.length, pWin > 0.7 ? 2 : 1);
    for (let i = 0; i < n && candidates.length; i++) {
      const bl = candidates.splice(nextInt(rng, 0, candidates.length - 1), 1)[0];
      bl.condition = clampPct(bl.condition - CIV.raidDamage);
      hit.push(bl.id);
      if (bl.condition <= 0) ruinBuilding(ctx, bl.id, "war.raid");
    }
    target.lostRaids++;
    b.legitimacy = clampPct(b.legitimacy - 5);
    a.legitimacy = clampPct(a.legitimacy + 2);
  } else {
    target.lostRaids = 0;
    a.legitimacy = clampPct(a.legitimacy - 4);
    b.legitimacy = clampPct(b.legitimacy + 3);
    a.attitude[b.id] = clamp(a.attitude[b.id] + 5, -100, 100); // a bloody nose cools the appetite
  }
  target.fear = clampPct(Math.max(target.fear, won ? 80 : 50));
  target.raidedDay = s.day;
  b.attitude[a.id] = clamp(b.attitude[a.id] - 10, -100, 100);
  for (const c of s.citizens) if (c.alive && c.settlement === target.id) remember(c, { day: s.day, tag: "war.raid", valence: won ? -45 : -20 });

  emit(ctx, {
    type: "war.raid", importance: 7, civ: a.id, settlement: target.id, businesses: [],
    data: { attacker: a.name, defender: b.name, otherCiv: b.id, won: won ? 1 : 0, attackers: attackers.length, defenders: defenders.length, deadAttackers: deadA, deadDefenders: deadB, looted, hit: hit.length, strength: A, enemyStrength: D },
    causes: ["war.declared", "civ.strength"],
  });

  // conquest: a town down to its last couple of soldiers that has lost four raids running changes hands
  if (won && soldiersOf(s, b).length <= 1 && target.lostRaids >= CIV.conquestRaids) conquer(ctx, a, b, target);
}

export function ruinBuilding(ctx: StepContext, buildingId: number, cause: string): void {
  const { s } = ctx;
  const bl = s.buildings[buildingId];
  if (!bl.alive || bl.kind === "ruin") return;
  const kind = bl.kind;
  if (bl.business >= 0) {
    const biz = s.businesses[bl.business];
    if (biz.alive) {
      // same path as an insolvency closure: staff out of work, cash liquidated, stock to the reserve
      biz.alive = false;
      const staff = biz.employees.map((id) => s.citizens[id]).filter((c) => c.alive);
      biz.employees = [];
      for (const c of staff) {
        c.workplace = -1;
        c.occupation = c.occupation === "child" || c.occupation === "retired" ? c.occupation : "unemployed";
        c.hiredDay = -1;
        remember(c, { day: s.day, tag: "econ.business_closed", valence: -50, aboutBusiness: biz.id });
      }
      if (biz.cash > 0) {
        const civ = s.settlements[biz.settlement].civ;
        ctx.ledger.transfer({ kind: "business", id: biz.id }, biz.owner >= 0 && s.citizens[biz.owner].alive ? { kind: "citizen", id: biz.owner } : trRef(civ), biz.cash, "liquidation");
      }
      const m = s.markets[biz.settlement];
      for (const g of GOODS) { m.reserve[g] += biz.inventory[g]; biz.inventory[g] = 0; }
      emit(ctx, { type: "econ.business_closed", importance: 6, businesses: [biz.id], citizens: staff.map((c) => c.id), settlement: biz.settlement, data: { kind: biz.kind, cause }, causes: [cause] });
    }
    bl.business = -1;
  }
  if (kind === "house") {
    for (const c of s.citizens) if (c.alive && c.home === bl.id) { c.home = -1; remember(c, { day: s.day, tag: "life.homeless", valence: -40 }); }
    bl.capacity = 0;
  }
  // the footprint shrinks to a 1×1 ruin at the old corner; the rest of the plot is free again
  bl.kind = "ruin";
  bl.tier = 1;
  bl.condition = 0;
  emit(ctx, { type: "world.building_destroyed", importance: 6, settlement: bl.settlement, data: { building: bl.id, kind }, causes: [cause] });
}

function conquer(ctx: StepContext, a: Civilization, b: Civilization, target: Settlement): void {
  const { s } = ctx;
  target.civ = a.id;
  a.settlements.push(target.id);
  a.conquests.push(target.id);
  b.settlements = b.settlements.filter((id) => id !== target.id);
  target.lostRaids = 0;
  // the old ruler is deposed; public money follows the flag
  if (b.ruler >= 0 && s.citizens[b.ruler].alive && s.citizens[b.ruler].settlement === target.id) {
    const r = s.citizens[b.ruler];
    r.occupation = "unemployed";
    r.workplace = -1;
    b.ruler = -1;
  }
  if (b.settlements.length === 0) {
    b.alive = false;
    if (b.treasury > 0) ctx.ledger.transfer(trRef(b.id), trRef(a.id), b.treasury, "spoils");
    for (const other of s.civs) { delete other.wars[b.id]; }
    b.wars = {};
  } else {
    delete a.wars[b.id];
    delete b.wars[a.id];
  }
  a.ceasefireUntil = Math.max(a.ceasefireUntil, s.day + CIV.ceasefireDays);
  a.legitimacy = clampPct(a.legitimacy + 10);
  for (const c of s.citizens) if (c.alive && c.settlement === target.id) remember(c, { day: s.day, tag: "war.conquered", valence: -60 });
  emit(ctx, { type: "war.conquest", importance: 9, civ: a.id, settlement: target.id, data: { conqueror: a.name, fallen: b.name, otherCiv: b.id, town: target.name, civAlive: b.alive ? 1 : 0 }, causes: ["war.raid", "civ.strength"] });
}
