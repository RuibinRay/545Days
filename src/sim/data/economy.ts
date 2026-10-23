/**
 * Economy constants. Every number is a tuning knob the headless harness (tests/economy.test.ts)
 * exercises; the structure in docs/03 is the commitment, these values are not.
 */
import type { Good } from "../types";

export const ECON = {
  /** Food units a citizen eats per day. */
  foodPerDay: 1,
  /** A household tries to keep this many days of food. */
  foodStockTarget: 5,
  /** Household energy per day (heating, light). Missing it costs shelter need. */
  energyPerDay: 1,
  /** Household buys one unit of materials this often (repairs, goods). */
  materialsEveryDays: 5,
  /** Market fee taken by the settlement's market business, percent of cleared value. */
  marketFeePct: 8,
  /** Sales tax on cleared value, taken from the escrow pool for the treasury. */
  salesTaxPct: 5,
  /** Clinic visit: fee and health gain. */
  clinicFeeCents: 300,
  clinicHealthGain: 4,
  clinicPatientsPerDoctor: 6,
  /** Price adjustment: p' = p × (1 + k × (D−S)/max(S,1)), clamped. */
  priceK: 0.08,
  priceMaxDailyMovePct: 15,
  priceFloorPct: 50,
  priceCeilPct: 500,
  /** Drift back toward base when a market sees no trade at all. */
  priceIdleDriftPct: 2,
  /** Days of input a business wants to hold. */
  inputReserveDays: 7,
  /** Payroll insolvency → closure after this many consecutive days. */
  insolventDaysToClose: 15,
  /** Expansion: profit30 above this many days of payroll and cash above the upgrade cost. */
  upgradeProfitDays: 20,
  upgradeCostCents: 60000,
  upgradeMaterials: 20,
  /** Opening a business. */
  startupCostCents: 120000,
  startupMaterials: 30,
  /** Needs decay per day. */
  needDecay: { food: 12, shelter: 1, shelterHomeless: 4, belonging: 3 },
  /** Health change per day without food / with food. */
  healthStarving: -8,
  healthRecover: 1,
  /** Decision temperature (docs/03 §2). */
  temperature: 14,
  temperatureCurious: 24,
  /** Base prices, cents per unit. */
  basePrice: { food: 300, materials: 500, energy: 200 } as Record<Good, number>,
} as const;

/** Research, war and diplomacy constants (M4). Tuned by tests/civs.test.ts and the harness. */
export const CIV = {
  /** Points a scientist produces per day = skill / researchDivisor, before lab tier bonus. */
  researchDivisor: 40,
  /** Cost of the next tech level = researchLevelBase + level. */
  researchLevelBase: 20,
  /** Days between a civ's raids while at war. */
  raidEveryDays: 15,
  /** Attitude at or below which a war may be declared, and above which a war ends. */
  warAt: -50,
  peaceAt: -20,
  /** Attitude at or above which two civs let their merchants trade (both must). */
  tradeAt: 15,
  /** Days a player's decree on a toggle policy (quarantine, borders, export ban) binds the ruler. */
  policyLockDays: 120,
  /** A ruler bans grain exports when food costs this much of base in one of its towns, and lifts it below `exportBanLiftAt`. */
  exportBanAt: 125,
  exportBanLiftAt: 105,
  /** Days without new wars after a peace or a ruler's death. */
  ceasefireDays: 150,
  /** Share of soldiers on the losing side of a raid who die, scaled by how badly they lost. */
  casualtyShare: 0.2,
  /** Share of the victim's food stock the attacker carries off on a won raid. */
  lootShare: 0.25,
  /** Lost raids in a row, with no soldiers left, before a town is conquered. */
  conquestRaids: 4,
  /** Condition lost by each building hit in a raid. */
  raidDamage: 35,
  /** Legitimacy changes. */
  successionLegitimacy: -20,
  assassinationLegitimacy: -10,
  /** Mission cadence: first offer, then every N days (± jitter), each open for `missionOpenDays`. */
  firstMissionDay: 15,
  missionEveryDays: 40,
  missionJitterDays: 10,
  missionOpenDays: 20,
} as const;

/** Society and trade constants (M7). Tuned by tests/society.test.ts and the harness. */
export const SOCIETY = {
  /** Daily chance of a birth for an eligible couple (≈ one child per hundred people every two months in a fed town). */
  birthChance: 1 / 250,
  maxParentAge: 45,
  /** A town is crowded with this many homeless, or when it has grown by `colonyGrowth` people and has under three beds free. */
  colonyHomeless: 3,
  colonyGrowth: 5,
  /** Treasury cost of a colony (cents) and the part of it that capitalises the colony's businesses. */
  colonyCost: 400000,
  colonyCapital: 160000,
  colonyMinDist: 16,
  colonyMaxDist: 34,
  colonyEveryDays: 150,
  /** Chance per 10-day check that a crowded, solvent, peaceful civ actually founds one. */
  colonyChancePct: 35,
  maxSettlements: 3,
  /** Trade: an importer buys when the price there is this much above the exporter's. */
  tradeMargin: 1.25,
  /** Share of an exporter town's producer stock one caravan may carry. */
  tradeShare: 0.15,
  /** Tiles a caravan covers per day. */
  caravanSpeed: 10,
  /** Tariff on arriving goods from another civ, percent of their value at the destination. */
  tariffPct: 10,
  /** Days between caravans on one route for one good. */
  tradeEveryDays: 4,
  /** Caravans carry the fever: chance per sick merchant at the source that the cargo brings it along. */
  caravanInfectRate: 0.1,
} as const;

/** Typical household spend weights for the price index. */
export const BASKET: Record<Good, number> = { food: 1, materials: 0.3, energy: 0.5 };
