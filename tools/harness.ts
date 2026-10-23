/**
 * Headless tuning harness (docs/08 M2): runs N seeds for 545 days with invariants on and prints
 * the numbers that matter. Usage: npx tsx tools/harness.ts [seeds=50] [days=545] [terrain]
 */
import { generateWorld } from "../src/sim/worldgen";
import { run } from "../src/sim/engine";
import type { WorldSettings } from "../src/sim/types";

const seeds = Number(process.argv[2] ?? 50);
const days = Number(process.argv[3] ?? 545);
const terrain = (process.argv[4] ?? "continent") as WorldSettings["terrain"];
const civs = Number(process.argv[5] ?? 3) as WorldSettings["civs"];
const population = Number(process.argv[6] ?? 100);
const verbose = process.argv.includes("-v");

const rows: Record<string, number>[] = [];
const endings = new Map<string, number>();
let totalMs = 0;
let failures = 0;
for (let seed = 1; seed <= seeds; seed++) {
  const w = generateWorld(seed * 7919, { terrain, civs, population });
  const t0 = performance.now();
  let res;
  try {
    res = run(w, days, { strict: true });
  } catch (e) {
    failures++;
    console.log(`seed ${seed}: ${(e as Error).message.split("\n")[0]}`);
    continue;
  }
  totalMs += performance.now() - t0;
  if (res.ending) endings.set(res.ending.id, (endings.get(res.ending.id) ?? 0) + 1);
  const m = res.metrics;
  const last = m[m.length - 1];
  const ev = res.events;
  const count = (t: string) => ev.filter((e) => e.type === t).length;
  const prices = m.map((x) => x.priceIndex);
  const deathsBy = (cause: string) => ev.filter((e) => e.type === "life.death" && e.data?.cause === cause).length;
  rows.push({
    seed,
    deaths: m.reduce((a, x) => a + x.deaths, 0),
    starved: deathsBy("starvation"),
    battle: deathsBy("battle"),
    plague: deathsBy("plague"),
    rpIdx: count("story.rp.index"),
    rpCure: count("story.rp.cure"),
    gdDry: count("story.gd.dry_spring"),
    gdDr1: count("story.gd.first_drought"),
    gdIrr: count("story.gd.irrigation"),
    migr: count("life.migrated"),
    births: m.reduce((a, x) => a + x.births, 0),
    colonies: count("civ.colony_founded"),
    colPop: w.settlements.filter((st) => st.alive && st.parent >= 0).reduce((a, st) => a + st.population, 0),
    coChain: count("story.co.crowded") + count("story.co.survey") + count("story.co.founding") + count("story.co.hardship") + count("story.co.thrive"),
    exChain: count("story.ex.talk") + count("story.ex.first_families") + count("story.ex.gates") + count("story.ex.empty_streets"),
    bans: count("civ.export_ban"),
    turnedAway: count("civ.turned_away"),
    closedDays: Math.max(...w.civs.map((c) => c.closedDays)),
    migrIn: Math.max(...w.civs.map((c) => c.migrantsIn)),
    caravans: count("trade.caravan"),
    routes: count("trade.route_opened"),
    tradeU: m.reduce((a, x) => a + x.trade, 0),
    borders: count("civ.borders"),
    partnered: count("life.partnered"),
    homelessEnd: w.citizens.filter((c) => c.alive && c.home < 0).length,
    wars: count("war.declared"),
    raids: count("war.raid"),
    conq: count("war.conquest"),
    succ: count("civ.succession") + count("civ.coup"),
    missions: count("story.mission_offered"),
    techLv: count("research.level"),
    risk: Math.max(...w.civs.map((c) => c.tech.machineAutonomyRisk)),
    autoLv: Math.max(...w.civs.map((c) => c.tech.automation)),
    soldiers: w.citizens.filter((c) => c.alive && c.occupation === "soldier").length,
    ending: res.ending ? res.ending.id.length : 0,
    popEnd: last.population,
    unempEnd: last.unemployment,
    unempAvg: Math.round(m.reduce((a, x) => a + x.unemployment, 0) / m.length),
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
    priceEnd: last.priceIndex,
    foodDays: last.foodDaysReserve,
    treasuryK: Math.round(last.treasuryTotal / 100000),
    gini: last.gini,
    wellbeing: last.avgWellbeing,
    unrest: last.unrest,
    closed: count("econ.business_closed"),
    opened: count("econ.business_opened"),
    upgraded: count("econ.business_upgraded"),
    riots: count("civ.riot"),
    spikes: count("econ.price_spike"),
    wageCuts: count("econ.wage_cut"),
    foodP: w.markets[0].price.food,
    matP: w.markets[0].price.materials,
    enP: w.markets[0].price.energy,
  });
}

const keys = Object.keys(rows[0] ?? {});
if (verbose) {
  console.log(keys.join("\t"));
  for (const r of rows) console.log(keys.map((k) => r[k]).join("\t"));
}
const avg = (k: string) => (rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(1);
console.log("\nAVG\t" + keys.slice(1).map((k) => `${k}=${avg(k)}`).join(" "));
const starvingSeeds = rows.filter((r) => r.starved > 0).length;
console.log(`seeds with starvation: ${starvingSeeds}/${rows.length} (${((100 * starvingSeeds) / rows.length).toFixed(0)}%)   seeds with any death: ${rows.filter((r) => r.deaths > 0).length}   invariant failures: ${failures}   avg ms/run: ${(totalMs / rows.length).toFixed(0)}`);
console.log("endings: " + [...endings.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));
