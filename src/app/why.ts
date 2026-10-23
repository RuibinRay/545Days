/**
 * "Why did this happen?" — a graph walk over WorldEvent.causes (docs/02). A cause string is either
 * an event type (we find the most recent earlier event of that type) or a state/metric tag
 * (we show what that quantity was doing at the time). Nothing here is generated prose.
 */
import type { DailyMetrics, WorldEvent } from "../sim/types";

export interface CauseNode {
  label: string;
  detail: string;
  event?: WorldEvent;
  children: CauseNode[];
}

const TAGS: Record<string, string> = {
  "market.price": "the market price",
  "market.supply": "what sellers offered at the market",
  "market.demand": "what buyers wanted at the market",
  "business.cash": "the business's cash",
  "business.profit30": "the business's 30-day profit",
  "settlement.unrest": "unrest in the settlement",
  "civ.treasury": "the council's treasury",
  "needs.food": "the person's food need",
  "citizen.seek_job": "the person looking for work",
  "citizen.start_business": "the person deciding to start a business",
  "player.disaster": "a sandbox power the player used",
  "player.remove_citizen": "the player removing a person",
  "player.destroy_building": "the player destroying a building",
  "player.build": "the player building",
  "player.set_policy": "the player setting a policy",
  "player.set_attitude": "the player's decree",
  "player.nudge_belief": "the player nudging a belief",
  "player.choice": "the player's answer to the Oracle",
  "player.silence": "the player letting the offer lapse",
  "oracle.state": "what the Oracle saw in the world",
  "civ.attitude": "how the civilizations felt about each other",
  "civ.strength": "the balance of soldiers",
  "civ.martial": "a martial civilization's nature",
  "civ.scholarly": "a scholarly civilization's nature",
  "civ.agrarian": "an agrarian civilization's nature",
  "civ.legitimacy": "the government's legitimacy",
  "civ.situation": "the ruler's reading of the situation",
  "civ.researchFocus": "what the ruler asked the lab to work on",
  "civ.tech.automation": "the civilization's automation level",
  "civ.threatened": "a hostile, stronger neighbour",
  "civ.soldiers": "the town's soldiers",
  "civ.no_soldiers": "a town with no soldiers",
  "civ.no_ruler": "a civilization with nobody in charge",
  "policy.oversight": "the oversight policy",
  "lab.output": "the lab's scientists at work",
  "war.exhaustion": "an army with no one left to send",
  "citizen.wealth": "the household's savings",
  "citizen.age": "old age",
  "env.moisture": "the soil's moisture",
  chance: "chance (the world's own dice)",
  calendar: "the calendar",
  starvation: "starvation",
};

function metricAt(metrics: DailyMetrics[], day: number): DailyMetrics | undefined {
  let best: DailyMetrics | undefined;
  for (const m of metrics) if (m.day <= day && (!best || m.day > best.day)) best = m;
  return best;
}

function tagDetail(tag: string, day: number, metrics: DailyMetrics[], foodPrices: { day: number; price: number }[]): string {
  const now = metricAt(metrics, day);
  const before = metricAt(metrics, day - 30);
  const fp = (d: number) => foodPrices.filter((p) => p.day <= d).pop()?.price;
  switch (tag) {
    case "market.price": {
      const a = fp(day - 30);
      const b = fp(day);
      return a !== undefined && b !== undefined ? `food went from $${(a / 100).toFixed(2)} to $${(b / 100).toFixed(2)} over the previous 30 days` : "";
    }
    case "settlement.unrest": return now && before ? `unrest ${before.unrest} → ${now.unrest} over 30 days` : "";
    case "civ.treasury": return now && before ? `treasury $${Math.round(before.treasuryTotal / 100).toLocaleString()} → $${Math.round(now.treasuryTotal / 100).toLocaleString()} over 30 days` : "";
    case "needs.food": return now ? `${Math.round(now.foodDaysReserve)} days of food per person in town that day` : "";
    case "market.supply": case "market.demand": return now ? `price index ${(now.priceIndex / 10).toFixed(0)} % of Day 0` : "";
    default: return "";
  }
}

/** Builds the cause tree for `e` to `depth` levels. */
export function explain(e: WorldEvent, events: WorldEvent[], metrics: DailyMetrics[], foodPrices: { day: number; price: number }[], depth = 2, seen = new Set<string>()): CauseNode[] {
  const out: CauseNode[] = [];
  for (const cause of e.causes ?? []) {
    const key = `${cause}@${e.day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // an earlier event of that type (prefer ones touching the same people/businesses)
    const prior = events
      .filter((x) => x.type === cause && x.day <= e.day && x !== e && x.day >= e.day - 120)
      .sort((a, b) => b.day - a.day || overlap(b, e) - overlap(a, e));
    const linked = prior.find((x) => overlap(x, e) > 0) ?? prior[0];
    if (linked) {
      out.push({ label: cause, detail: `day ${linked.day}`, event: linked, children: depth > 1 ? explain(linked, events, metrics, foodPrices, depth - 1, seen) : [] });
    } else {
      out.push({ label: TAGS[cause] ?? cause, detail: tagDetail(cause, e.day, metrics, foodPrices), children: [] });
    }
  }
  return out;
}

function overlap(a: WorldEvent, b: WorldEvent): number {
  let n = 0;
  for (const id of a.citizens ?? []) if (b.citizens?.includes(id)) n++;
  for (const id of a.businesses ?? []) if (b.businesses?.includes(id)) n++;
  return n;
}
