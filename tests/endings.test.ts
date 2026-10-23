/** M10 — the six design-doc endings added after M9: each eligibility is forced on a real state and the resolver must pick it and write it. */
import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { run, step } from "../src/sim/engine";
import { resolveEnding } from "../src/sim/story/endings";
import type { WorldEvent } from "../src/sim/types";

const BIG = { civs: 3 as const, population: 100 };

function world(seed = 7919) {
  const w = generateWorld(seed, BIG);
  const r = run(w, 545);
  return { w, events: r.events.filter((e) => e.type !== "war.declared" && e.type !== "war.conquest"), metrics: r.metrics };
}

const death = (day: number, cause: string, settlement = 0): WorldEvent => ({ day, type: "life.death", importance: 5, settlement, citizens: [0], data: { cause, age: 30 }, causes: [] });

describe("M10 — endings", () => {
  it("Divided Humanity: a machine nation and a nation of hands, cold to each other, with no road between them", () => {
    const { w, events, metrics } = world();
    const [a, b] = w.civs;
    a.tech.automation = 65; a.tech.machineAutonomyRisk = 30;
    b.tech.automation = 10;
    a.attitude[b.id] = -60; b.attitude[a.id] = -60;
    w.story.fired = w.story.fired.filter((f) => !f.id.startsWith("trade.route@") && !f.id.startsWith("md.accord"));
    const res = resolveEnding(w, events, metrics);
    expect(res.id).toBe("tech.divided_humanity");
    expect(res.epilogue.join(" ")).toContain(a.name);
  });

  it("Quarantine Nations: the fever came, every gate stayed shut two months or more, and few died", () => {
    const { w, events, metrics } = world();
    w.story.fired.push({ id: "rp.index@0", day: 40 });
    for (const c of w.civs) c.quarantineDays = 120;
    const ev = events.filter((e) => !(e.type === "life.death" && e.data?.cause === "plague")).concat([death(50, "plague")]);
    const res = resolveEnding(w, ev, metrics);
    expect(res.id).toBe("disease.quarantine_nations");
    expect(res.epilogue.join(" ")).toMatch(/gate/);
  });

  it("The Famine Fever needs both killers: a drought and a fever each past the point of no return", () => {
    const { w, events, metrics } = world();
    w.story.fired.push({ id: "gd.second_drought@0", day: 200 }, { id: "rp.cluster@1", day: 220 });
    const start = metrics[0].population;
    const extra: WorldEvent[] = [];
    for (let i = 0; i < Math.ceil(start * 0.05); i++) extra.push(death(300 + i, "plague", 1));
    for (let i = 0; i < Math.ceil(start * 0.04); i++) extra.push(death(310 + i, "starvation", 0));
    const res = resolveEnding(w, events.concat(extra), metrics);
    expect(res.id).toBe("disease.famine_fever");
    // the same deaths without the drought on the record are a plague, not a famine fever
    w.story.fired = w.story.fired.filter((f) => !f.id.startsWith("gd.second_drought"));
    const res2 = resolveEnding(w, events.concat(extra), metrics);
    expect(res2.id).not.toBe("disease.famine_fever");
  });

  it("The Broken Crown: two coups in one nation", () => {
    const { w, events, metrics } = world();
    const c = w.civs[0];
    const coup = (day: number): WorldEvent => ({ day, type: "civ.coup", importance: 8, civ: c.id, citizens: [], data: { old: "A", next: "B", legitimacy: 20 }, causes: [] });
    c.legitimacy = 30;
    const res = resolveEnding(w, events.concat([coup(100), coup(300)]), metrics);
    expect(res.id).toBe("politics.broken_crown");
    expect(res.epilogue.join(" ")).toContain(c.name);
  });

  it("The Silent Generation: births stop while fertile couples remain and a famine or fever is on the record", () => {
    const { w, events, metrics } = world();
    const m = metrics.map((x, i) => ({ ...x, births: i < 180 ? (i % 30 === 0 ? 1 : 0) : 0 }));
    w.story.fired.push({ id: "gd.second_drought@0", day: 200 });
    // make sure at least five fertile couples share a roof
    const adults = w.citizens.filter((c) => c.alive && c.occupation !== "child" && c.home >= 0);
    for (let i = 0; i + 1 < adults.length && i < 12; i += 2) { adults[i].partner = adults[i + 1].id; adults[i + 1].partner = adults[i].id; adults[i + 1].home = adults[i].home; adults[i].age = 30; adults[i + 1].age = 30; }
    const ev = events.filter((e) => !(e.type === "life.death" && e.data?.cause === "plague"));
    const res = resolveEnding(w, ev, m);
    expect(res.id).toBe("disease.silent_generation");
    // with the couples gone it is only the generation ageing out: not this ending
    for (const c of w.citizens) c.age = Math.max(c.age, 50);
    expect(resolveEnding(w, ev, m).id).not.toBe("disease.silent_generation");
  });

  it("the quarantine counter counts every day a civ's gates are shut, whoever shut them", () => {
    const w = generateWorld(7919, BIG);
    run(w, 10);
    const civ = w.civs[0];
    w.story.influence = 30;
    const before = civ.quarantineDays;
    step(w, [{ day: w.day + 1, type: "set_policy", civ: civ.id, key: "quarantine", value: 100 }]);
    run(w, w.day + 30);
    expect(civ.quarantineDays - before).toBeGreaterThanOrEqual(30);
  });
});
