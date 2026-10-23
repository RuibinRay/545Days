/** The exodus — hunger empties a town (M7). Data only; the DSL is in ../chains.ts and the scheduler in ../scheduler.ts. */
import type { StoryEvent } from "../chains";

export const EX: StoryEvent[] = [
  {
    id: "ex.talk", chain: "ex", title: "Talk of the road",
    earliestDay: 30, latestDay: 500,
    required: [{ kind: "foodRatio", op: ">=", value: 160 }],
    blockedBy: [],
    probability: 150, once: true,
    effects: [{ kind: "people.belief.delta", key: "food_is_scarce", delta: 10 }],
    clues: [{ grade: "rumor", text: "In {town} they talk of the road: of markets where bread is cheap and houses stand empty.", truthful: true }],
    importance: 4,
  },
  {
    id: "ex.first_families", chain: "ex", title: "The first families",
    earliestDay: 30, latestDay: 545,
    required: [{ kind: "fired", event: "ex.talk" }, { kind: "civ", path: "migrantsOut", op: ">=", value: 5 }],
    blockedBy: [],
    probability: 300, once: true,
    effects: [{ kind: "civ.legitimacy.delta", delta: -5 }],
    clues: [{ grade: "evidence", text: "Tally at the {town} gate: {migrantsOut} people of {civ} have left for other nations since the first day.", truthful: true }],
    importance: 6,
  },
  {
    id: "ex.gates", chain: "ex", title: "Shut gates",
    earliestDay: 30, latestDay: 545,
    required: [{ kind: "fired", event: "ex.first_families" }, { kind: "othersClosed", value: true }, { kind: "foodRatio", op: ">=", value: 140 }],
    blockedBy: [],
    probability: 200, once: true,
    effects: [{ kind: "civ.attitude.delta", delta: -15 }, { kind: "civ.legitimacy.delta", delta: -5 }],
    clues: [{ grade: "rumor", text: "The neighbours have shut their gates; families of {town} are camped outside them with what they carried.", truthful: true }],
    importance: 7,
  },
  {
    id: "ex.empty_streets", chain: "ex", title: "Empty streets",
    earliestDay: 60, latestDay: 545,
    required: [{ kind: "fired", event: "ex.first_families" }, { kind: "popShare", op: "<=", value: 70 }],
    blockedBy: [],
    probability: 300, once: true,
    effects: [{ kind: "civ.legitimacy.delta", delta: -10 }, { kind: "market.food.multiply", factor: 0.85 }],
    clues: [{ grade: "evidence", text: "Census of {town}: a third of the houses stand empty; the market closes at noon.", truthful: true }],
    importance: 8,
  },
];
