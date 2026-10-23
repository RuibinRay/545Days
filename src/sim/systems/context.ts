import type { Ledger } from "../ledger";
import type { WorldEvent, WorldState } from "../types";

/** Per-day scratch shared by the phases. Nothing here persists into WorldState. */
export interface StepContext {
  s: WorldState;
  day: number;
  ledger: Ledger;
  events: WorldEvent[];
  /** Citizens who chose seek_job today, in id order. */
  jobSeekers: number[];
  /** Citizens who chose start_business today. */
  founders: number[];
  /** Citizens who bought anything at the market today (itinerary stop). */
  visitedMarket: Set<number>;
  /** Units produced per business id today. */
  produced: Map<number, number>;
  /** Wages paid today per civ (for tax metrics) and total. */
  wagesPaid: number;
  deaths: number;
  births: number;
  /** Units of goods that arrived by caravan today. */
  tradeArrived: number;
  /** Soldiers routed to an enemy town today (war.ts); itineraries() leaves them alone. */
  marching: Set<number>;
}

export function emit(ctx: StepContext, e: Omit<WorldEvent, "day">): void {
  ctx.events.push({ day: ctx.day, ...e });
}
