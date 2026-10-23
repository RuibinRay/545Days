import type {
  Building,
  BuildingKind,
  Business,
  Civilization,
  Disposition,
  MarketState,
  Policies,
  RngState,
  Settlement,
  TerrainLayer,
} from "../types";
import { BUILDING_BUSINESS, BUILDING_SIZE, BUSINESS_DEFAULTS, STARTING_INVENTORY, zeroInventory } from "../data/buildings";
import { nextInt } from "../rng";
import { civName, townName } from "./names";
import { BIOME, RESOURCE } from "./terrain";

export interface SettlementBundle {
  settlement: Settlement;
  civ: Civilization;
  market: MarketState;
  buildings: Building[];
  businesses: Business[];
}

const TOWN_RADIUS = 7;

export function buildable(t: TerrainLayer, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= t.width || y >= t.height) return false;
  const i = y * t.width + x;
  if (t.river[i]) return false;
  const b = t.biome[i];
  return b === BIOME.grassland || b === BIOME.forest || b === BIOME.coast;
}

function near(t: TerrainLayer, x: number, y: number, d: number, test: (i: number) => boolean): boolean {
  for (let dy = -d; dy <= d; dy++)
    for (let dx = -d; dx <= d; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= t.width || ny >= t.height) continue;
      if (test(ny * t.width + nx)) return true;
    }
  return false;
}

/**
 * Deterministic site choice: most buildable land in a 9×9 window, bonus for river and coast,
 * at least `minDist` tiles from every site already taken (relaxed if nothing qualifies).
 */
export function chooseSite(t: TerrainLayer, taken: { x: number; y: number }[] = [], minDist = 0): { x: number; y: number } {
  for (const dist of [minDist, Math.floor(minDist * 0.75), Math.floor(minDist * 0.5), 0]) {
    let best = -1;
    let bx = -1;
    let by = -1;
    for (let y = 5; y < t.height - 5; y++) {
      for (let x = 5; x < t.width - 5; x++) {
        const i = y * t.width + x;
        if (t.biome[i] !== BIOME.grassland) continue;
        if (taken.some((s) => (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) < dist * dist)) continue;
        let score = 0;
        for (let dy = -8; dy <= 8; dy++)
          for (let dx = -8; dx <= 8; dx++) {
            if (buildable(t, x + dx, y + dy)) score += 1;
            const j = (y + dy) * t.width + (x + dx);
            if (j >= 0 && j < t.resource.length && t.resource[j] === RESOURCE.fertile) score += 2;
          }
        if (near(t, x, y, 4, (j) => t.river[j] === 1)) score += 20;
        if (near(t, x, y, 5, (j) => t.biome[j] === BIOME.coast)) score += 10;
        if (score > best) {
          best = score;
          bx = x;
          by = y;
        }
      }
    }
    if (bx >= 0) return { x: bx, y: by };
  }
  return { x: Math.floor(t.width / 2), y: Math.floor(t.height / 2) };
}

/**
 * A site for a colony: buildable grassland between `minDist` and `maxDist` tiles of the parent town,
 * at least `minDist` from every other site, scored like chooseSite but preferring land near the parent.
 * Returns null when no such site exists (the colony is not founded).
 */
export function chooseColonySite(t: TerrainLayer, parent: { x: number; y: number }, taken: { x: number; y: number }[], minDist: number, maxDist: number): { x: number; y: number } | null {
  let best = -1;
  let bx = -1;
  let by = -1;
  for (let y = 5; y < t.height - 5; y++) {
    for (let x = 5; x < t.width - 5; x++) {
      const i = y * t.width + x;
      if (t.biome[i] !== BIOME.grassland) continue;
      const d2 = (parent.x - x) * (parent.x - x) + (parent.y - y) * (parent.y - y);
      if (d2 < minDist * minDist || d2 > maxDist * maxDist) continue;
      if (taken.some((s) => (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y) < minDist * minDist)) continue;
      let score = 0;
      for (let dy = -5; dy <= 5; dy++)
        for (let dx = -5; dx <= 5; dx++) {
          if (buildable(t, x + dx, y + dy)) score += 1;
          const j = (y + dy) * t.width + (x + dx);
          if (j >= 0 && j < t.resource.length && t.resource[j] === RESOURCE.fertile) score += 2;
        }
      if (score < 60) continue; // not enough land for houses and fields
      if (near(t, x, y, 4, (j) => t.river[j] === 1)) score += 15;
      if (near(t, x, y, 5, (j) => t.biome[j] === BIOME.coast)) score += 8;
      score -= Math.floor(Math.sqrt(d2)) ; // closer is cheaper to settle
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  return bx >= 0 ? { x: bx, y: by } : null;
}

/** Spiral search outward from (cx, cy) for a free, buildable w×h footprint. */
export function findFootprint(
  t: TerrainLayer,
  occupied: Uint8Array,
  cx: number,
  cy: number,
  w: number,
  h: number,
  maxR: number,
  prefer?: (x: number, y: number) => number,
): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx - Math.floor(w / 2);
        const y = cy + dy - Math.floor(h / 2);
        let ok = true;
        for (let yy = y - 1; yy <= y + h && ok; yy++)
          for (let xx = x - 1; xx <= x + w && ok; xx++) {
            // 1-tile margin around each building so sprites never touch
            const inside = xx >= x && xx < x + w && yy >= y && yy < y + h;
            if (inside && !buildable(t, xx, yy)) ok = false;
            if (xx >= 0 && yy >= 0 && xx < t.width && yy < t.height && occupied[yy * t.width + xx]) ok = false;
          }
        if (!ok) continue;
        const score = prefer ? prefer(x, y) : 0;
        if (!best || score > best.score) best = { x, y, score };
      }
    }
    if (best && !prefer) return best;
    if (best && prefer && r >= 3) return best; // for farms, look a little further for fertile land
  }
  return best;
}

export const DEFAULT_POLICIES: Policies = { taxRate: 20, researchBudget: 3200, oversight: 10, foodReserveDays: 5, healthBudget: 1200, welfare: 350, pension: 450, officialWage: 1200, militaryBudget: 3000, quarantine: 0, borders: 0, exportBan: 0 };

/** Starting tech by disposition; the labs move these during the run. */
const START_TECH: Record<Disposition, { agriculture: number; industry: number; medicine: number; automation: number; military: number }> = {
  agrarian: { agriculture: 40, industry: 25, medicine: 25, automation: 5, military: 10 },
  scholarly: { agriculture: 28, industry: 32, medicine: 32, automation: 25, military: 10 },
  martial: { agriculture: 28, industry: 30, medicine: 22, automation: 5, military: 35 },
};

/** Building plan scaled by population and shaped by disposition. */
export function settlementPlan(population: number, disposition: Disposition): { kind: BuildingKind; tier: 1 | 2 | 3 }[] {
  const farms = Math.max(2, Math.round(population / 12)) + (disposition === "agrarian" ? 1 : 0);
  const workshops = Math.max(1, Math.round(population / 40)) + (disposition === "scholarly" ? 1 : 0);
  const markets = Math.max(1, Math.round(population / 60));
  // farms first: when people are few, the fields are staffed before the lab
  const plan: { kind: BuildingKind; tier: 1 | 2 | 3 }[] = [];
  for (let i = 0; i < farms; i++) plan.push({ kind: "farm", tier: disposition === "agrarian" && i === 0 ? 2 : 1 });
  plan.push({ kind: "market", tier: 1 }, { kind: "power_plant", tier: 1 }, { kind: "town_hall", tier: disposition === "martial" ? 2 : 1 });
  for (let i = 0; i < workshops; i++) plan.push({ kind: "workshop", tier: 1 });
  plan.push({ kind: "clinic", tier: 1 }, { kind: "barracks", tier: disposition === "martial" ? 2 : 1 }, { kind: "lab", tier: disposition === "scholarly" ? 2 : 1 });
  for (let i = 1; i < markets; i++) plan.push({ kind: "market", tier: 1 });
  const housesNeeded = Math.ceil(population / 4) + 1;
  for (let i = 0; i < housesNeeded; i++) plan.push({ kind: "house", tier: 1 });
  return plan;
}

export function generateSettlement(
  t: TerrainLayer,
  rng: RngState,
  settlementId: number,
  civId: number,
  ids: { building: number; business: number },
  population: number,
  disposition: Disposition,
  occupied: Uint8Array,
  taken: { x: number; y: number }[],
  minSiteDist: number,
): SettlementBundle {
  const site = chooseSite(t, taken, minSiteDist);
  taken.push(site);
  const name = townName(rng);
  const buildings: Building[] = [];
  const businesses: Business[] = [];

  const fertileScore = (x: number, y: number) => {
    let s = 0;
    for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) if (t.resource[yy * t.width + xx] === RESOURCE.fertile) s++;
    return s;
  };

  const plan = settlementPlan(population, disposition);
  for (const { kind, tier } of plan) {
    const size = BUILDING_SIZE[kind];
    let spot = findFootprint(t, occupied, site.x, site.y, size.w, size.h, kind === "house" ? TOWN_RADIUS + 12 : kind === "farm" ? TOWN_RADIUS + 9 : TOWN_RADIUS + 6, kind === "farm" ? fertileScore : undefined);
    if (!spot && kind === "house") spot = findFootprint(t, occupied, site.x, site.y, size.w, size.h, TOWN_RADIUS + 24); // nobody sleeps outside: look further
    if (!spot) continue;
    for (let yy = spot.y; yy < spot.y + size.h; yy++) for (let xx = spot.x; xx < spot.x + size.w; xx++) occupied[yy * t.width + xx] = 1;
    const id = ids.building++;
    const bizKind = BUILDING_BUSINESS[kind];
    let bizId = -1;
    if (bizKind) {
      const tpl = BUSINESS_DEFAULTS[bizKind];
      bizId = ids.business++;
      businesses.push({
        id: bizId,
        alive: true,
        kind: bizKind,
        building: id,
        settlement: settlementId,
        owner: -1,
        employees: [],
        wage: tpl.wage,
        cash: tpl.cash,
        inventory: { ...zeroInventory(), ...(STARTING_INVENTORY[bizKind] ?? {}) },
        baseOutput: tpl.baseOutput,
        produces: tpl.produces,
        inputs: { ...tpl.inputs },
        automation: 0,
        profit30: 0,
        insolventDays: 0,
        lastOutput: 0,
        staffTarget: tpl.staff + (tier - 1) * (bizKind === "barracks" ? 4 : 1),
        lastLayoffDay: -1,
        lastUpgradeDay: -1,
      });
    }
    buildings.push({
      id,
      alive: true,
      kind,
      x: spot.x,
      y: spot.y,
      settlement: settlementId,
      condition: 100,
      tier,
      capacity: kind === "house" ? 4 : 0,
      business: bizId,
    });
  }

  // claim territory
  for (let dy = -TOWN_RADIUS; dy <= TOWN_RADIUS; dy++)
    for (let dx = -TOWN_RADIUS; dx <= TOWN_RADIUS; dx++) {
      const x = site.x + dx;
      const y = site.y + dy;
      if (x < 0 || y < 0 || x >= t.width || y >= t.height) continue;
      if (dx * dx + dy * dy > TOWN_RADIUS * TOWN_RADIUS) continue;
      const i = y * t.width + x;
      if (t.biome[i] !== BIOME.ocean) t.owner[i] = settlementId + 1;
    }

  const settlement: Settlement = {
    id: settlementId,
    alive: true,
    name,
    civ: civId,
    cx: site.x,
    cy: site.y,
    population: 0,
    unrest: 0,
    unrestStreak: 0,
    housingShortage: 0,
    fear: 0,
    raidedDay: -1,
    lostRaids: 0,
    parent: -1,
    foundedDay: 0,
  };

  // public budgets scale with the facilities they fund
  const clinics = plan.filter((p) => p.kind === "clinic").length;
  const labs = plan.filter((p) => p.kind === "lab").length;
  const policies: Policies = {
    ...DEFAULT_POLICIES,
    healthBudget: DEFAULT_POLICIES.healthBudget * clinics,
    researchBudget: DEFAULT_POLICIES.researchBudget * labs * (disposition === "scholarly" ? 2 : 1),
    militaryBudget: disposition === "martial" ? 5000 + 1000 * nextInt(rng, 0, 3) : 3000 + 1000 * nextInt(rng, 0, 2),
    foodReserveDays: disposition === "agrarian" ? 10 : 5,
    oversight: disposition === "scholarly" ? 5 : 15,
  };

  const civ: Civilization = {
    id: civId,
    alive: true,
    name: civName(rng, name, disposition),
    form: disposition === "martial" ? "autocracy" : disposition === "scholarly" ? "technocracy" : "council",
    ruler: -1,
    settlements: [settlementId],
    treasury: 16000 * population,
    policies: { ...policies },
    basePolicies: { ...policies },
    policyLock: {},
    legitimacy: 60,
    relations: {},
    tech: { ...START_TECH[disposition], machineAutonomyRisk: 0 },
    disposition,
    color: civId,
    attitude: {},
    wars: {},
    ceasefireUntil: 0,
    lastRaidDay: -1,
    researchFocus: disposition === "agrarian" ? "agriculture" : disposition === "scholarly" ? "automation" : "military",
    researchPool: 0,
    conquests: [],
    irrigated: false,
    focusLockedUntil: 0,
    migrantsIn: 0,
    migrantsOut: 0,
    tradeIn: 0,
    tradeOut: 0,
    lastColonyDay: -1,
    closedDays: 0,
    quarantineDays: 0,
    births: 0,
  };

  const market: MarketState = {
    settlement: settlementId,
    price: { food: 300, materials: 500, energy: 200 },
    supplied: zeroInventory(),
    demanded: zeroInventory(),
    reserve: zeroInventory(),
    spikeDay: { food: -1, materials: -1, energy: -1 },
  };

  return { settlement, civ, market, buildings, businesses };
}
