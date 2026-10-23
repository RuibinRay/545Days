import type { BuildingKind, BusinessKind, Good, Inventory } from "../types";

/** Footprint in tiles. The renderer draws sprites at exactly this size. */
export const BUILDING_SIZE: Record<BuildingKind, { w: number; h: number }> = {
  house: { w: 2, h: 2 },
  farm: { w: 3, h: 3 },
  workshop: { w: 2, h: 2 },
  factory: { w: 3, h: 2 },
  market: { w: 2, h: 2 },
  clinic: { w: 2, h: 2 },
  lab: { w: 3, h: 3 },
  town_hall: { w: 3, h: 3 },
  power_plant: { w: 3, h: 3 },
  warehouse: { w: 2, h: 2 },
  barracks: { w: 3, h: 2 },
  ruin: { w: 1, h: 1 },
};

export const BUILDING_BUSINESS: Partial<Record<BuildingKind, BusinessKind>> = {
  farm: "farm",
  workshop: "workshop",
  factory: "factory",
  market: "market",
  clinic: "clinic",
  lab: "lab",
  power_plant: "power_plant",
  barracks: "barracks",
};

export interface BusinessTemplate {
  wage: number; // cents/day
  cash: number; // starting cents
  baseOutput: number;
  produces: Good | "service";
  inputs: Partial<Inventory>;
  staff: number; // target headcount for worldgen
}

/** Starting values; tuned at M2 via the headless harness. */
export const BUSINESS_DEFAULTS: Record<BusinessKind, BusinessTemplate> = {
  farm: { wage: 800, cash: 60000, baseOutput: 12, produces: "food", inputs: {}, staff: 4 },
  workshop: { wage: 1200, cash: 80000, baseOutput: 4, produces: "materials", inputs: { energy: 1 }, staff: 3 },
  factory: { wage: 1600, cash: 120000, baseOutput: 4, produces: "materials", inputs: { energy: 2 }, staff: 5 },
  market: { wage: 1000, cash: 90000, baseOutput: 0, produces: "service", inputs: {}, staff: 2 },
  clinic: { wage: 1500, cash: 40000, baseOutput: 0, produces: "service", inputs: { energy: 2 }, staff: 2 },
  lab: { wage: 1500, cash: 50000, baseOutput: 0, produces: "service", inputs: { energy: 2 }, staff: 2 },
  power_plant: { wage: 1500, cash: 100000, baseOutput: 30, produces: "energy", inputs: {}, staff: 5 },
  barracks: { wage: 1000, cash: 40000, baseOutput: 0, produces: "service", inputs: {}, staff: 4 },
};

/** Starting stock so Day 1 is not a famine before the first harvest clears. */
export const STARTING_INVENTORY: Partial<Record<BusinessKind, Partial<Inventory>>> = {
  farm: { food: 120 },
  workshop: { materials: 20, energy: 10 },
  power_plant: { energy: 40 },
  clinic: { energy: 10 },
  lab: { energy: 10 },
};

/** Publicly funded services: the treasury pays these daily so they can meet payroll (docs/03 §3). */
export const PUBLIC_BUSINESSES: BusinessKind[] = ["clinic", "lab", "barracks", "power_plant"];

/** Treasury cost of a player-built building (intervention `build`), cents. */
export const BUILD_COST: Partial<Record<BuildingKind, number>> = {
  farm: 120000, workshop: 150000, clinic: 200000, lab: 250000, power_plant: 300000, barracks: 180000, warehouse: 100000,
};

export const zeroInventory = (): Inventory => ({ food: 0, materials: 0, energy: 0 });
