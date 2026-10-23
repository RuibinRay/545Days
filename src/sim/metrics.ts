import { BASKET, ECON } from "./data/economy";
import type { DailyMetrics, WorldState } from "./types";
import { GOODS } from "./types";

/** Gini coefficient as an integer per-mille (0..1000). Integer-only arithmetic on cents. */
export function giniPerMille(values: number[]): number {
  const v = values.filter((x) => x >= 0).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  let cum = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    cum += v[i];
    weighted += v[i] * (i + 1);
  }
  if (cum === 0) return 0;
  const g = (2 * weighted) / (n * cum) - (n + 1) / n;
  return Math.max(0, Math.min(1000, Math.round(g * 1000)));
}

export interface MetricInputs {
  wagesPaid: number;
  deaths: number;
  births?: number;
  trade?: number;
  /** units produced per business id today */
  produced: Map<number, number>;
}

/**
 * Day metrics from state plus the day's flows. Definitions (docs/03):
 *  gdp         = Σ goods produced × today's market price + wages paid by service businesses
 *  priceIndex  = basket cost / Day-0 basket cost × 1000 (basket in data/economy BASKET)
 *  foodDays    = (household food + farm food stocks + public reserve) / population
 *  births      = children born today (society.ts)
 */
export function computeMetrics(s: WorldState, flows: MetricInputs = { wagesPaid: 0, deaths: 0, produced: new Map() }): DailyMetrics {
  const alive = s.citizens.filter((c) => c.alive);
  const adults = alive.filter((c) => c.occupation !== "child" && c.occupation !== "retired");
  const unemployed = adults.filter((c) => c.occupation === "unemployed").length;
  const n = alive.length || 1;
  const wellbeing = alive.reduce((a, c) => a + (c.needs.food + c.needs.shelter + c.needs.safety + c.needs.belonging) / 4, 0) / n;
  const health = alive.reduce((a, c) => a + c.health, 0) / n;
  const treasury = s.civs.reduce((a, c) => a + c.treasury, 0);
  const risk = s.civs.reduce((a, c) => Math.max(a, c.tech.machineAutonomyRisk), 0);
  const unrest = s.settlements.length ? Math.round(s.settlements.reduce((a, t) => a + t.unrest, 0) / s.settlements.length) : 0;

  let gdp = 0;
  for (const b of s.businesses) {
    if (!b.alive) continue;
    const m = s.markets[b.settlement];
    if (b.produces !== "service") gdp += (flows.produced.get(b.id) ?? 0) * m.price[b.produces];
    else gdp += b.employees.filter((id) => s.citizens[id].alive && s.citizens[id].action === "work").length * b.wage;
  }

  let idx = 0;
  let baseIdx = 0;
  for (const m of s.markets)
    for (const g of GOODS) {
      idx += m.price[g] * BASKET[g];
      baseIdx += ECON.basePrice[g] * BASKET[g];
    }
  const priceIndex = baseIdx ? Math.round((1000 * idx) / baseIdx) : 1000;

  let food = alive.reduce((a, c) => a + c.foodStock, 0);
  for (const b of s.businesses) if (b.alive) food += b.inventory.food;
  for (const m of s.markets) food += m.reserve.food;

  return {
    day: s.day,
    population: alive.length,
    births: flows.births ?? 0,
    deaths: flows.deaths,
    gdp,
    gdpPerCapita: Math.round(gdp / n),
    unemployment: adults.length ? Math.round((100 * unemployed) / adults.length) : 0,
    gini: giniPerMille(alive.map((c) => c.wealth)),
    priceIndex,
    foodDaysReserve: Math.round(food / n),
    avgWellbeing: Math.round(wellbeing),
    avgHealth: Math.round(health),
    unrest,
    treasuryTotal: treasury,
    machineAutonomyRisk: risk,
    infected: alive.filter((c) => c.infection === "sick" || c.infection === "incubating").length,
    trade: flows.trade ?? 0,
    caravans: s.caravans.length,
  };
}
