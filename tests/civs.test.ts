/**
 * M4 — civilizations: multi-civ worldgen, rulers, research, war, missions, interventions.
 * The baseline numbers here are the harness criteria in docs/08 (M4 row).
 */
import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { run, step } from "../src/sim/engine";
import { hashHex } from "../src/sim/hash";
import { checkInvariants } from "../src/sim/invariants";
import { replay, takeSnapshot } from "../src/sim/snapshot";
import { candidateMissions } from "../src/sim/systems/missions";
import { BUILD_COST } from "../src/sim/data/buildings";
import type { Intervention, WorldState } from "../src/sim/types";

const BIG = { civs: 3 as const, population: 100, size: "medium" as const };
const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);

describe("M4 worldgen — three civilizations of 100", () => {
  it("builds one settlement per civ, far apart, each with a ruler, a barracks and a lab", () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const w = generateWorld(seed, BIG);
      expect(w.civs.length).toBe(3);
      expect(new Set(w.civs.map((c) => c.disposition)).size).toBe(3);
      expect(w.citizens.length).toBe(300);
      for (const civ of w.civs) {
        const st = w.settlements[civ.settlements[0]];
        const ruler = w.citizens[civ.ruler];
        expect(ruler.occupation).toBe("ruler");
        expect(ruler.settlement).toBe(st.id);
        expect(w.businesses.some((b) => b.kind === "barracks" && b.settlement === st.id)).toBe(true);
        expect(w.businesses.some((b) => b.kind === "lab" && b.settlement === st.id)).toBe(true);
        expect(w.businesses.filter((b) => b.kind === "farm" && b.settlement === st.id).length).toBeGreaterThanOrEqual(6);
        for (const other of w.settlements) {
          if (other.id === st.id) continue;
          const d = Math.hypot(other.cx - st.cx, other.cy - st.cy);
          expect(d, `seed ${seed}: ${st.name} ↔ ${other.name}`).toBeGreaterThanOrEqual(16);
        }
      }
      const names = new Set(w.citizens.map((c) => c.name));
      expect(names.size).toBe(300);
      const homeless = w.citizens.filter((c) => c.home < 0).length;
      expect(homeless, `seed ${seed} homeless`).toBe(0);
      const adults = w.citizens.filter((c) => c.occupation !== "child" && c.occupation !== "retired");
      const idle = adults.filter((c) => c.occupation === "unemployed").length;
      expect(idle / adults.length, `seed ${seed} idle share`).toBeLessThan(0.25);
      expect(w.initialMoney).toBe(w.citizens.reduce((s, c) => s + c.wealth, 0) + w.businesses.reduce((s, b) => s + b.cash, 0) + w.civs.reduce((s, c) => s + c.treasury, 0));
    }
  });

  it("is deterministic and distinct per seed", () => {
    expect(hashHex(generateWorld(11, BIG))).toBe(hashHex(generateWorld(11, BIG)));
    expect(hashHex(generateWorld(11, BIG))).not.toBe(hashHex(generateWorld(12, BIG)));
  });
});

describe("M4 baseline — 40 seeds × 545 days, three civs of 100", () => {
  const results = SEEDS.map((seed) => {
    const w = generateWorld(seed, BIG);
    const t0 = performance.now();
    const r = run(w, 545, { strict: true });
    const count = (t: string) => r.events.filter((e) => e.type === t).length;
    const deaths = (cause: string) => r.events.filter((e) => e.type === "life.death" && e.data?.cause === cause).length;
    return { seed, ms: performance.now() - t0, world: w, events: r.events, ending: r.ending, count, starved: deaths("starvation"), battle: deaths("battle"), last: r.metrics[r.metrics.length - 1] };
  });

  it("holds every invariant on every seed", () => {
    for (const r of results) expect(checkInvariants(r.world), `seed ${r.seed}`).toEqual([]);
  });

  it("nobody starves in more than 20 % of worlds (droughts are on at 'normal'), and war never kills more than a fifth of the people", () => {
    const starving = results.filter((r) => r.starved > 0).length;
    expect(starving / results.length, `${starving} seeds with starvation`).toBeLessThanOrEqual(0.2);
    for (const r of results) expect(r.battle, `seed ${r.seed} battle deaths`).toBeLessThan(60);
  });

  it("runs 545 days in under 2 s per world (the Oracle's budget)", () => {
    const avg = results.reduce((a, r) => a + r.ms, 0) / results.length;
    expect(avg).toBeLessThan(2000);
  });

  it("factions evolve: wars are declared in most worlds, research levels are reached, missions are offered", () => {
    const withWar = results.filter((r) => r.count("war.declared") > 0).length;
    expect(withWar / results.length).toBeGreaterThan(0.5);
    for (const r of results) {
      expect(r.count("research.level"), `seed ${r.seed} research`).toBeGreaterThan(0);
      expect(r.count("story.mission_offered"), `seed ${r.seed} missions`).toBeGreaterThanOrEqual(5);
    }
    const founding = results.filter((r) => r.count("econ.business_opened") > 0).length;
    expect(founding / results.length).toBeGreaterThan(0.8);
    const raidsTotal = results.reduce((a, r) => a + r.count("war.raid"), 0);
    expect(raidsTotal).toBeGreaterThan(0);
  });

  it("the scholarly civ out-researches the others in automation; the martial one in military", () => {
    let scholarlyLeads = 0;
    let martialLeads = 0;
    let counted = 0;
    for (const r of results) {
      const civs = r.world.civs;
      const sch = civs.find((c) => c.disposition === "scholarly");
      const mar = civs.find((c) => c.disposition === "martial");
      if (!sch || !mar) continue; // a coup changed a civ's character mid-run
      counted++;
      if (civs.every((c) => c.id === sch.id || sch.tech.automation >= c.tech.automation)) scholarlyLeads++;
      if (civs.every((c) => c.id === mar.id || mar.tech.military >= c.tech.military)) martialLeads++;
    }
    expect(scholarlyLeads / counted).toBeGreaterThan(0.8);
    expect(martialLeads / counted).toBeGreaterThan(0.6);
  });

  it("endings vary: no single ending takes more than 75 % of baselines, and at least one designed ending appears", () => {
    const table = new Map<string, number>();
    for (const r of results) table.set(r.ending!.id, (table.get(r.ending!.id) ?? 0) + 1);
    const designed = [...table.entries()].filter(([id]) => !id.startsWith("fallback.")).reduce((a, [, n]) => a + n, 0);
    // eslint-disable-next-line no-console
    console.log("ending table (40 seeds):", Object.fromEntries(table));
    for (const [, n] of table) expect(n / results.length).toBeLessThanOrEqual(0.75);
    expect(designed).toBeGreaterThan(0);
    for (const r of results) expect(r.ending!.epilogue.join(" ").length).toBeGreaterThan(200);
  });
});

describe("M4 interventions — the missions' tools", () => {
  function martialWorld(seed = 7919): { w: WorldState; martial: WorldState["civs"][number] } {
    const w = generateWorld(seed, BIG);
    return { w, martial: w.civs.find((c) => c.disposition === "martial")! };
  }

  it("remove_citizen on a ruler triggers a succession, a legitimacy hit and a ceasefire", () => {
    const { w, martial } = martialWorld();
    run(w, 10);
    const oldRuler = martial.ruler;
    const legit = martial.legitimacy;
    w.story.influence = 30;
    const r = step(w, [{ day: 11, type: "remove_citizen", citizen: oldRuler }], { strict: true });
    expect(w.citizens[oldRuler].alive).toBe(false);
    expect(martial.ruler).not.toBe(oldRuler);
    expect(w.citizens[martial.ruler].occupation).toBe("ruler");
    expect(martial.legitimacy).toBeLessThan(legit - 20);
    expect(martial.ceasefireUntil).toBeGreaterThan(w.day);
    expect(r.events.map((e) => e.type)).toEqual(expect.arrayContaining(["civ.disappearance", "life.death", "civ.succession"]));
  });

  it("destroy_building turns a farm into a ruin, closes its business and frees its workers", () => {
    const { w } = martialWorld();
    run(w, 5);
    const farm = w.businesses.find((b) => b.kind === "farm" && b.employees.length > 0)!;
    const staff = [...farm.employees];
    w.story.influence = 30;
    const r = step(w, [{ day: 6, type: "destroy_building", building: farm.building }], { strict: true });
    expect(w.buildings[farm.building].kind).toBe("ruin");
    expect(farm.alive).toBe(false);
    for (const id of staff) expect(w.citizens[id].workplace).toBe(-1);
    expect(r.events.some((e) => e.type === "world.building_destroyed")).toBe(true);
    w.story.influence = 30;
    expect(() => step(w, [{ day: 7, type: "destroy_building", building: farm.building }])).toThrow(/cannot be destroyed/);
  });

  it("build places a barracks near the town and charges the treasury; set_policy clamps to its range", () => {
    const { w } = martialWorld(42);
    const civ = w.civs.find((c) => c.disposition === "scholarly")!;
    const st = w.settlements[civ.settlements[0]];
    const before = civ.treasury;
    const nBarracks = w.businesses.filter((b) => b.alive && b.kind === "barracks" && b.settlement === st.id).length;
    w.story.influence = 30;
    step(w, [{ day: 1, type: "build", kind: "barracks", x: st.cx, y: st.cy, settlement: st.id }], { strict: true });
    expect(w.businesses.filter((b) => b.alive && b.kind === "barracks" && b.settlement === st.id).length).toBe(nBarracks + 1);
    expect(before - civ.treasury).toBeGreaterThanOrEqual(BUILD_COST.barracks!);
    step(w, [{ day: 2, type: "set_policy", civ: civ.id, key: "oversight", value: 500 }], { strict: true });
    expect(civ.policies.oversight).toBe(100);
    expect(checkInvariants(w)).toEqual([]);
  });

  it("missions are offered within 150 days; accepting one applies its effects and replays identically", () => {
    const w = generateWorld(2026, BIG);
    let offered: number | null = null;
    for (let d = 1; d <= 150 && offered === null; d++) {
      const r = step(w, [], { strict: true });
      const ev = r.events.find((e) => e.type === "story.mission_offered");
      if (ev) offered = Number(ev.data?.mission);
    }
    expect(offered).not.toBeNull();
    const mission = w.story.missions[offered!];
    expect(mission.status).toBe("offered");
    expect(mission.brief.length).toBeGreaterThan(40);
    expect(candidateMissions(w).length).toBeGreaterThanOrEqual(0);

    // branch: accept vs decline from the same snapshot, then replay the accepted branch
    const snap = takeSnapshot(w);
    const accept: Intervention = { day: w.day + 1, type: "mission", mission: mission.id, accept: true };
    const decline: Intervention = { day: w.day + 1, type: "mission", mission: mission.id, accept: false };
    const a = replay(snap, [accept], w.day + 60);
    const b = replay(snap, [decline], w.day + 60);
    expect(a.state.story.missions[mission.id].status).toBe("accepted");
    expect(b.state.story.missions[mission.id].status).toBe("declined");
    expect(hashHex(a.state)).not.toBe(hashHex(b.state));
    expect(a.events.some((e) => e.type === "story.mission_accepted")).toBe(true);
    const a2 = replay(snap, [accept], w.day + 60);
    expect(hashHex(a2.state)).toBe(hashHex(a.state));
    // the same answer twice is refused
    expect(() => step(a.state, [{ day: a.state.day + 1, type: "mission", mission: mission.id, accept: true }])).toThrow(/already/);
  });

  it("a world with interventions replays from a mid-run snapshot to the identical hash", () => {
    const w = generateWorld(99, BIG);
    const martial = w.civs.find((c) => c.disposition === "martial")!;
    const farm = w.businesses.find((b) => b.kind === "farm" && b.settlement === martial.settlements[0])!;
    const ivs: Intervention[] = [
      { day: 40, type: "remove_citizen", citizen: martial.ruler },
      { day: 70, type: "destroy_building", building: farm.building },
      { day: 100, type: "set_attitude", civ: martial.id, other: (martial.id + 1) % 3, value: 60 },
    ];
    const byDay = new Map<number, Intervention[]>();
    for (const iv of ivs) byDay.set(iv.day, [iv]);
    let snap = takeSnapshot(w);
    for (let d = 1; d <= 200; d++) {
      step(w, byDay.get(d) ?? [], { strict: true });
      if (d === 60) snap = takeSnapshot(w);
    }
    const again = replay(snap, ivs, 200);
    expect(hashHex(again.state)).toBe(hashHex(w));
  });
});
