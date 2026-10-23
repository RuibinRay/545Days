import { layRoad } from "./roads";
import type { Disposition, WorldSettings, WorldState } from "../types";
import { createRngStreams } from "../rng";
import { nextInt, shuffle } from "../rng";
import { generatePeople } from "./people";
import { generateSettlement } from "./settlement";
import { generateTerrain } from "./terrain";

export const DEFAULT_SETTINGS: WorldSettings = {
  size: "medium",
  terrain: "continent",
  climate: "temperate",
  civs: 3,
  population: 100,
  disasters: "normal",
  difficulty: "standard",
  endingPreview: "cryptic",
};

export const MAP_SIZE: Record<WorldSettings["size"], number> = { tiny: 64, small: 96, medium: 128 };

/** Every world with three civs has one of each disposition; smaller worlds draw a subset. */
export function pickDispositions(civs: number, rng: WorldState["rng"]["worldgen"]): Disposition[] {
  const all: Disposition[] = ["agrarian", "scholarly", "martial"];
  shuffle(rng, all);
  return all.slice(0, civs);
}

/**
 * Builds a Day-0 world. Pure: same (seed, settings) → identical state.
 * One settlement per civilization, sites spread across the map, each civ with a disposition,
 * a ruler, and `settings.population` citizens.
 */
export function generateWorld(seed: number, partial: Partial<WorldSettings> = {}): WorldState {
  const settings: WorldSettings = { ...DEFAULT_SETTINGS, ...partial };
  const rng = createRngStreams(seed);
  const size = MAP_SIZE[settings.size];
  const terrain = generateTerrain(size, size, seed, settings, rng.worldgen);

  const ids = { building: 0, business: 0 };
  const occupied = new Uint8Array(size * size);
  const taken: { x: number; y: number }[] = [];
  const usedNames = new Set<string>();
  const dispositions = pickDispositions(settings.civs, rng.worldgen);
  const minSiteDist = Math.max(22, Math.floor(size / 4));

  const state: WorldState = {
    version: 3,
    seed,
    day: 0,
    mode: "sandbox",
    rng,
    terrain,
    climate: { rainfall: settings.climate === "dry" ? 55 : 75, season: 0, droughtDays: 0, pollution: 0 },
    citizens: [],
    buildings: [],
    businesses: [],
    settlements: [],
    civs: [],
    markets: [],
    projects: [],
    caravans: [],
    roads: [],
    nextCaravanId: 0,
    story: {
      baselineEnding: null,
      baselineSchedule: [],
      fired: [],
      cancelled: [],
      clues: [],
      influence: 15,
      knowledge: 0,
      interventions: [],
      missions: [],
      nextMissionDay: 15,
      revealLog: {},
      revealedVisions: [],
      recent: [],
      disasters: settings.disasters,
      startPopulation: {},
    },
    moneyMinted: 0,
    moneyBurned: 0,
    initialMoney: 0,
  };

  for (let civId = 0; civId < settings.civs; civId++) {
    const disposition = dispositions[civId];
    const bundle = generateSettlement(terrain, rng.worldgen, civId, civId, ids, settings.population, disposition, occupied, taken, minSiteDist);
    const people = generatePeople(settings.population, rng.worldgen, civId, bundle.buildings, bundle.businesses, usedNames, state.citizens.length, disposition);
    bundle.civ.ruler = people.find((c) => c.occupation === "ruler")?.id ?? -1;
    bundle.settlement.population = people.length;
    state.citizens.push(...people);
    state.buildings.push(...bundle.buildings);
    state.businesses.push(...bundle.businesses);
    state.settlements.push(bundle.settlement);
    state.civs.push(bundle.civ);
    state.markets.push(bundle.market);
  }
  for (const st of state.settlements) state.story.startPopulation[st.id] = st.population;
  // roads between every pair of towns that share a landmass
  for (const a of state.settlements)
    for (const b of state.settlements) {
      if (b.id <= a.id) continue;
      const r = layRoad(terrain, a, b);
      if (r) state.roads.push(r);
    }
  // everyone starts neutral-to-wary; martial civs a little colder
  for (const a of state.civs)
    for (const b of state.civs) {
      if (a.id === b.id) continue;
      a.attitude[b.id] = (a.disposition === "martial" ? -15 : 5) + nextInt(rng.worldgen, 0, 20);
      a.relations[b.id] = "neutral";
    }

  state.initialMoney =
    state.citizens.reduce((s, c) => s + c.wealth, 0) +
    state.businesses.reduce((s, b) => s + b.cash, 0) +
    state.civs.reduce((s, c) => s + c.treasury, 0);
  return state;
}
