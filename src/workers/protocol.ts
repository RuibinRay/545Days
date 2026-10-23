/**
 * Messages between the main thread and the sim Worker. Everything is plain data.
 * The renderer consumes RenderFrame/WorldInfo only and never sees WorldState (docs/04).
 */
import type { Baseline, Vision } from "../sim/story/oracle";
import type { Belief, BuildingKind, CitizenAction, DailyMetrics, Disposition, EndingResult, Good, GovernmentForm, Intervention, Memory, Mission, Occupation, Policies, ResearchField, RevealedClue, Road, SavedSummary, TechState, TogglePolicy, Trait, WorldEvent, WorldExport, WorldSettings } from "../sim/types";

export type Speed = 0 | 1 | 4 | 16;

/** Real-time milliseconds per simulated day at each speed (docs/01 §6). */
export const MS_PER_DAY: Record<Exclude<Speed, 0>, number> = { 1: 4000, 4: 1000, 16: 250 };

export type MainToWorker =
  | { type: "init"; seed: number; settings: Partial<WorldSettings>; name?: string }
  | { type: "load"; id: string }
  | { type: "setSpeed"; speed: Speed }
  | { type: "stepOnce" }
  | { type: "intervene"; intervention: Intervention }
  | { type: "inspect"; citizen: number }
  | { type: "save" }
  | { type: "rename"; name: string }
  | { type: "fork"; day: number; name?: string }
  | { type: "restart" }
  /** Show the world as it was on `day` without touching the live state; null returns to live. */
  | { type: "peek"; day: number | null }
  | { type: "export" }
  | { type: "import"; data: WorldExport }
  | { type: "listSaves" }
  | { type: "deleteSave"; id: string }
  /** Re-run the forecast for an open mission (it is computed automatically when one is offered). */
  | { type: "forecast"; mission: number };

/** Static description of the world, sent once after init. Terrain arrays are transferred. */
export interface WorldInfo {
  seed: number;
  settings: WorldSettings;
  width: number;
  height: number;
  biome: Uint8Array;
  elevation: Uint8Array;
  moisture: Uint8Array;
  resource: Uint8Array;
  river: Uint8Array;
  owner: Uint16Array;
  settlements: { id: number; name: string; cx: number; cy: number; civName: string; civ: number }[];
  /** Land paths between towns (M8); carts and soldiers follow them, the terrain bakes them. */
  roads: Road[];
  civs: { id: number; name: string; disposition: Disposition; color: number; title: string }[];
  citizens: { id: number; name: string; traits: Trait[]; home: number; goal: string; settlement: number }[];
  initialHash: string;
  /** Save identity. */
  id: string;
  name: string;
  forkedFrom: { id: string; name: string; day: number } | null;
}

/** Column layout of RenderFrame.citizens (Int32Array). */
export const CZ = { id: 0, it0: 1, it1: 2, it2: 3, it3: 4, occ: 5, alive: 6, food: 7, shelter: 8, safety: 9, belonging: 10, health: 11, foodStock: 12, wealth: 13, workplaceBuilding: 14, action: 15, age: 16, settlement: 17, infection: 18, STRIDE: 19 } as const;
/** Values of the CZ.infection column. */
export const INFECTIONS = ["none", "incubating", "sick", "recovered"] as const;
/** Column layout of RenderFrame.buildings (Int32Array). */
export const BD = { id: 0, kind: 1, x: 2, y: 3, tier: 4, condition: 5, alive: 6, business: 7, settlement: 8, STRIDE: 9 } as const;
/** Column layout of RenderFrame.businesses (Int32Array). */
export const BZ = { id: 0, alive: 1, kind: 2, building: 3, cash: 4, wage: 5, employees: 6, staffTarget: 7, profit30: 8, lastOutput: 9, invFood: 10, invMat: 11, invEnergy: 12, owner: 13, insolventDays: 14, STRIDE: 15 } as const;

export interface MarketSnapshot {
  settlement: number;
  price: Record<Good, number>;
  supplied: Record<Good, number>;
  demanded: Record<Good, number>;
  reserve: Record<Good, number>;
}

export interface CivSnapshot {
  id: number;
  name: string;
  alive: boolean;
  disposition: Disposition;
  form: GovernmentForm;
  title: string;
  rulerId: number;
  rulerName: string;
  legitimacy: number;
  treasury: number;
  policies: Policies;
  tech: TechState;
  attitude: Record<number, number>;
  wars: number[];
  ceasefireUntil: number;
  soldiers: number;
  strength: number;
  population: number;
  researchFocus: ResearchField;
  settlements: number[];
  conquests: number;
  color: number;
  sick: number;
  recovered: number;
  quarantine: boolean;
  irrigated: boolean;
  migrantsIn: number;
  migrantsOut: number;
  births: number;
  tradeIn: number;
  tradeOut: number;
  borders: boolean;
  exportBan: boolean;
  closedDays: number;
  quarantineDays: number;
  /** Day the ruler may manage each decreed gate again (M7). */
  policyLock: Partial<Record<TogglePolicy, number>>;
}

export interface SettlementSnapshot {
  id: number;
  name: string;
  civ: number;
  population: number;
  unrest: number;
  fear: number;
  cx: number;
  cy: number;
  /** Settlement this one was founded from, or -1 for a Day-0 town. */
  parent: number;
  foundedDay: number;
  homeless: number;
  /** Food price as a percentage of base. */
  foodRatio: number;
  sick: number;
}

/** A caravan on the road (M7): drawn between its towns by progress. */
export interface CaravanSnapshot {
  id: number;
  from: number;
  to: number;
  good: Good;
  qty: number;
  departDay: number;
  arriveDay: number;
}

/** Additions to WorldInfo since the last frame: people born and towns founded, and the territory map when it changed. */
export interface WorldDelta {
  citizens: WorldInfo["citizens"];
  settlements: WorldInfo["settlements"];
  owner: Uint16Array | null;
  /** Every road, when a new one was laid. */
  roads: Road[] | null;
}

/** What a 90-day replay of one branch of a mission came to. Numbers are differences the player can read. */
export interface BranchSummary {
  label: string;
  days: number;
  deaths: number;
  battleDeaths: number;
  starved: number;
  raids: number;
  wars: number;
  conquests: number;
  successions: number;
  maxRisk: number;
  /** Highest food price per civ over the horizon, cents. */
  foodPeak: Record<number, number>;
  /** Population per civ at the end of the horizon. */
  population: Record<number, number>;
  ending: string | null;
  /** The branch's notable events (importance ≥ 7), for the UI to narrate. */
  notable: WorldEvent[];
}

export interface Forecast {
  mission: number;
  fromDay: number;
  horizon: number;
  act: BranchSummary;
  ignore: BranchSummary;
  /** Wall-clock cost of both replays, ms. */
  ms: number;
}

/** Per-day dynamic data. Typed arrays are transferred, not copied. */
export interface RenderFrame {
  day: number;
  season: 0 | 1 | 2 | 3;
  citizens: Int32Array;
  buildings: Int32Array;
  businesses: Int32Array;
  markets: MarketSnapshot[];
  civs: CivSnapshot[];
  settlements: SettlementSnapshot[];
  caravans: CaravanSnapshot[];
  /** Roads a caravan has ever travelled, as settlement pairs. */
  routes: [number, number][];
  /** Present when the world grew since the last frame (births, colonies, conquest). */
  delta?: WorldDelta;
  /** The player's interventions applied this day, so the main thread's history keeps up without a reload. */
  applied: Intervention[];
  missions: Mission[];
  /** The player's resources and what they have learned. */
  story: { influence: number; knowledge: number; clues: RevealedClue[]; revealedVisions: number[]; revealLog: Record<string, number> };
  climate: { droughtDays: number; pollution: number; rainfall: number };
  /** Events emitted today with importance ≥ 2. */
  events: WorldEvent[];
  metrics: DailyMetrics;
  /** Worker-side wall-clock cost of this day's step, for the ?why panel. */
  stepMs: number;
  hash: string;
  /** Days that have a snapshot (fork points). */
  snapshotDays: number[];
}

export interface CitizenDetail {
  id: number;
  partner: number;
  born: number;
  origin: number;
  /** Children under the same roof. */
  children: number[];
  memories: Memory[];
  beliefs: Belief[];
  relationships: { other: number; affinity: number; kind: string }[];
  skills: Record<string, number>;
  hiredDay: number;
  hungryDays: number;
}

export type WorkerToMain =
  | { type: "world"; info: WorldInfo; history: { events: WorldEvent[]; metrics: DailyMetrics[]; interventions: Intervention[]; ending: EndingResult | null; snapshotDays: number[] } }
  | { type: "frame"; frame: RenderFrame }
  | { type: "peek"; frame: RenderFrame | null }
  | { type: "speed"; speed: Speed }
  | { type: "inspect"; detail: CitizenDetail }
  | { type: "ending"; ending: EndingResult }
  | { type: "forecast"; forecast: Forecast }
  /** The Day-0 baseline and the visions written from it; sent after `world` once computed. */
  | { type: "oracle"; baseline: Baseline; visions: Vision[]; fresh: boolean }
  | { type: "saved"; id: string; name: string; day: number; updatedAt: number; auto: boolean }
  | { type: "saves"; list: SavedSummary[] }
  | { type: "exported"; data: WorldExport; filename: string }
  | { type: "imported"; verified: boolean; message: string }
  | { type: "error"; message: string };

export const OCCUPATIONS: Occupation[] = [
  "unemployed", "farmer", "worker", "merchant", "engineer", "scientist", "doctor", "official", "soldier", "ruler", "retired", "child",
];
export const BUILDING_KINDS: BuildingKind[] = [
  "house", "farm", "workshop", "factory", "market", "clinic", "lab", "town_hall", "power_plant", "warehouse", "barracks", "ruin",
];
export const BUSINESS_KINDS = ["farm", "workshop", "factory", "market", "clinic", "lab", "power_plant", "barracks"] as const;
export const ACTIONS: CitizenAction[] = ["work", "seek_job", "rest", "socialize", "study", "start_business", "none"];
