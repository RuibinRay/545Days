/** Blowback — the world answers the player's removals (M5). Data only; the DSL is in ../chains.ts and the scheduler in ../scheduler.ts. */
import type { StoryEvent } from "../chains";

export const BB: StoryEvent[] = [
  {
    id: "bb.martyr", chain: "bb", title: "A martyr for the lab",
    earliestDay: 1, latestDay: 545,
    required: [{ kind: "recent", type: "civ.disappearance", withinDays: 30, occupation: "scientist" }],
    blockedBy: [{ kind: "fired", event: "bb.martyr", withinDays: 120 }],
    probability: 250, once: false,
    effects: [{ kind: "civ.policy.delta", key: "researchBudget", delta: 2000 }, { kind: "civ.research.pool", delta: 40 }, { kind: "people.belief.delta", key: "world_is_dangerous", delta: 10 }],
    clues: [{ grade: "rumor", text: "{town} has named its lab after the one who vanished. The council doubled its grant.", truthful: true }],
    importance: 6,
  },
  {
    id: "bb.reprisal", chain: "bb", title: "A reprisal",
    earliestDay: 1, latestDay: 545,
    required: [{ kind: "recent", type: "civ.disappearance", withinDays: 30, occupation: "ruler" }],
    blockedBy: [{ kind: "fired", event: "bb.reprisal", withinDays: 120 }],
    probability: 250, once: false,
    effects: [{ kind: "civ.attitude.delta", delta: -30 }, { kind: "civ.policy.delta", key: "militaryBudget", delta: 3000 }, { kind: "conscript", count: 4 }, { kind: "civ.legitimacy.delta", delta: 15 }, { kind: "civ.ceasefire.set", days: 20 }],
    clues: [{ grade: "rumor", text: "The new {title} of {civ} blames the neighbours for the old one's death, and the crowd that was muttering is cheering: soldiers are being raised.", truthful: true }],
    importance: 7,
  },
  {
    id: "bb.ashes", chain: "bb", title: "From the ashes",
    earliestDay: 1, latestDay: 545,
    required: [{ kind: "recent", type: "world.building_destroyed", withinDays: 20, cause: "player." }],
    blockedBy: [{ kind: "fired", event: "bb.ashes", withinDays: 90 }],
    probability: 200, once: false,
    effects: [{ kind: "civ.legitimacy.delta", delta: -5 }, { kind: "people.belief.delta", key: "world_is_dangerous", delta: 15 }],
    clues: [{ grade: "rumor", text: "People in {town} say the fire that took their building was no accident, and look at the sky when they say it.", truthful: true }],
    importance: 5,
  },
];
