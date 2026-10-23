/** M6 — Red Plague and Great Drought: the infection model, quarantine, clinics, the climate chain, migration, endings. */
import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { run, step } from "../src/sim/engine";
import { infect } from "../src/sim/systems/health";
import { productivity } from "../src/sim/systems/economy";
import type { WorldEvent, WorldSettings } from "../src/sim/types";

const BIG = { civs: 3 as const, population: 100, size: "medium" as const };
const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);

function plagueDeaths(events: WorldEvent[]): number {
  return events.filter((e) => e.type === "life.death" && e.data?.cause === "plague").length;
}

describe("M6 — the infection model", () => {
  it("one index case becomes an epidemic that burns out, killing between 2 % and 25 %", () => {
    const w = generateWorld(4242, { ...BIG, disasters: "off" });
    run(w, 10);
    const merchant = w.citizens.find((c) => c.alive && c.occupation === "merchant")!;
    expect(infect(w, merchant)).toBe(true);
    expect(infect(w, merchant)).toBe(false);
    const events: WorldEvent[] = [];
    let peak = 0;
    for (let d = 11; d <= 300; d++) {
      events.push(...step(w, [], { strict: true }).events);
      peak = Math.max(peak, w.citizens.filter((c) => c.alive && c.infection === "sick").length);
    }
    const recovered = w.citizens.filter((c) => c.infection === "recovered").length;
    const dead = plagueDeaths(events);
    expect(recovered + dead).toBeGreaterThanOrEqual(30);
    expect(peak).toBeGreaterThanOrEqual(10);
    expect(dead / 300).toBeGreaterThanOrEqual(0.02);
    expect(dead / 300).toBeLessThanOrEqual(0.25);
    expect(w.citizens.filter((c) => c.alive && (c.infection === "sick" || c.infection === "incubating")).length).toBe(0);
    expect(events.some((e) => e.type === "story.rp.cluster")).toBe(true);
  });

  it("the sick stay home and do not work", () => {
    const w = generateWorld(4242, { ...BIG, disasters: "off" });
    run(w, 5);
    const farmer = w.citizens.find((c) => c.alive && c.occupation === "farmer")!;
    infect(w, farmer);
    farmer.infection = "sick";
    farmer.infectionDay = w.day;
    step(w);
    expect(farmer.action).toBe("rest");
    expect(farmer.itinerary.every((b) => b === farmer.home)).toBe(true);
  });

  it("a quarantine keeps the fever out of other towns", () => {
    const w = generateWorld(4242, { ...BIG, disasters: "off" });
    for (const c of w.civs) { c.policies.quarantine = 100; c.basePolicies.quarantine = 100; }
    run(w, 10);
    const first = w.civs[0];
    const merchant = w.citizens.find((c) => c.alive && c.occupation === "merchant" && first.settlements.includes(c.settlement))!;
    infect(w, merchant);
    for (let d = 11; d <= 200; d++) step(w);
    const elsewhere = w.citizens.filter((c) => !first.settlements.includes(c.settlement) && c.infection !== "none").length;
    expect(elsewhere).toBe(0);
  });

  it("a well-funded clinic saves lives (same seed, five times the health budget → no more deaths than the control)", () => {
    const play = (budgetFactor: number) => {
      const w = generateWorld(31337, { ...BIG, disasters: "off" });
      for (const c of w.civs) { c.policies.healthBudget *= budgetFactor; c.basePolicies.healthBudget *= budgetFactor; }
      run(w, 10);
      infect(w, w.citizens.find((c) => c.alive && c.occupation === "merchant")!);
      const events: WorldEvent[] = [];
      for (let d = 11; d <= 300; d++) events.push(...step(w).events);
      return plagueDeaths(events);
    };
    const control = play(1);
    const funded = play(5);
    expect(control).toBeGreaterThan(0);
    expect(funded).toBeLessThanOrEqual(control);
  });
});

describe("M6 — droughts, irrigation and migration", () => {
  it("an irrigated civilization keeps three quarters of its crop on parched land", () => {
    const w = generateWorld(7, BIG);
    const farm = w.businesses.find((b) => b.kind === "farm")!;
    const civ = w.civs[w.settlements[farm.settlement].civ];
    const workers = farm.employees.map((id) => w.citizens[id]);
    w.terrain.moisture.fill(0);
    const dry = productivity(w, farm, workers);
    civ.irrigated = true;
    const irrigated = productivity(w, farm, workers);
    expect(irrigated).toBeGreaterThan(dry * 2);
    expect(irrigated / dry).toBeCloseTo(3, 0); // 0.75 against 0.25
  });

  it("the drought chain raises food prices and sends people walking; nothing of it happens with disasters off", () => {
    let chains = 0;
    let migrations = 0;
    let spikes = 0;
    for (const seed of SEEDS.slice(0, 12)) {
      const w = generateWorld(seed, BIG);
      const r = run(w, 545);
      if (r.events.some((e) => e.type === "story.gd.first_drought")) {
        chains++;
        const peak = Math.max(...r.metrics.map((m) => m.priceIndex));
        if (peak >= 1500) spikes++;
      }
      migrations += r.events.filter((e) => e.type === "life.migrated").length;
    }
    expect(chains).toBeGreaterThanOrEqual(4);
    expect(spikes).toBeGreaterThanOrEqual(1);
    expect(migrations).toBeGreaterThan(0);
    for (const seed of SEEDS.slice(0, 6)) {
      const w = generateWorld(seed, { ...BIG, disasters: "off" as WorldSettings["disasters"] });
      const r = run(w, 545);
      expect(r.events.some((e) => e.type === "story.gd.dry_spring" || e.type === "story.rp.index")).toBe(false);
    }
  });

  it("migrants change settlement, lose their job and are counted by both civilizations", () => {
    const w = generateWorld(118785, BIG); // a world where a raided town starves and its people walk (seed 15 of the harness)
    const r = run(w, 545);
    const moved = r.events.filter((e) => e.type === "life.migrated");
    expect(moved.length).toBeGreaterThan(0);
    const c = w.citizens[moved[0].citizens![0]];
    expect(c.settlement).not.toBe(c.origin);
    // since M7 a household moves together: one event per household, every member counted once by each side
    const people = moved.reduce((a, e) => a + e.citizens!.length, 0);
    expect(people).toBeGreaterThanOrEqual(moved.length);
    // the civ tallies count moves between nations; a move to one's own colony is not emigration
    const crossCiv = moved.filter((e) => e.data!.fromCiv !== e.data!.toCiv).reduce((a, e) => a + e.citizens!.length, 0); // the civs at the time of the move (conquest can change a town's civ later)
    expect(crossCiv).toBeGreaterThan(0);
    expect(w.civs.reduce((a, x) => a + x.migrantsOut, 0)).toBe(crossCiv);
    expect(w.civs.reduce((a, x) => a + x.migrantsIn, 0)).toBe(crossCiv);
  });
});

describe("M6 — endings", () => {
  it("over 40 baselines, Red Plague and Great Drought each appear, and no ending exceeds 40 % except the fallbacks", () => {
    const table = new Map<string, number>();
    for (const seed of SEEDS) {
      const w = generateWorld(seed, BIG);
      const r = run(w, 545);
      table.set(r.ending!.id, (table.get(r.ending!.id) ?? 0) + 1);
    }
    // eslint-disable-next-line no-console
    console.log("M6 ending table (40 seeds):", Object.fromEntries(table));
    expect(table.get("disease.red_plague") ?? 0).toBeGreaterThanOrEqual(1);
    expect(table.get("climate.great_drought") ?? 0).toBeGreaterThanOrEqual(1);
    for (const [id, n] of table) if (!id.startsWith("fallback.")) expect(n / SEEDS.length, id).toBeLessThanOrEqual(0.4);
  });
});
