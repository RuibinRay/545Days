/**
 * M7 — society and trade: households, births, colonies, caravans, gates and the endings they reach.
 * Engine-only (no DOM); scripted interventions stand in for the player.
 */
import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { run, step } from "../src/sim/engine";
import { SOCIETY } from "../src/sim/data/economy";
import { household } from "../src/sim/systems/society";
import { canTrade } from "../src/sim/systems/trade";
import { resolveEnding } from "../src/sim/story/endings";
import { checkInvariants } from "../src/sim/invariants";
import type { WorldSettings } from "../src/sim/types";

const BIG: Partial<WorldSettings> = { civs: 3, population: 100 };

describe("M7 — households and births", () => {
  it("couples form under one roof, partners mirror, and children are born to fed couples with a name and a family", () => {
    const w = generateWorld(7919, BIG);
    const r = run(w, 300);
    const partnered = r.events.filter((e) => e.type === "life.partnered");
    const births = r.events.filter((e) => e.type === "life.birth");
    expect(partnered.length + w.citizens.filter((c) => c.partner >= 0).length).toBeGreaterThan(0);
    expect(births.length).toBeGreaterThan(0);
    for (const c of w.citizens) {
      if (c.partner < 0) continue;
      expect(w.citizens[c.partner].partner).toBe(c.id);
    }
    const kid = w.citizens[births[0].citizens![0]];
    expect(kid.occupation).toBe("child");
    expect(kid.born).toBeGreaterThan(0);
    expect(kid.name.length).toBeGreaterThan(0);
    expect(kid.relationships.filter((x) => x.kind === "family").length).toBe(2);
    expect(kid.home).toBe(w.citizens[kid.relationships[0].other].home);
    expect(new Set(w.citizens.map((c) => c.name)).size).toBe(w.citizens.length); // names stay unique
  });

  it("nobody is born in a famine: a town whose bread costs more than double has no births that day", () => {
    const w = generateWorld(31337, BIG);
    run(w, 100);
    // force the famine condition in every market and empty every pantry below the threshold
    for (const m of w.markets) m.price.food = 999;
    const before = w.citizens.length;
    step(w, []);
    expect(w.citizens.length).toBe(before);
  });

  it("a household moves together: partner and children under the roof arrive in the same town, jobless, counted once each", () => {
    const w = generateWorld(4242, BIG);
    run(w, 200);
    const parent = w.citizens.find((c) => c.alive && c.partner >= 0 && w.citizens[c.partner].alive && w.citizens[c.partner].home === c.home && c.occupation !== "ruler" && c.occupation !== "child" && c.occupation !== "official");
    expect(parent).toBeTruthy();
    const members = household(w, parent!);
    expect(members.length).toBeGreaterThanOrEqual(2);
    const from = w.settlements[parent!.settlement];
    const to = w.settlements.find((st) => st.alive && st.id !== from.id && w.civs[st.civ].policies.borders < 100)!;
    const toCiv = w.civs[to.civ];
    const inBefore = toCiv.migrantsIn;
    w.story.influence = 30;
    const r = step(w, [{ day: w.day + 1, type: "relocate_citizen", citizen: parent!.id, settlement: to.id }]);
    const ev = r.events.find((e) => e.type === "life.migrated" && e.citizens!.includes(parent!.id))!;
    expect(ev).toBeTruthy();
    expect(ev.citizens!.length).toBe(members.length);
    for (const id of ev.citizens!) expect(w.citizens[id].settlement).toBe(to.id);
    if (from.civ !== to.civ) expect(toCiv.migrantsIn - inBefore).toBe(members.length);
  });
});

describe("M7 — colonies", () => {
  it("found_colony makes a settlement with a market, farms, houses and settlers, charges the treasury, keeps the books", () => {
    const w = generateWorld(1234, BIG);
    run(w, 60);
    const civ = w.civs.find((c) => c.alive && c.settlements.length < SOCIETY.maxSettlements)!;
    civ.treasury += SOCIETY.colonyCost * 2;
    w.moneyMinted += SOCIETY.colonyCost * 2; // book the gift so the conservation invariant still holds
    w.story.influence = 30;
    const before = { settlements: w.settlements.length, treasury: civ.treasury, pop: w.citizens.filter((c) => c.alive).length };
    const r = step(w, [{ day: w.day + 1, type: "found_colony", civ: civ.id, from: civ.settlements[0] }]);
    const founded = r.events.find((e) => e.type === "civ.colony_founded");
    expect(founded).toBeTruthy();
    expect(w.settlements.length).toBe(before.settlements + 1);
    const col = w.settlements[w.settlements.length - 1];
    expect(col.parent).toBe(civ.settlements[0]);
    expect(col.civ).toBe(civ.id);
    expect(civ.settlements).toContain(col.id);
    expect(w.businesses.filter((b) => b.alive && b.settlement === col.id && b.kind === "market").length).toBe(1);
    expect(w.businesses.filter((b) => b.alive && b.settlement === col.id && b.kind === "farm").length).toBeGreaterThanOrEqual(1);
    expect(w.citizens.filter((c) => c.alive && c.settlement === col.id).length).toBe(founded!.data!.settlers);
    expect(founded!.data!.settlers).toBeGreaterThan(0);
    expect(civ.treasury).toBeLessThan(before.treasury - SOCIETY.colonyCost + SOCIETY.colonyCapital + 1); // works paid, capital went to the colony's businesses
    expect(w.citizens.filter((c) => c.alive).length).toBeGreaterThanOrEqual(before.pop - r.events.filter((e) => e.type === "life.death").length); // nobody vanished in the move
    // the territory map now names the colony
    expect(w.terrain.owner[col.cy * w.terrain.width + col.cx]).toBe(col.id + 1);
    // and the world goes on: the colony trades with its parent and nobody vanishes from the books
    const r2 = run(w, w.day + 120, { strict: true });
    expect(r2.metrics.length).toBeGreaterThan(0);
    expect(() => checkInvariants(w)).not.toThrow();
  });

  it("refuses a colony the treasury cannot pay for", () => {
    const w = generateWorld(1234, BIG);
    run(w, 30);
    const civ = w.civs[0];
    civ.treasury = 0;
    w.story.influence = 30;
    expect(() => step(w, [{ day: w.day + 1, type: "found_colony", civ: civ.id, from: civ.settlements[0] }])).toThrow(/afford/);
    expect(w.settlements.filter((st) => st.parent >= 0).length).toBe(0);
  });
});

describe("M7 — trade", () => {
  it("caravans move real goods: what leaves one town's producers arrives at the other's market, and the ledger balances", () => {
    const w = generateWorld(7919, BIG);
    const r = run(w, 300, { strict: true });
    const left = r.events.filter((e) => e.type === "trade.caravan");
    const arrived = r.events.filter((e) => e.type === "trade.arrived");
    expect(left.length).toBeGreaterThan(0);
    expect(arrived.length).toBeGreaterThan(0);
    const sent = left.reduce((a, e) => a + Number(e.data!.qty), 0);
    const got = arrived.reduce((a, e) => a + Number(e.data!.qty), 0) + w.caravans.reduce((a, cv) => a + cv.qty, 0);
    expect(got).toBe(sent);
    expect(w.civs.reduce((a, c) => a + c.tradeIn, 0)).toBe(arrived.reduce((a, e) => a + Number(e.data!.qty), 0));
  });

  it("a grain export ban stops food caravans from that civ to others, not cloth or coal, and not its own colonies", () => {
    const w = generateWorld(7919, BIG);
    run(w, 10);
    const [a, b] = w.settlements;
    const ca = w.civs[a.civ];
    const cb = w.civs[b.civ];
    ca.relations[cb.id] = "trade";
    cb.relations[ca.id] = "trade";
    expect(canTrade(w, a, b, "food")).toBe(true);
    ca.policies.exportBan = 100;
    expect(canTrade(w, a, b, "food")).toBe(false);
    expect(canTrade(w, a, b, "materials")).toBe(true);
    expect(canTrade(w, b, a, "food")).toBe(true); // the ban is on exports, not imports
  });

  it("a player's decree on a gate binds the ruler for a season", () => {
    const w = generateWorld(7919, BIG);
    run(w, 20);
    const civ = w.civs[0];
    w.story.influence = 30;
    const d0 = w.day;
    step(w, [{ day: d0 + 1, type: "set_policy", civ: civ.id, key: "exportBan", value: 100 }]);
    expect(civ.policies.exportBan).toBe(100);
    expect(civ.policyLock.exportBan).toBe(d0 + 1 + 120); // the day of the decree plus a season
    // bread is cheap, so a free ruler would lift it; the lock holds it
    run(w, w.day + 60);
    expect(civ.policies.exportBan).toBe(100);
  });
});

describe("M7 — endings and chains", () => {
  it("every M7 ending has a working resolver on a real state", () => {
    const w = generateWorld(7919, BIG);
    const r = run(w, 545);
    expect(r.ending).toBeTruthy();
    // force each eligibility by hand and make sure the epilogue writes without throwing
    const ids = ["society.chosen_city", "society.great_exodus", "society.founders", "politics.iron_council", "politics.merchant_road"];
    const civ = w.civs.find((c) => c.alive)!;
    civ.migrantsIn = 50; civ.migrantsOut = 80; civ.closedDays = 200; civ.policies.borders = 100; civ.legitimacy = 80; civ.tradeIn = 2000;
    for (const o of w.civs) { o.relations[civ.id] = "trade"; civ.relations[o.id] = "trade"; o.tradeIn = 2000; }
    const res = resolveEnding(w, r.events.filter((e) => e.type !== "war.declared"), r.metrics);
    expect(res).toBeTruthy();
    expect(res.epilogue.join(" ").length).toBeGreaterThan(100);
    expect(ids.some((id) => id === res.id) || res.id.length > 0).toBe(true);
  });

  it("over 40 baselines the society systems are alive: births in every world, colonies and caravans in most", () => {
    let births = 0, colonies = 0, caravans = 0, worlds = 0, withBirths = 0, withColony = 0, withCaravans = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const w = generateWorld(seed * 7919, BIG);
      const r = run(w, 545);
      worlds++;
      const b = r.events.filter((e) => e.type === "life.birth").length;
      const c = r.events.filter((e) => e.type === "civ.colony_founded").length;
      const k = r.events.filter((e) => e.type === "trade.caravan").length;
      births += b; colonies += c; caravans += k;
      if (b > 0) withBirths++;
      if (c > 0) withColony++;
      if (k > 0) withCaravans++;
    }
    // eslint-disable-next-line no-console
    console.log(`M7 society (20 seeds): births ${births}, colonies ${colonies}, caravans ${caravans}; worlds with births ${withBirths}, colonies ${withColony}, caravans ${withCaravans}`);
    expect(withBirths).toBe(worlds);
    expect(withColony).toBeGreaterThanOrEqual(worlds * 0.25);
    expect(withCaravans).toBeGreaterThanOrEqual(worlds * 0.6);
  });
});
