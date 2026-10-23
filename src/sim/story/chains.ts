/**
 * Story chains (docs/05): data-driven conditional events, scheduled per civilization.
 * Conditions read state; effects write through the same paths the systems use; clues are text
 * the player can discover. Two chains ship at M5: Machine Dominion (md) over the automation arc
 * the research system already produces, and blowback (bb) after the player removes people.
 */
import { BB } from "./chains/bb";
import { CO } from "./chains/co";
import { EX } from "./chains/ex";
import { GD } from "./chains/gd";
import { MD } from "./chains/md";
import { RP } from "./chains/rp";
import type { Civilization, Policies, ResearchField, Trait } from "../types";

export type Op = "<" | "<=" | "==" | ">=" | ">" | "!=";

export type Condition =
  | { kind: "civ"; path: `tech.${ResearchField}` | "tech.machineAutonomyRisk" | `policies.${keyof Policies}` | "legitimacy" | "treasury" | "disposition" | "form" | "migrantsIn" | "migrantsOut" | "births" | "settlements.length"; op: Op; value: number | string }
  | { kind: "fired"; event: string; withinDays?: number }
  | { kind: "notFired"; event: string }
  | { kind: "rulerTrait"; trait: Trait; has: boolean }
  | { kind: "hasLead"; minScience: number }
  | { kind: "recent"; type: string; withinDays: number; occupation?: string; cause?: string }
  | { kind: "atWar"; value: boolean }
  | { kind: "climate"; path: "rainfall" | "droughtDays"; op: Op; value: number }
  /** Share of the civ's living people who are sick or incubating, 0..100. */
  | { kind: "sickShare"; op: Op; value: number }
  /** Number of settlements (any civ) with at least `min` sick. */
  | { kind: "sickTowns"; min: number; op: Op; value: number }
  /** Food price in the civ's town as a percentage of base. */
  | { kind: "foodRatio"; op: Op; value: number }
  /** Granary days (reserve / people) in the civ's town. */
  | { kind: "reserveDays"; op: Op; value: number }
  /** The town's population as a percentage of Day 0. */
  | { kind: "popShare"; op: Op; value: number }
  | { kind: "disasters"; atLeast: "low" | "normal" | "chaotic" }
  | { kind: "hasBuilding"; building: "warehouse" | "clinic" | "lab" | "barracks"; value: boolean }
  | { kind: "irrigated"; value: boolean }
  /** The civ's first town is full (people outside, or grown with no beds to spare) — society.ts `crowded`. */
  | { kind: "crowded"; value: boolean }
  /** Some other living civilization has its borders shut. */
  | { kind: "othersClosed"; value: boolean }
  /** Population of the civ's newest colony (0 when it has none). */
  | { kind: "colonyPop"; op: Op; value: number }
  | { kind: "all"; of: Condition[] }
  | { kind: "any"; of: Condition[] }
  | { kind: "not"; c: Condition };

export type Effect =
  | { kind: "civ.policy.delta"; key: keyof Policies; delta: number }
  | { kind: "civ.policy.set"; key: keyof Policies; value: number }
  | { kind: "civ.tech.delta"; field: ResearchField | "machineAutonomyRisk"; delta: number }
  | { kind: "civ.legitimacy.delta"; delta: number }
  | { kind: "civ.form.set"; form: Civilization["form"] }
  | { kind: "civ.attitude.delta"; delta: number }
  | { kind: "civ.research.pool"; delta: number }
  | { kind: "lead.belief.delta"; key: string; delta: number }
  | { kind: "engineers.belief.delta"; key: string; delta: number }
  | { kind: "people.belief.delta"; key: string; delta: number }
  | { kind: "conscript"; count: number }
  | { kind: "civ.ceasefire.set"; days: number }
  | { kind: "infect"; occupation?: string; count: number }
  | { kind: "climate.rainfall.delta"; delta: number }
  | { kind: "climate.drought.set"; days: number }
  | { kind: "civ.irrigated.set"; value: boolean }
  | { kind: "market.food.multiply"; factor: number }
  | { kind: "granary.delta"; units: number }
  | { kind: "energy.cut"; share: number }
  /** Found a colony of the civ's most crowded town (society.ts); silently nothing when it cannot be done. */
  | { kind: "civ.colony.found" };

export interface ClueTemplate {
  grade: "rumor" | "evidence";
  /** Placeholders: {civ} {town} {lead} {ruler} {title} {budget} {automation} {risk} {oversight} {colony} {migrantsOut}. */
  text: string;
  truthful: boolean;
}

export interface StoryEvent {
  id: string;
  chain: string;
  title: string;
  earliestDay: number;
  latestDay: number;
  required: Condition[];
  blockedBy: Condition[];
  /** Per eligible day, per mille. */
  probability: number;
  once: boolean;
  effects: Effect[];
  clues: ClueTemplate[];
  importance: number;
  /** Events that become impossible if this one's window closes without it firing. */
  onCancel?: string[];
}

/** Every authored event, in chain order. Each chain lives in its own file under ./chains/. */
export const STORY_EVENTS: StoryEvent[] = [...MD, ...BB, ...RP, ...GD, ...CO, ...EX];

