/** Every event type the engine can emit must have a plain-English sentence in the UI, so the chronicle and ticker never print raw JSON. */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { eventText } from "../src/app/events";
import { STORY_EVENTS } from "../src/sim/story/chains";
import type { WorldEvent } from "../src/sim/types";

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Event types are the `type: "x.y"` literals passed to emit() — dotted, unlike intervention kinds. */
function emittedTypes(): string[] {
  const types = new Set<string>();
  for (const file of walk("src/sim")) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/type:\s*"([a-z]+\.[a-z_]+)"/g)) types.add(m[1]);
  }
  for (const ev of STORY_EVENTS) types.add(`story.${ev.id}`);
  types.add("story.clue");
  types.add("story.vision_revealed");
  return [...types].sort();
}

describe("event sentences", () => {
  const types = emittedTypes();

  it("finds the engine's event types", () => {
    expect(types.length).toBeGreaterThanOrEqual(15);
    expect(types).toContain("story.countdown_end");
  });

  it.each(types)("%s has a sentence that is not the raw type", (type) => {
    const data: Record<string, number | string> = {
      cause: "x", age: 30, wage: 1000, kind: "farm", tier: 2, good: "food", price: 700, output: 1, wanted: 4, unrest: 80, research: 1, health: 1, welfare: 1, days: 20,
      foodRatio: 150, matRatio: 90, taxRate: 25, daysInHand: 12, field: "military", level: 40, next: "A", old: "B", legitimacy: 40, form: "council", soldiers: 3, target: "T",
      name: "N", occupation: "scientist", key: "oversight", before: 1, after: 2, a: "A", b: "B", value: 40, delta: 10, automation: 60, staffTarget: 2, aggressor: "A",
      enemyStrength: 1, strength: 2, attacker: "A", defender: "B", won: 1, attackers: 5, defenders: 3, deadAttackers: 1, deadDefenders: 0, looted: 10, hit: 1, conqueror: "A",
      town: "T", fallen: "B", civAlive: 0, cost: 1000, condition: 50, food: 30, materials: 15, energy: 10, repelled: 1, stolen: 0, title: "The researcher of T", risk: 90, oversight: 10, mission: 0, template: "x", building: 1, otherCiv: 1, grade: "evidence", text: "t", knowledge: 2, vision: 0, chain: "md", clues: 1, from: "A", to: "B", homeless: 0, on: 1, sick: 3,
      settlers: 12, farms: 2, houses: 3, people: 4, qty: 20, paid: 5000, idle: 12, household: 3,
    };
    const e: WorldEvent = { day: 1, type, importance: 5, citizens: [1], businesses: [2], civ: 0, settlement: 0, data, causes: [] };
    const text = eventText(e, null, () => "farm");
    expect(text.startsWith(type)).toBe(false);
    expect(text).not.toContain("{");
    expect(text).not.toContain("undefined");
  });
});
