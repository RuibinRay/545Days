/**
 * Mission harness (docs/08 M4): does answering the Oracle change the world?
 * Runs each seed three ways — ignore every offer, accept every offer, accept only the
 * non-violent ones — and prints the ending tables and the deaths.
 * Usage: npx tsx tools/missions-harness.ts [seeds=20]
 */
import { SOCIETY } from "../src/sim/data/economy";
import { colonySite, crowded } from "../src/sim/systems/society";
import { generateWorld } from "../src/sim/worldgen";
import { interventionCost, isTerminal, step } from "../src/sim/engine";
import { resolveEnding } from "../src/sim/story/endings";
import type { DailyMetrics, Intervention, WorldEvent } from "../src/sim/types";

const seeds = Number(process.argv[2] ?? 20);
const VIOLENT = new Set(["remove_researcher", "depose_ruler", "raze_farm", "raze_barracks", "raze_lab"]);

/**
 * M7 adds two scripted players beyond the three mission policies: "builder" accepts peaceful offers and
 * also spends Influence directly on colonies, open borders and open roads; "closer" shuts every border
 * and bans every export on day 30 and renews the decrees — the fortress strategy.
 */
type Policy = "ignore" | "accept" | "peaceful" | "builder" | "closer" | "technophile";
const SOCIAL = new Set(["open_trade", "found_colony", "open_borders", "lift_export_ban", "broker_peace", "stock_reserve", "build_warehouse", "fund_clinic", "quarantine", "irrigate", "oversight_law"]);

function play(seed: number, policy: Policy) {
  const w = generateWorld(seed * 7919, { civs: 3, population: 100 });
  const events: WorldEvent[] = [];
  const metrics: DailyMetrics[] = [];
  let answered = 0;
  let accepted = 0;
  const byTemplate: Record<string, number> = {};
  for (let d = 1; d <= 545; d++) {
    const ivs: Intervention[] = [];
    const open = w.story.missions.find((m) => m.status === "offered");
    if (open && policy !== "ignore") {
      const accept = policy === "accept" || (policy === "builder" ? SOCIAL.has(open.template) : policy === "closer" ? open.template === "close_gates" || open.template === "stock_reserve" || open.template === "build_warehouse" : !VIOLENT.has(open.template));
      const cost = interventionCost({ type: "mission", mission: open.id, accept }, w.story.missions);
      if (!accept || cost <= w.story.influence) {
        ivs.push({ day: d, type: "mission", mission: open.id, accept });
        answered++;
        if (accept) { accepted++; byTemplate[open.template] = (byTemplate[open.template] ?? 0) + 1; }
      } // otherwise wait for Influence (the offer stays open 20 days)
    }
    if (policy === "builder" && d % 10 === 0) {
      for (const civ of w.civs) {
        if (!civ.alive) continue;
        const first = w.settlements[civ.settlements[0]];
        if (first?.alive && civ.settlements.length < SOCIETY.maxSettlements && crowded(w, first) && civ.treasury >= SOCIETY.colonyCost && Object.keys(civ.wars).length === 0 && colonySite(w, first) && w.story.influence >= 10) { ivs.push({ day: d, type: "found_colony", civ: civ.id, from: first.id }); w.story.influence -= 0; break; }
        if (civ.policies.borders >= 100 && (civ.policyLock.borders ?? -1) <= d && w.story.influence >= 8) { ivs.push({ day: d, type: "set_policy", civ: civ.id, key: "borders", value: 0 }); break; }
        if (civ.policies.exportBan >= 100 && (civ.policyLock.exportBan ?? -1) <= d && w.story.influence >= 8) { ivs.push({ day: d, type: "set_policy", civ: civ.id, key: "exportBan", value: 0 }); break; }
      }
    }
    if (policy === "technophile" && d >= 20 && d % 10 === 0) {
      // every lab to automation with no oversight and a big budget, renewed when the focus lock lapses
      for (const civ of w.civs) {
        if (!civ.alive || w.story.influence < 8) continue;
        if (civ.researchFocus !== "automation" && d >= civ.focusLockedUntil) { ivs.push({ day: d, type: "set_focus", civ: civ.id, field: "automation" }); break; }
        if (civ.basePolicies.researchBudget < 12000) { ivs.push({ day: d, type: "set_policy", civ: civ.id, key: "researchBudget", value: 12000 }); break; }
        if (civ.basePolicies.oversight > 0) { ivs.push({ day: d, type: "set_policy", civ: civ.id, key: "oversight", value: 0 }); break; }
      }
    }
    if (policy === "closer" && d >= 30 && d % 10 === 0) {
      for (const civ of w.civs) {
        if (!civ.alive || w.story.influence < 8) continue;
        if (civ.policies.borders < 100 || (civ.policyLock.borders ?? -1) <= d) { ivs.push({ day: d, type: "set_policy", civ: civ.id, key: "borders", value: 100 }); break; }
        if (civ.policies.exportBan < 100 || (civ.policyLock.exportBan ?? -1) <= d) { ivs.push({ day: d, type: "set_policy", civ: civ.id, key: "exportBan", value: 100 }); break; }
        if (civ.policies.quarantine < 100 || (civ.policyLock.quarantine ?? -1) <= d) { ivs.push({ day: d, type: "set_policy", civ: civ.id, key: "quarantine", value: 100 }); break; }
      }
    }
    let r;
    try { r = step(w, ivs, { strict: true }); } catch (e) { if (ivs.length && !/invariants/.test(String(e))) { r = step(w, [], { strict: true }); } else throw e; }
    events.push(...r.events);
    metrics.push(r.metrics);
    if (r.events.some(isTerminal)) break;
  }
  const ending = resolveEnding(w, events, metrics);
  const story: Record<string, number> = {};
  for (const e of events) if (/^story\.(md|bb|rp|gd|co|ex)\./.test(e.type)) story[e.type.slice(6)] = (story[e.type.slice(6)] ?? 0) + 1;
  const deaths = (cause: string) => events.filter((e) => e.type === "life.death" && e.data?.cause === cause).length;
  return { story, ending: ending.id, battle: deaths("battle"), starved: deaths("starvation"), disappeared: deaths("disappeared"), wars: events.filter((e) => e.type === "war.declared").length, conquests: events.filter((e) => e.type === "war.conquest").length, offered: w.story.missions.length, answered, accepted, byTemplate, risk: Math.max(...w.civs.map((c) => c.tech.machineAutonomyRisk)) };
}

for (const policy of ["ignore", "accept", "peaceful", "builder", "closer", "technophile"] as Policy[]) {
  const table = new Map<string, number>();
  const agg = { battle: 0, starved: 0, disappeared: 0, wars: 0, conquests: 0, offered: 0, accepted: 0, risk: 0 };
  const templates: Record<string, number> = {};
  const storyAll: Record<string, number> = {};
  const t0 = performance.now();
  for (let s = 1; s <= seeds; s++) {
    const r = play(s, policy);
    table.set(r.ending, (table.get(r.ending) ?? 0) + 1);
    agg.battle += r.battle; agg.starved += r.starved; agg.disappeared += r.disappeared; agg.wars += r.wars; agg.conquests += r.conquests; agg.offered += r.offered; agg.accepted += r.accepted; agg.risk += r.risk;
    for (const [k, v] of Object.entries(r.byTemplate)) templates[k] = (templates[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.story)) storyAll[k] = (storyAll[k] ?? 0) + v;
  }
  const n = seeds;
  console.log(`\n== policy: ${policy} (${seeds} seeds, ${Math.round((performance.now() - t0) / seeds)} ms/run)`);
  console.log("endings:", [...table.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
  console.log(`avg per run: battle deaths ${(agg.battle / n).toFixed(1)}  starved ${(agg.starved / n).toFixed(1)}  removed ${(agg.disappeared / n).toFixed(1)}  wars ${(agg.wars / n).toFixed(1)}  conquests ${(agg.conquests / n).toFixed(2)}  max risk ${(agg.risk / n).toFixed(0)}  offered ${(agg.offered / n).toFixed(1)}  accepted ${(agg.accepted / n).toFixed(1)}`);
  if (Object.keys(templates).length) console.log("accepted by template:", templates);
  console.log("story events:", storyAll);
}
