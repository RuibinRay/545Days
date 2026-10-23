/**
 * Phase 6 — missions and procedural events (M4). RNG stream: story.
 *
 * A mission is an offer the Oracle makes from the world's present state: a named target, a brief,
 * one action, and a deadline. Accepting applies ordinary interventions; declining applies nothing.
 * Either way the world simply continues, so the consequence of a choice is whatever the simulation
 * does next — the Worker shows a forecast of both branches, computed by replaying forward.
 *
 * Procedural events are small seeded surprises (fire, bumper harvest, trader, bandits, festival)
 * that keep a quiet world moving; they are deliberately rare and never decisive on their own.
 */
import { BUILD_COST } from "../data/buildings";
import { CIV, ECON } from "../data/economy";
import { clampPct } from "../math";
import { nextFloat, nextInt } from "../rng";
import type { Business, Citizen, Civilization, Intervention, Mission, WorldState } from "../types";
import { rulerTitle } from "../worldgen/names";
import { remember } from "./citizens";
import { emit } from "./context";
import type { StepContext } from "./context";
import { ruinBuilding, soldiersOf, strength } from "./war";
import { buildingSite } from "./economy";
import { colonySite, crowded } from "./society";
import { SOCIETY } from "../data/economy";

type Draft = Omit<Mission, "id" | "offeredDay" | "expiresDay" | "status" | "resolvedDay">;

const URGENT = new Set(["quarantine", "fund_clinic", "stock_reserve", "build_warehouse", "broker_peace", "open_borders", "lift_export_ban"]);

function labLead(s: WorldState, civ: Civilization): { lead: Citizen; lab: Business } | null {
  let best: { lead: Citizen; lab: Business } | null = null;
  for (const b of s.businesses) {
    if (!b.alive || b.kind !== "lab" || !civ.settlements.includes(b.settlement)) continue;
    for (const id of b.employees) {
      const c = s.citizens[id];
      if (c.alive && (!best || c.skills.science > best.lead.skills.science)) best = { lead: c, lab: b };
    }
  }
  return best;
}

function town(s: WorldState, civ: Civilization): string {
  return s.settlements[civ.settlements[0]]?.name ?? civ.name;
}

function rulerOf(s: WorldState, civ: Civilization): Citizen | null {
  return civ.ruler >= 0 && s.citizens[civ.ruler].alive ? s.citizens[civ.ruler] : null;
}

function largest(s: WorldState, civ: Civilization, kind: Business["kind"]): Business | null {
  let best: Business | null = null;
  for (const b of s.businesses) {
    if (!b.alive || b.kind !== kind || !civ.settlements.includes(b.settlement)) continue;
    const score = s.buildings[b.building].tier * 1000 + b.employees.length * 10 + b.inventory.food;
    const bestScore = best ? s.buildings[best.building].tier * 1000 + best.employees.length * 10 + best.inventory.food : -1;
    if (score > bestScore) best = b;
  }
  return best;
}

function enemyOf(s: WorldState, civ: Civilization): Civilization | null {
  let worst: Civilization | null = null;
  for (const o of s.civs) {
    if (!o.alive || o.id === civ.id) continue;
    if (!worst || (civ.attitude[o.id] ?? 0) < (civ.attitude[worst.id] ?? 0)) worst = o;
  }
  return worst;
}

/** Every mission the present state supports. Order is stable; the story RNG picks among them. */
export function candidateMissions(s: WorldState): Draft[] {
  const out: Draft[] = [];
  const recent = new Set(s.story.missions.filter((m) => s.day - m.offeredDay < 120).map((m) => m.template));
  const push = (d: Draft) => { if (!recent.has(d.template)) out.push(d); };

  for (const civ of s.civs) {
    if (!civ.alive) continue;
    const t = town(s, civ);
    const lead = labLead(s, civ);
    const ruler = rulerOf(s, civ);
    const enemy = enemyOf(s, civ);
    const atWar = Object.keys(civ.wars).length > 0;

    if (lead && civ.tech.automation >= 40) {
      push({
        template: "remove_researcher", civ: civ.id, targets: { citizen: lead.lead.id, business: lead.lab.id },
        title: `The researcher of ${t}`,
        brief: `${civ.name} is pushing automation (level ${civ.tech.automation}, risk ${civ.tech.machineAutonomyRisk}). The work is led by ${lead.lead.name}, a scientist at the lab in ${t}. The Oracle sees relays that answer to no one.`,
        action: `Remove ${lead.lead.name}. The lab loses its lead; the council loses face.`,
        effects: [{ type: "remove_citizen", citizen: lead.lead.id }],
      });
      if (civ.policies.oversight < 50) push({
        template: "oversight_law", civ: civ.id, targets: { business: lead.lab.id },
        title: `An oversight law for ${t}`,
        brief: `${civ.name}'s automation research runs with almost no review (oversight ${civ.policies.oversight}). A law would slow the lab and hold the risk down without touching anyone.`,
        action: `Set ${civ.name}'s oversight to 70. Automation research slows by a third.`,
        effects: [{ type: "set_policy", civ: civ.id, key: "oversight", value: 70 }],
      });
      if (civ.tech.automation >= 60) push({
        template: "raze_lab", civ: civ.id, targets: { building: lead.lab.building, business: lead.lab.id },
        title: `The lab at ${t}`,
        brief: `The machines of ${civ.name} are close to running themselves (automation ${civ.tech.automation}). The Oracle offers a blunter instrument than a law.`,
        action: `Destroy the lab in ${t}. Its scientists lose their work; research stops until it is rebuilt.`,
        effects: [{ type: "destroy_building", building: lead.lab.building }],
      });
    }

    if (ruler && enemy && ((civ.attitude[enemy.id] ?? 0) <= -30 || atWar) && civ.disposition === "martial") {
      push({
        template: "depose_ruler", civ: civ.id, targets: { citizen: ruler.id, otherCiv: enemy.id },
        title: `The ${rulerTitle(civ.disposition).toLowerCase()} of ${t}`,
        brief: `${rulerTitle(civ.disposition)} ${ruler.name} of ${civ.name} ${atWar ? "is at war with" : "is turning against"} ${enemy.name} (attitude ${civ.attitude[enemy.id]}). ${civ.name} fields ${soldiersOf(s, civ).length} soldiers to ${enemy.name}'s ${soldiersOf(s, enemy).length}.`,
        action: `Remove ${ruler.name}. A successor takes over, the wars pause for ${CIV.ceasefireDays / 2} days, and ${civ.name}'s legitimacy falls.`,
        effects: [{ type: "remove_citizen", citizen: ruler.id }],
      });
      const farm = largest(s, civ, "farm");
      if (farm) push({
        template: "raze_farm", civ: civ.id, targets: { building: farm.building, business: farm.id, otherCiv: enemy.id },
        title: `The granary of ${t}`,
        brief: `${civ.name}'s soldiers eat from the fields of ${t}. Its largest farm feeds the army that threatens ${enemy.name}.`,
        action: `Destroy the farm. Food in ${t} gets dear; hungry soldiers desert and the ruler loses standing.`,
        effects: [{ type: "destroy_building", building: farm.building }],
      });
    }
    if (atWar) {
      const barracks = largest(s, civ, "barracks");
      if (barracks && soldiersOf(s, civ).length >= 3) push({
        template: "raze_barracks", civ: civ.id, targets: { building: barracks.building, business: barracks.id },
        title: `The barracks of ${t}`,
        brief: `${civ.name} is at war and its soldiers drill at the barracks in ${t} (strength ${strength(s, civ)}).`,
        action: `Destroy the barracks. The soldiers are out of work; ${civ.name} cannot raid until it builds another.`,
        effects: [{ type: "destroy_building", building: barracks.building }],
      });
      for (const otherId of Object.keys(civ.wars)) {
        const other = s.civs[Number(otherId)];
        if (!other.alive || other.id < civ.id || s.day - civ.wars[other.id] < 10) continue;
        push({
          template: "broker_peace", civ: civ.id, targets: { otherCiv: other.id },
          title: `Peace between ${t} and ${town(s, other)}`,
          brief: `${civ.name} and ${other.name} have been at war for ${s.day - civ.wars[other.id]} days. The Oracle can turn both councils toward peace — for now.`,
          action: `Set both attitudes to +40. The war ends; a ceasefire holds for ${CIV.ceasefireDays} days.`,
          effects: [{ type: "set_attitude", civ: civ.id, other: other.id, value: 40 }, { type: "set_attitude", civ: other.id, other: civ.id, value: 40 }],
        });
      }
    }

    // the threatened: arm a civ a martial neighbour is eyeing
    const threat = s.civs.find((o) => o.alive && o.id !== civ.id && (o.attitude[civ.id] ?? 0) <= -25 && strength(s, o) > strength(s, civ) * 1.3);
    if (threat) {
      const hasBarracks = s.businesses.some((b) => b.alive && b.kind === "barracks" && civ.settlements.includes(b.settlement));
      const st = s.settlements[civ.settlements[0]];
      if (!hasBarracks && civ.treasury >= (BUILD_COST.barracks ?? 0) && buildingSite(s, "barracks", st.id)) push({
        template: "arm_civ", civ: civ.id, targets: { otherCiv: threat.id, settlement: st.id },
        title: `Arm ${t}`,
        brief: `${threat.name} outguns ${civ.name} (${strength(s, threat)} to ${strength(s, civ)}) and its mood is turning (${threat.attitude[civ.id]}). ${t} has no barracks.`,
        action: `Build a barracks in ${t} from ${civ.name}'s treasury and double its military budget.`,
        effects: [{ type: "build", kind: "barracks", x: st.cx, y: st.cy, settlement: st.id }, { type: "set_policy", civ: civ.id, key: "militaryBudget", value: civ.basePolicies.militaryBudget * 2 }],
      });
      else if (hasBarracks) push({
        template: "arm_civ", civ: civ.id, targets: { otherCiv: threat.id, settlement: st.id },
        title: `Arm ${t}`,
        brief: `${threat.name} outguns ${civ.name} (${strength(s, threat)} to ${strength(s, civ)}) and its mood is turning (${threat.attitude[civ.id]}).`,
        action: `Double ${civ.name}'s military budget so the barracks can hire.`,
        effects: [{ type: "set_policy", civ: civ.id, key: "militaryBudget", value: civ.basePolicies.militaryBudget * 2 }],
      });
    }

    // the hungry: stock the reserve
    for (const stId of civ.settlements) {
      const m = s.markets[stId];
      const st = s.settlements[stId];
      if (!m || !st.alive) continue;
      if ((m.price.food >= ECON.basePrice.food * 1.25 || s.climate.droughtDays > 0) && civ.policies.foodReserveDays < 30) {
        push({
          template: "stock_reserve", civ: civ.id, targets: { settlement: stId },
          title: `The granary of ${st.name}`,
          brief: `Food in ${st.name} costs ${(m.price.food / 100).toFixed(2)} a unit${s.climate.droughtDays > 0 ? ` and the drought has ${s.climate.droughtDays} days to run` : ""}. The public reserve holds ${m.reserve.food} units for ${st.population} people.`,
          action: `Set ${civ.name}'s reserve target to 30 days. The treasury buys food while it is affordable and sells when it is dear.`,
          effects: [{ type: "set_policy", civ: civ.id, key: "foodReserveDays", value: 30 }],
        });
        break;
      }
    }

    // plague: close the gates before it crosses the river
    const inCiv = s.citizens.filter((c) => c.alive && civ.settlements.includes(c.settlement));
    const sick = inCiv.filter((c) => c.infection === "sick" || c.infection === "incubating").length;
    if (sick >= 2 && civ.policies.quarantine < 100) push({
      template: "quarantine", civ: civ.id, targets: { settlement: civ.settlements[0] },
      title: `Close the gates of ${t}`,
      brief: `${sick} people in ${t} are down with a fever that travels with merchants. ${s.civs.filter((o) => o.alive && o.id !== civ.id).map((o) => o.name).join(" and ")} still trade with it.`,
      action: `Quarantine ${civ.name}: no travellers in or out until the fever passes. Trade and migration stop; the ruler lifts it when fewer than one in fifty is sick.`,
      effects: [{ type: "set_policy", civ: civ.id, key: "quarantine", value: 100 }],
    });
    // drought: a warehouse, or the lab onto irrigation
    const droughtFired = s.story.fired.some((f) => f.id === `gd.first_drought@${civ.id}`) || s.climate.droughtDays > 0;
    if (droughtFired) {
      const st = s.settlements[civ.settlements[0]];
      const hasWarehouse = s.buildings.some((b) => b.alive && b.kind === "warehouse" && civ.settlements.includes(b.settlement));
      if (!hasWarehouse && civ.treasury >= (BUILD_COST.warehouse ?? 0) && buildingSite(s, "warehouse", st.id)) push({
        template: "build_warehouse", civ: civ.id, targets: { settlement: st.id },
        title: `A warehouse for ${t}`,
        brief: `The rains have failed once over ${t} and the granary holds ${s.markets[st.id]?.reserve.food ?? 0} units. A warehouse doubles what it can hold and how fast it fills.`,
        action: `Build a warehouse in ${t} from ${civ.name}'s treasury and raise the reserve target to 30 days.`,
        effects: [{ type: "build", kind: "warehouse", x: st.cx, y: st.cy, settlement: st.id }, { type: "set_policy", civ: civ.id, key: "foodReserveDays", value: 30 }],
      });
      if (!civ.irrigated && civ.researchFocus !== "agriculture") push({
        template: "irrigate", civ: civ.id, targets: { settlement: st.id },
        title: `Channels for ${t}`,
        brief: `${civ.name}'s lab works on ${civ.researchFocus}; its fields depend on the rain. Irrigation comes with agriculture at level 60 (now ${civ.tech.agriculture}).`,
        action: `Turn ${civ.name}'s lab to agriculture for 120 days and double its research budget.`,
        effects: [{ type: "set_focus", civ: civ.id, field: "agriculture" }, { type: "set_policy", civ: civ.id, key: "researchBudget", value: civ.basePolicies.researchBudget * 2 }],
      });
    }

    // the sick: fund the clinic
    let h = 0;
    let n = 0;
    for (const c of s.citizens) if (c.alive && civ.settlements.includes(c.settlement)) { h += c.health; n++; }
    if ((n > 0 && h / n < 70) || sick >= 5) push({
      template: "fund_clinic", civ: civ.id, targets: { settlement: civ.settlements[0] },
      title: `The clinic of ${t}`,
      brief: `${sick >= 5 ? `${sick} people in ${civ.name} are down with the fever and the clinic has ${s.businesses.filter((b) => b.alive && b.kind === "clinic" && civ.settlements.includes(b.settlement)).reduce((a, b) => a + b.employees.length, 0)} doctors.` : `Average health in ${civ.name} is ${Math.round(h / n)}.`} The clinic's budget is $${(civ.policies.healthBudget / 100).toFixed(0)} a day; a treatment comes with medicine at 60 or a budget of $36.`,
      action: `Double ${civ.name}'s health budget. More doctors see more of the sick; fewer of them die.`,
      effects: [{ type: "set_policy", civ: civ.id, key: "healthBudget", value: Math.max(civ.basePolicies.healthBudget * 2, 3600) }],
    });

    // ───── society (M7): gates, grain and new towns ─────
    const hungryNeighbour = s.civs.find((o) => o.alive && o.id !== civ.id && !(o.id in civ.wars) && (s.markets[o.settlements[0]]?.price.food ?? 0) >= ECON.basePrice.food * 1.5);
    const foodHere = (s.markets[civ.settlements[0]]?.price.food ?? ECON.basePrice.food) / ECON.basePrice.food;
    if (civ.policies.borders >= 100 && hungryNeighbour) push({
      template: "open_borders", civ: civ.id, targets: { settlement: civ.settlements[0], otherCiv: hungryNeighbour.id },
      title: `The gate of ${t}`,
      brief: `${civ.name} has shut its borders; bread in ${town(s, hungryNeighbour)} costs ${Math.round((100 * (s.markets[hungryNeighbour.settlements[0]]?.price.food ?? 0)) / ECON.basePrice.food)}% of its usual price and families are on the road. ${civ.name} has turned ${civ.migrantsIn > 0 ? "newcomers" : "people"} away before.`,
      action: `Open ${civ.name}'s borders for 120 days. The hungry come in; they need beds and work ${civ.name} may not have.`,
      effects: [{ type: "set_policy", civ: civ.id, key: "borders", value: 0 }],
    });
    let homelessHere = 0;
    for (const c of s.citizens) if (c.alive && c.home < 0 && civ.settlements.includes(c.settlement)) homelessHere++;
    if (civ.policies.borders < 100 && civ.migrantsIn >= 5 && homelessHere >= 3) push({
      template: "close_gates", civ: civ.id, targets: { settlement: civ.settlements[0] },
      title: `Strangers in ${t}`,
      brief: `${civ.migrantsIn} people have come to ${civ.name} from other nations and ${homelessHere} of them sleep outside. The council's own people grumble about wages and beds.`,
      action: `Shut ${civ.name}'s borders for 120 days. Nobody else gets in; those outside the gate go hungry somewhere else.`,
      effects: [{ type: "set_policy", civ: civ.id, key: "borders", value: 100 }],
    });
    if (civ.policies.exportBan >= 100 && hungryNeighbour && foodHere < 1.3) push({
      template: "lift_export_ban", civ: civ.id, targets: { settlement: civ.settlements[0], otherCiv: hungryNeighbour.id },
      title: `The grain of ${t}`,
      brief: `${civ.name} forbids its farmers to sell abroad while ${hungryNeighbour.name} pays ${Math.round((100 * (s.markets[hungryNeighbour.settlements[0]]?.price.food ?? 0)) / ECON.basePrice.food)}% of base for bread. Food in ${t} costs ${Math.round(100 * foodHere)}%.`,
      action: `Lift ${civ.name}'s export ban for 120 days. Caravans leave with grain; prices in ${t} rise a little.`,
      effects: [{ type: "set_policy", civ: civ.id, key: "exportBan", value: 0 }],
    });
    const first = s.settlements[civ.settlements[0]];
    if (first?.alive && civ.settlements.length < SOCIETY.maxSettlements && crowded(s, first) && civ.treasury >= SOCIETY.colonyCost && !atWar && colonySite(s, first)) push({
      template: "found_colony", civ: civ.id, targets: { settlement: first.id },
      title: `New land for ${t}`,
      brief: `${t} is full: ${first.housingShortage} people sleep outside and the houses hold no more. ${civ.name}'s treasury has $${(civ.treasury / 100).toFixed(0)}; a colony costs $${(SOCIETY.colonyCost / 100).toFixed(0)}.`,
      action: `Found a colony a day's walk away: three houses, two farms, a market, and the homeless and jobless of ${t} as settlers.`,
      effects: [{ type: "found_colony", civ: civ.id, from: first.id }],
    });
    const neutral = s.civs.find((o) => o.alive && o.id !== civ.id && civ.relations[o.id] === "neutral" && o.relations[civ.id] !== "embargo" && !(o.id in civ.wars) && (civ.attitude[o.id] ?? 0) >= -20);
    if (neutral && civ.disposition !== "martial") push({
      template: "open_trade", civ: civ.id, targets: { settlement: civ.settlements[0], otherCiv: neutral.id },
      title: `A road between ${t} and ${town(s, neutral)}`,
      brief: `${civ.name} and ${neutral.name} are neither friends nor enemies (attitude ${civ.attitude[neutral.id] ?? 0}); their merchants do not trade. Each has what the other pays dearly for.`,
      action: `Warm both councils to ${CIV.tradeAt + 10}. Caravans start when a good is a quarter dearer across the road.`,
      effects: [{ type: "set_attitude", civ: civ.id, other: neutral.id, value: CIV.tradeAt + 10 }, { type: "set_attitude", civ: neutral.id, other: civ.id, value: CIV.tradeAt + 10 }],
    });
  }
  return out;
}

export function missionsPhase(ctx: StepContext): void {
  const { s } = ctx;
  const rng = s.rng.story;
  // expiry
  for (const m of s.story.missions) {
    if (m.status === "offered" && s.day > m.expiresDay) {
      m.status = "expired";
      m.resolvedDay = s.day;
      emit(ctx, { type: "story.mission_expired", importance: 5, civ: m.civ, data: { mission: m.id, title: m.title }, causes: ["player.silence"] });
    }
  }
  // offer
  const open = s.story.missions.some((m) => m.status === "offered");
  if (!open && s.day >= s.story.nextMissionDay) {
    const cands = candidateMissions(s);
    if (cands.length > 0) {
      // a fever or a failed harvest will not wait: urgent offers come first
      const urgent = cands.filter((c) => URGENT.has(c.template));
      const pool = urgent.length ? urgent : cands;
      const d = pool[nextInt(rng, 0, pool.length - 1)];
      const m: Mission = { ...d, id: s.story.missions.length, offeredDay: s.day, expiresDay: s.day + CIV.missionOpenDays, status: "offered", resolvedDay: -1 };
      s.story.missions.push(m);
      emit(ctx, { type: "story.mission_offered", importance: 8, civ: m.civ, citizens: m.targets.citizen !== undefined ? [m.targets.citizen] : [], data: { mission: m.id, title: m.title, template: m.template }, causes: ["oracle.state"] });
    }
    s.story.nextMissionDay = s.day + CIV.missionEveryDays + nextInt(rng, 0, CIV.missionJitterDays);
  }
  proceduralEvents(ctx);
}

/** Applies the player's answer to a mission (intervention `mission`). */
export function resolveMission(ctx: StepContext, id: number, accept: boolean, apply: (iv: Intervention) => void): void {
  const { s } = ctx;
  const m = s.story.missions[id];
  if (!m) throw new Error(`mission ${id} does not exist`);
  if (m.status !== "offered") throw new Error(`mission ${id} is already ${m.status}`);
  m.status = accept ? "accepted" : "declined";
  m.resolvedDay = s.day;
  emit(ctx, { type: accept ? "story.mission_accepted" : "story.mission_declined", importance: 7, civ: m.civ, data: { mission: m.id, title: m.title, template: m.template }, causes: ["player.choice"] });
  if (accept) for (const e of m.effects) apply({ ...e, day: s.day } as Intervention);
}

function proceduralEvents(ctx: StepContext): void {
  const { s } = ctx;
  const rng = s.rng.story;
  for (const st of s.settlements) {
    if (!st.alive || st.population === 0) continue;
    const r = nextFloat(rng);
    if (r < 1 / 300) {
      // fire
      const bld = s.buildings.filter((b) => b.alive && b.settlement === st.id && b.kind !== "ruin" && b.kind !== "farm");
      if (bld.length) {
        const b = bld[nextInt(rng, 0, bld.length - 1)];
        b.condition = clampPct(b.condition - 40);
        emit(ctx, { type: "world.fire", importance: 5, settlement: st.id, data: { building: b.id, kind: b.kind, condition: b.condition }, causes: ["chance"] });
        if (b.condition <= 0) ruinBuilding(ctx, b.id, "world.fire");
      }
    } else if (r < 1 / 300 + 1 / 150) {
      const farms = s.businesses.filter((b) => b.alive && b.kind === "farm" && b.settlement === st.id);
      if (farms.length) {
        const f = farms[nextInt(rng, 0, farms.length - 1)];
        f.inventory.food += 30;
        emit(ctx, { type: "world.bumper_harvest", importance: 3, settlement: st.id, businesses: [f.id], data: { food: 30 }, causes: ["chance", "env.moisture"] });
      }
    } else if (r < 1 / 300 + 1 / 150 + 1 / 200) {
      const m = s.markets[st.id];
      m.reserve.materials += 15;
      m.reserve.energy += 10;
      emit(ctx, { type: "world.trader", importance: 3, settlement: st.id, data: { materials: 15, energy: 10 }, causes: ["chance"] });
    } else if (r < 1 / 300 + 1 / 150 + 1 / 200 + 1 / 400) {
      const civ = s.civs[st.civ];
      const guarded = soldiersOf(s, civ).length > 0;
      const m = s.markets[st.id];
      const stolen = guarded ? 0 : Math.floor(m.reserve.food * 0.2);
      m.reserve.food -= stolen;
      st.fear = clampPct(Math.max(st.fear, guarded ? 20 : 40));
      for (const c of s.citizens) if (c.alive && c.settlement === st.id) remember(c, { day: s.day, tag: "world.bandits", valence: guarded ? -5 : -20 });
      emit(ctx, { type: "world.bandits", importance: 5, settlement: st.id, data: { repelled: guarded ? 1 : 0, stolen }, causes: ["chance", guarded ? "civ.soldiers" : "civ.no_soldiers"] });
    }
    if ((s.day + st.id * 29) % 120 === 60) {
      for (const c of s.citizens) if (c.alive && c.settlement === st.id) c.needs.belonging = clampPct(c.needs.belonging + 20);
      emit(ctx, { type: "world.festival", importance: 3, settlement: st.id, data: {}, causes: ["calendar"] });
    }
  }
}
