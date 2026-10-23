/** M5 — story chains, clues, the Influence/Knowledge economy and blowback. */
import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { interventionCost, run, step } from "../src/sim/engine";
import { hashHex } from "../src/sim/hash";
import { STORY_EVENTS } from "../src/sim/story/chains";
import { holds } from "../src/sim/story/scheduler";
import { STORY_ECON } from "../src/sim/types";
import type { Intervention, WorldEvent } from "../src/sim/types";

const BIG = { civs: 3 as const, population: 100, size: "medium" as const };

describe("M5 — the story scheduler", () => {
  it("every chain event has a unique id, a sane window and at least one clue or effect", () => {
    const ids = new Set<string>();
    for (const ev of STORY_EVENTS) {
      expect(ids.has(ev.id)).toBe(false);
      ids.add(ev.id);
      expect(ev.earliestDay).toBeLessThanOrEqual(ev.latestDay);
      expect(ev.probability).toBeGreaterThan(0);
      expect(ev.effects.length + ev.clues.length).toBeGreaterThan(0);
      for (const dep of ev.onCancel ?? []) expect(STORY_EVENTS.some((x) => x.id === dep)).toBe(true);
    }
  });

  it("conditions read the state: civ paths, fired ids, ruler traits, recent events", () => {
    const w = generateWorld(2026, BIG);
    const sch = w.civs.find((c) => c.disposition === "scholarly")!;
    expect(holds(w, sch, { kind: "civ", path: "tech.automation", op: ">=", value: 20 })).toBe(true);
    expect(holds(w, sch, { kind: "civ", path: "disposition", op: "==", value: "scholarly" })).toBe(true);
    expect(holds(w, sch, { kind: "fired", event: "md.proposal" })).toBe(false);
    expect(holds(w, sch, { kind: "notFired", event: "md.proposal" })).toBe(true);
    expect(holds(w, sch, { kind: "hasLead", minScience: 1 })).toBe(true);
    expect(holds(w, sch, { kind: "recent", type: "civ.disappearance", withinDays: 30 })).toBe(false);
    expect(holds(w, sch, { kind: "all", of: [{ kind: "atWar", value: false }, { kind: "not", c: { kind: "atWar", value: true } }] })).toBe(true);
  });

  it("the Machine Dominion chain fires in order in an untouched scholarly civ, and leaves clues", () => {
    const w = generateWorld(7919, BIG);
    const r = run(w, 545, { strict: true });
    const sch = w.civs.find((c) => c.disposition === "scholarly")!;
    const fired = w.story.fired.filter((f) => f.id.endsWith(`@${sch.id}`)).map((f) => f.id.split("@")[0]);
    expect(fired[0]).toBe("md.proposal");
    expect(fired).toContain("md.lab_funded");
    const prop = w.story.fired.find((f) => f.id === `md.proposal@${sch.id}`)!;
    const fund = w.story.fired.find((f) => f.id === `md.lab_funded@${sch.id}`)!;
    expect(fund.day).toBeGreaterThan(prop.day);
    expect(w.story.clues.some((c) => c.grade === "evidence" && c.text.includes("Lab ledger"))).toBe(true);
    expect(r.events.some((e) => e.type === "story.md.proposal")).toBe(true);
    // a window that closes cancels its dependants
    for (const civ of w.civs) {
      if (w.story.fired.some((f) => f.id === `md.proposal@${civ.id}`)) continue;
      expect(w.story.cancelled).toContain(`md.proposal@${civ.id}`);
      expect(w.story.cancelled).toContain(`md.lab_funded@${civ.id}`);
    }
  });
});

describe("M5 — Influence, Knowledge and investigation", () => {
  it("charges Influence, refuses what cannot be afforded, and regenerates to the cap", () => {
    const w = generateWorld(11, BIG);
    expect(w.story.influence).toBe(STORY_ECON.influenceStart);
    const ruler = w.civs[0].ruler;
    expect(interventionCost({ type: "remove_citizen", citizen: ruler })).toBe(15);
    step(w, [{ day: 1, type: "remove_citizen", citizen: ruler }], { strict: true });
    expect(w.story.influence).toBeLessThanOrEqual(1); // 15 − 15, plus maybe a regen tick
    expect(() => step(w, [{ day: 2, type: "destroy_building", building: w.businesses[0].building }])).toThrow(/not enough Influence/);
    run(w, 80);
    expect(w.story.influence).toBeGreaterThanOrEqual(STORY_ECON.influenceCap - 1);
    run(w, 20);
    expect(w.story.influence).toBe(STORY_ECON.influenceCap);
  });

  it("missions cost the sum of their effects and cannot be taken on credit", () => {
    const w = generateWorld(2026, BIG);
    let offered: number | null = null;
    for (let d = 1; d <= 150 && offered === null; d++) {
      const r = step(w);
      const ev = r.events.find((e) => e.type === "story.mission_offered");
      if (ev) offered = Number(ev.data?.mission);
    }
    const m = w.story.missions[offered!];
    const cost = interventionCost({ type: "mission", mission: m.id, accept: true }, w.story.missions);
    expect(cost).toBe(m.effects.reduce((a, e) => a + STORY_ECON.cost[e.type], 0));
    w.story.influence = cost - 1;
    expect(() => step(w, [{ day: w.day + 1, type: "mission", mission: m.id, accept: true }])).toThrow(/not enough Influence/);
    expect(w.story.missions[m.id].status).toBe("offered");
    w.story.influence = cost;
    step(w, [{ day: w.day + 1, type: "mission", mission: m.id, accept: true }], { strict: true });
    expect(w.story.missions[m.id].status).toBe("accepted");
    expect(w.story.influence).toBeLessThanOrEqual(1);
  });

  it("investigating a lab yields evidence from state and Knowledge; a person yields a rumor; cooldown holds", () => {
    const w = generateWorld(99, BIG);
    run(w, 10);
    const lab = w.buildings.find((b) => b.kind === "lab")!;
    const civ = w.civs[w.settlements[lab.settlement].civ];
    const r = step(w, [{ day: 11, type: "reveal", target: "building", id: lab.id }], { strict: true });
    const clue = w.story.clues[w.story.clues.length - 1];
    expect(clue.grade).toBe("evidence");
    expect(clue.text).toContain(String(civ.tech.automation));
    expect(w.story.knowledge).toBeGreaterThanOrEqual(STORY_ECON.revealKnowledgeEvidence);
    expect(r.events.some((e) => e.type === "story.clue")).toBe(true);
    expect(() => step(w, [{ day: 12, type: "reveal", target: "building", id: lab.id }])).toThrow(/too recently/);
    const kp = w.story.knowledge;
    step(w, [{ day: 13, type: "reveal", target: "citizen", id: civ.ruler }], { strict: true });
    expect(w.story.clues[w.story.clues.length - 1].grade).toBe("rumor");
    expect(w.story.knowledge).toBe(kp + STORY_ECON.revealKnowledgeRumor);
  });

  it("reading a vision plainly costs Knowledge and is recorded; it replays", () => {
    const w = generateWorld(5, BIG);
    run(w, 3);
    expect(() => step(w, [{ day: 4, type: "reveal_vision", vision: 0 }])).toThrow(/not enough Knowledge/);
    w.story.knowledge = STORY_ECON.visionRevealCost;
    step(w, [{ day: 4, type: "reveal_vision", vision: 0 }], { strict: true });
    expect(w.story.revealedVisions).toEqual([0]);
    expect(w.story.knowledge).toBe(0);
  });
});

describe("M5 — blowback", () => {
  it("removing a ruler draws a reprisal in most worlds; removing a scientist, a martyr", () => {
    let reprisals = 0;
    let martyrs = 0;
    const N = 8;
    for (let i = 1; i <= N; i++) {
      const w = generateWorld(i * 101, BIG);
      const martial = w.civs.find((c) => c.disposition === "martial")!;
      const sch = w.civs.find((c) => c.disposition === "scholarly")!;
      const lead = w.businesses.filter((b) => b.kind === "lab" && b.settlement === sch.settlements[0]).flatMap((b) => b.employees).map((id) => w.citizens[id]).sort((a, b) => b.skills.science - a.skills.science)[0];
      w.story.influence = 30;
      const ivs: Intervention[] = [{ day: 20, type: "remove_citizen", citizen: martial.ruler }, { day: 60, type: "remove_citizen", citizen: lead.id }];
      const events: WorldEvent[] = [];
      for (let d = 1; d <= 120; d++) {
        if (d === 60) w.story.influence = 30;
        events.push(...step(w, ivs.filter((x) => x.day === d), { strict: true }).events);
      }
      if (events.some((e) => e.type === "story.bb.reprisal")) reprisals++;
      if (events.some((e) => e.type === "story.bb.martyr")) martyrs++;
    }
    expect(reprisals / N).toBeGreaterThanOrEqual(0.75);
    expect(martyrs / N).toBeGreaterThanOrEqual(0.75);
  });

  it("story state is deterministic: same seed + same interventions → same hash", () => {
    const a = generateWorld(31, BIG);
    const b = generateWorld(31, BIG);
    const ivs: Intervention[] = [{ day: 30, type: "reveal", target: "building", id: a.buildings.find((x) => x.kind === "lab")!.id }];
    run(a, 200, { interventions: ivs });
    run(b, 200, { interventions: ivs });
    expect(hashHex(a)).toBe(hashHex(b));
    expect(a.story.clues.length).toBe(b.story.clues.length);
  });
});
