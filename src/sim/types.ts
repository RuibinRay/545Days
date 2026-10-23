/**
 * 545 DAYS — simulation data models.
 *
 * Rules for this file (see docs/01-architecture.md §5):
 *  - Everything is plain data. No classes, no functions, no Maps/Sets. The whole
 *    WorldState must survive structuredClone + JSON round-trips unchanged.
 *  - Money and goods are integers. Money is in cents.
 *  - Entities live in arrays indexed by their numeric id (id === array index).
 *    Dead/removed entities are tombstoned (`alive: false`), never spliced, so ids
 *    stay stable across the run and the event log stays meaningful.
 *  - Anything the renderer needs is derived into a RenderFrame (workers/protocol.ts);
 *    the renderer never reads WorldState directly.
 */

// ───────────────────────────── ids & scalars ─────────────────────────────

export type CitizenId = number;
export type BuildingId = number;
export type BusinessId = number;
export type SettlementId = number;
export type CivId = number;
export type ProjectId = number;
export type EventId = string; // story-event definition id, e.g. "md.lab_funded"

/** Integer cents. */
export type Money = number;
/** 0..100 integer. */
export type Pct = number;
export type Day = number;

export const GOODS = ["food", "materials", "energy"] as const;
export type Good = (typeof GOODS)[number];
export type Inventory = Record<Good, number>;

// ───────────────────────────── RNG ─────────────────────────────

export const RNG_STREAMS = [
  "worldgen",
  "weather",
  "citizens",
  "market",
  "health",
  "story",
  "civ",
] as const;
export type RngStream = (typeof RNG_STREAMS)[number];

/** xoshiro128** state: four uint32s. */
export type RngState = [number, number, number, number];
export type RngStreams = Record<RngStream, RngState>;

// ───────────────────────────── world / terrain ─────────────────────────────

export type Biome = "ocean" | "coast" | "grassland" | "forest" | "hills" | "mountain" | "desert";
export type Resource = "none" | "fertile" | "ore" | "coal" | "aquifer";

export interface TerrainLayer {
  width: number;
  height: number;
  /** Row-major, length width*height. Values index into Biome via BIOME_INDEX. */
  biome: Uint8Array;
  /** 0..255 elevation. */
  elevation: Uint8Array;
  /** 0..255 soil moisture; drought lowers it, recovery pulls it back toward baseMoisture. */
  moisture: Uint8Array;
  /** 0..255 equilibrium moisture from worldgen; the recovery target (docs/03 §1). */
  baseMoisture: Uint8Array;
  /** Resource deposit per tile; see RESOURCE_INDEX. */
  resource: Uint8Array;
  /** 1 if a river flows through the tile. */
  river: Uint8Array;
  /** 1 if within 2 tiles of a river: river-fed land, exempt from drought drying and quick to recover. */
  riverNear: Uint8Array;
  /** Owning settlement id + 1, 0 = unclaimed. */
  owner: Uint16Array;
}

export interface Climate {
  /** 0..100. Long-run rainfall multiplier; drought chains push this down. */
  rainfall: Pct;
  /** Season 0..3 (spring, summer, autumn, winter). Derived from day. */
  season: 0 | 1 | 2 | 3;
  /** Remaining days of active drought, 0 = none. */
  droughtDays: number;
  /** 0..100 pollution index (energy mix + factories). */
  pollution: Pct;
}

// ───────────────────────────── people ─────────────────────────────

export type Occupation =
  | "unemployed"
  | "farmer"
  | "worker"      // workshop / factory
  | "merchant"
  | "engineer"
  | "scientist"
  | "doctor"
  | "official"
  | "soldier"     // barracks
  | "ruler"       // king / chancellor / elder — one per civilization
  | "retired"
  | "child";

export type Trait =
  | "ambitious" | "cautious" | "generous" | "greedy" | "curious"
  | "secretive" | "loyal" | "rebellious" | "frugal" | "social";

export type CitizenAction = "work" | "seek_job" | "rest" | "socialize" | "study" | "start_business" | "none";

export interface Needs {
  /** 0..100. 0 = starving. Falls daily, restored by eating. */
  food: Pct;
  /** 0..100. Falls if homeless or housing overcrowded. */
  shelter: Pct;
  /** 0..100. Falls with unrest, crime, war nearby. */
  safety: Pct;
  /** 0..100. Falls with isolation, rises with social visits. */
  belonging: Pct;
}

export interface Memory {
  day: Day;
  /** Event definition id or a system tag, e.g. "econ.wage_cut". */
  tag: string;
  /** -100..100. How the citizen felt about it. */
  valence: number;
  /** Optional subject the memory is about. */
  aboutCitizen?: CitizenId;
  aboutBusiness?: BusinessId;
}

export interface Belief {
  /** e.g. "lab_is_dangerous", "government_is_fair", "business_is_risky". */
  key: string;
  /** 0..100 confidence. Beliefs feed decision weights; they can be wrong. */
  strength: Pct;
}

export interface Relationship {
  other: CitizenId;
  /** -100..100. */
  affinity: number;
  kind: "family" | "friend" | "coworker" | "rival" | "partner";
}

export interface Citizen {
  id: CitizenId;
  alive: boolean;
  name: string;
  age: number;
  traits: Trait[];
  settlement: SettlementId;
  home: BuildingId | -1;
  workplace: BusinessId | -1;
  occupation: Occupation;
  /** Skill levels 0..100 by domain. */
  skills: { farming: Pct; craft: Pct; science: Pct; trade: Pct; care: Pct; combat: Pct };
  wealth: Money;
  /** Personal food stock (units). */
  foodStock: number;
  health: Pct;
  /** Infection state for disease endings. */
  infection: "none" | "incubating" | "sick" | "recovered";
  infectionDay: Day;
  /** Settlement the citizen was born in (migration changes `settlement`, not this). */
  origin: SettlementId;
  /** Partner (a `partner` relationship, mirrored), or -1. Partners share a home and may have children (M7). */
  partner: CitizenId | -1;
  /** Day of birth for citizens born during the run; -1 for the Day-0 population. */
  born: Day;
  needs: Needs;
  /** Weights for the decision function, 0..100 each; see docs/03 §2. */
  weights: { income: Pct; needs: Pct; social: Pct; risk: Pct; cost: Pct };
  /** Long-term goal, chosen from a small table; drives multi-day plans. */
  goal: "survive" | "save" | "start_business" | "get_promoted" | "research" | "migrate" | "lead";
  memories: Memory[];
  beliefs: Belief[];
  relationships: Relationship[];
  /** Yesterday's itinerary for the renderer: building ids visited in order. */
  itinerary: BuildingId[];
  /** Action chosen today (phase 3); drives production, itinerary and skill growth. */
  action: CitizenAction;
  /** Days since the citizen last ate. */
  hungryDays: number;
  /** Day the citizen's job started (-1 if unemployed); for the inspector only. */
  hiredDay: Day;
  /** Story flag: this citizen is referenced by a story chain (not shown to player). */
  storyRole?: string;
}

// ───────────────────────────── buildings & businesses ─────────────────────────────

export type BuildingKind =
  | "house" | "farm" | "workshop" | "factory" | "market" | "clinic"
  | "lab" | "town_hall" | "power_plant" | "warehouse" | "barracks" | "ruin";

export interface Building {
  id: BuildingId;
  alive: boolean;
  kind: BuildingKind;
  x: number;
  y: number;
  settlement: SettlementId;
  /** 0..100 structural condition; disasters and neglect lower it. */
  condition: Pct;
  /** 0..3 visual tier; grows with the owning business's capital or household wealth. */
  tier: 0 | 1 | 2 | 3;
  /** For homes: capacity in residents. */
  capacity: number;
  business: BusinessId | -1;
}

export type BusinessKind = "farm" | "workshop" | "factory" | "market" | "clinic" | "lab" | "power_plant" | "barracks";

export interface Business {
  id: BusinessId;
  alive: boolean;
  kind: BusinessKind;
  building: BuildingId;
  settlement: SettlementId;
  owner: CitizenId | -1; // -1 = publicly owned
  employees: CitizenId[];
  /** Per-day wage offered, cents. */
  wage: Money;
  cash: Money;
  inventory: Inventory;
  /** Output per worker-day at full productivity, in units of `produces`. */
  baseOutput: number;
  produces: Good | "service";
  /** Inputs consumed per unit of output. */
  inputs: Partial<Inventory>;
  /** 0..100. Automation raises output per worker and lowers hiring. */
  automation: Pct;
  /** Exponentially-weighted ~30-day profit, cents; drives expansion/closure decisions. */
  profit30: Money;
  /** Consecutive days the business could not meet payroll. */
  insolventDays: number;
  /** Units produced yesterday (0 for services). */
  lastOutput: number;
  /** Target headcount (template staff, grows with tier). */
  staffTarget: number;
  /** Day of the last layoff (-1 never); layoffs have a 30-day cooldown. */
  lastLayoffDay: Day;
  /** Day of the last tier upgrade (-1 never); upgrades have a 60-day cooldown. */
  lastUpgradeDay: Day;
}

// ───────────────────────────── markets & money ─────────────────────────────

export interface MarketState {
  settlement: SettlementId;
  /** Price per unit, cents. */
  price: Record<Good, Money>;
  /** Yesterday's cleared quantities, for metrics and price adjustment. */
  supplied: Inventory;
  demanded: Inventory;
  /** Public stockpile held by the government (food reserve policy). */
  reserve: Inventory;
  /** Day of the last price-spike event per good (-1 never); spikes are reported at most every 30 days. */
  spikeDay: Record<Good, Day>;
}

/**
 * Money is conserved. Every change to any `wealth`/`cash`/`treasury` field goes
 * through a LedgerEntry. The invariant test sums all balances and asserts
 * total === initialTotal + minted − burned.
 */
export interface LedgerEntry {
  day: Day;
  from: AccountRef;
  to: AccountRef;
  amount: Money;
  reason: string;
}
export type AccountRef =
  | { kind: "citizen"; id: CitizenId }
  | { kind: "business"; id: BusinessId }
  | { kind: "treasury"; id: CivId }
  | { kind: "mint" }   // only for explicitly modeled money creation
  | { kind: "burn" };

// ───────────────────────────── settlements & civilizations ─────────────────────────────

export interface Settlement {
  id: SettlementId;
  alive: boolean;
  name: string;
  civ: CivId;
  cx: number;
  cy: number;
  /** Derived daily; stored for the frame and the metrics. */
  population: number;
  unrest: Pct;
  /** Consecutive days with unrest > 70; riots fire at multiples of 20. */
  unrestStreak: number;
  housingShortage: number;
  /** 0..100 war fear; set by raids, decays daily; feeds the safety need. */
  fear: Pct;
  /** Day of the last raid suffered (-1 never). */
  raidedDay: Day;
  /** Raids lost in a row while at war; a third lost raid with no soldiers left means conquest. */
  lostRaids: number;
  /** Settlement this one was founded from (-1 for Day-0 towns), and the day. */
  parent: SettlementId | -1;
  foundedDay: Day;
}

export type GovernmentForm = "council" | "republic" | "autocracy" | "technocracy" | "machine";

/** The 0/100 policies a ruler toggles on their own and the player can lock for a season. */
export type TogglePolicy = "quarantine" | "borders" | "exportBan";

export interface Policies {
  /** Income tax rate 0..100 (percent of wages). */
  taxRate: Pct;
  /** Daily research grant to labs, cents. */
  researchBudget: Money;
  /** 0..100 strength of AI/automation oversight law. */
  oversight: Pct;
  /** Target public food reserve in days of consumption. */
  foodReserveDays: number;
  /** Daily public-health spend, cents. */
  healthBudget: Money;
  /** Daily payment to each unemployed adult, cents. */
  welfare: Money;
  /** Daily payment to each retired citizen, cents. */
  pension: Money;
  /** Daily wage of the town's official(s), cents. */
  officialWage: Money;
  /** Daily grant to barracks, cents (soldiers' wages come out of it). */
  militaryBudget: Money;
  /** 0 or 100: a quarantine closes the town to travellers (no trade contacts in or out). */
  quarantine: Pct;
  /** 0 or 100: closed borders turn migrants away (trade and travel continue). */
  borders: Pct;
  /** 0 or 100: no food leaves this civ's towns by caravan (its own colonies excepted). Rulers impose it when bread is dear. */
  exportBan: Pct;
}

/** What a civilization is built around. Sets its starting buildings, policies and its ruler's instincts. */
export type Disposition = "agrarian" | "scholarly" | "martial";

export type ResearchField = "agriculture" | "industry" | "medicine" | "automation" | "military";

export interface Civilization {
  id: CivId;
  alive: boolean;
  name: string;
  form: GovernmentForm;
  ruler: CitizenId | -1;
  settlements: SettlementId[];
  treasury: Money;
  policies: Policies;
  /** Day-0 policy values; the fiscal rule cuts toward 60 % of these and restores toward them. */
  basePolicies: Policies;
  /** Toggle policies the player decreed, with the day the ruler may manage them again (M7). */
  policyLock: Partial<Record<TogglePolicy, Day>>;
  /** 0..100 how much the population accepts the government. */
  legitimacy: Pct;
  /** Diplomatic stance towards each other civ, by id. */
  relations: Record<CivId, "trade" | "neutral" | "embargo">;
  tech: TechState;
  disposition: Disposition;
  /** Index into the renderer's civ palette. */
  color: number;
  /** -100..100 feeling toward each other civ; war below -50, peace talks above -20. */
  attitude: Record<CivId, number>;
  /** Civ ids this civ is at war with, with the day the war began. */
  wars: Record<CivId, Day>;
  /** No new war may be declared before this day (after a peace or a ruler's death). */
  ceasefireUntil: Day;
  /** Day of this civ's last raid as attacker (-1 never). */
  lastRaidDay: Day;
  /** Field the labs work on; the ruler switches it. */
  researchFocus: ResearchField;
  /** Accumulated points toward the next level of `researchFocus`. */
  researchPool: number;
  /** Settlements this civ has taken by conquest (ids), for the endings. */
  conquests: SettlementId[];
  /** Irrigation works (gd chain or agriculture research): farms shrug off part of a drought. */
  irrigated: boolean;
  /** The ruler leaves the research focus alone until this day (after the player set it). */
  focusLockedUntil: Day;
  /** Citizens who arrived from / left for other settlements, for the endings. */
  migrantsIn: number;
  migrantsOut: number;
  /** Units of goods carried into / out of this civ's towns by caravans, cumulative. */
  tradeIn: number;
  tradeOut: number;
  /** Day the civ last founded a colony (-1 never). */
  lastColonyDay: Day;
  /** Days this civ has kept its borders shut, cumulative (M7). */
  closedDays: number;
  /** Days this civ has been under quarantine, cumulative (M10). */
  quarantineDays: number;
  /** Births in this civ's towns, cumulative. */
  births: number;
}

/** Goods on the road between two markets (M7). Bought at `from` on `departDay`, sold by the market at `to` from `arriveDay`. */
/** A land path between two towns (M8): tile indices from `a`'s centre to `b`'s, a < b. */
export interface Road {
  a: SettlementId;
  b: SettlementId;
  tiles: number[];
}

export interface Caravan {
  id: number;
  from: SettlementId;
  to: SettlementId;
  good: Good;
  qty: number;
  departDay: Day;
  arriveDay: Day;
  /** The importing market business that paid for the goods. */
  merchant: BusinessId;
  /** What the importer paid, cents (for the tariff and the chronicle). */
  paid: Money;
}

export interface TechState {
  /** 0..100 each. Thresholds unlock business upgrades and story events. */
  agriculture: Pct;
  industry: Pct;
  medicine: Pct;
  automation: Pct;
  military: Pct;
  /** 0..100. Rises with automation and centralization, falls with oversight. */
  machineAutonomyRisk: Pct;
}

export interface ResearchProject {
  id: ProjectId;
  alive: boolean;
  name: string;
  lab: BusinessId;
  lead: CitizenId;
  field: keyof Omit<TechState, "machineAutonomyRisk">;
  progress: Pct;
  /** Safety work completed 0..100; low safety + high progress = risk. */
  safety: Pct;
  funded: boolean;
  /** Hidden from the player until discovered via clues. */
  secret: boolean;
}

// ───────────────────────────── story layer ─────────────────────────────

export interface StoryState {
  /** Ending the Oracle baseline reached; null in God Sandbox. */
  baselineEnding: string | null;
  /** Event ids that fired in the baseline, with the day. */
  baselineSchedule: { id: EventId; day: Day }[];
  /** Event ids that have fired in THIS run. */
  fired: { id: EventId; day: Day }[];
  /** Events blocked permanently (their chain was broken). */
  cancelled: EventId[];
  /** Clues revealed to the player so far. */
  clues: RevealedClue[];
  /** Player resources in Story Mode. */
  influence: number;
  knowledge: number;
  /** Days on which the player intervened and how. */
  interventions: Intervention[];
  /** Missions offered to the player (M4): accept or decline, each with real consequences. */
  missions: Mission[];
  nextMissionDay: Day;
  /** Last day each target was investigated ("c12" citizen, "b4" building), for the cooldown. */
  revealLog: Record<string, Day>;
  /** Visions whose clear line the player has bought with Knowledge (indices). */
  revealedVisions: number[];
  /** Notable events of the last 90 days (importance ≥ 5), for story conditions. Trimmed daily. */
  recent: WorldEvent[];
  /** Copied from WorldSettings at generation so the pure engine can read it (chains scale by it). */
  disasters: WorldSettings["disasters"];
  /** Day-0 population per settlement, for abandonment and the drought ending. */
  startPopulation: Record<SettlementId, number>;
}

/** Influence and Knowledge economy (docs/05 "Interventions"). Integers. */
export const STORY_ECON = {
  influenceStart: 15,
  influenceCap: 30,
  /** Influence regained every `influenceEveryDays` days. */
  influenceRegen: 1,
  influenceEveryDays: 2,
  /** Knowledge needed to read one vision's clear line. */
  visionRevealCost: 5,
  /** Investigating a person or building: Influence cost, Knowledge gained, and the per-target cooldown. */
  revealCost: 1,
  revealKnowledgeEvidence: 2,
  revealKnowledgeRumor: 1,
  revealCooldownDays: 60,
  /** Influence cost by intervention type (missions charge the sum of their effects). */
  cost: {
    remove_citizen: 15, destroy_building: 10, build: 8, set_policy: 4, set_attitude: 6, nudge_belief: 3, disaster: 12, reveal: 1,
    mission: 0, fund_project: 6, defund_project: 6, nudge_trait: 8, relocate_citizen: 5, paint_terrain: 0, reveal_vision: 0, set_focus: 4,
    found_colony: 10,
  } as Record<Intervention["type"], number>,
} as const;

export type MissionStatus = "offered" | "accepted" | "declined" | "expired";

export interface Mission {
  id: number;
  /** Template id, e.g. "remove_researcher". */
  template: string;
  offeredDay: Day;
  expiresDay: Day;
  status: MissionStatus;
  resolvedDay: Day;
  title: string;
  /** Why the Oracle raises it, with names filled in. */
  brief: string;
  /** What accepting does, in one sentence. */
  action: string;
  /** Who it is about. */
  civ: CivId;
  targets: { citizen?: CitizenId; building?: BuildingId; business?: BusinessId; otherCiv?: CivId; settlement?: SettlementId };
  /** The interventions applied on acceptance (their `day` is filled in then). */
  effects: InterventionSpec[];
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
/** An intervention without its day: what a mission or a UI control intends to do. */
export type InterventionSpec = DistributiveOmit<Intervention, "day">;

export interface RevealedClue {
  id: string;
  day: Day;
  /** "rumor" can be false; "evidence" is drawn from verified state. */
  grade: "rumor" | "evidence" | "vision";
  text: string;
  /** What the clue links to on the evidence board. */
  refs: { citizen?: CitizenId; business?: BusinessId; project?: ProjectId; event?: EventId };
}

export type Intervention =
  | { day: Day; type: "set_policy"; civ: CivId; key: keyof Policies; value: number }
  | { day: Day; type: "fund_project"; project: ProjectId; amount: Money }
  | { day: Day; type: "defund_project"; project: ProjectId }
  | { day: Day; type: "nudge_trait"; citizen: CitizenId; add?: Trait; remove?: Trait }
  | { day: Day; type: "nudge_belief"; citizen: CitizenId; key: string; delta: number }
  | { day: Day; type: "relocate_citizen"; citizen: CitizenId; settlement: SettlementId }
  | { day: Day; type: "remove_citizen"; citizen: CitizenId }          // "eliminate"; expensive, consequences
  | { day: Day; type: "build"; kind: BuildingKind; x: number; y: number; settlement: SettlementId }
  | { day: Day; type: "destroy_building"; building: BuildingId }
  | { day: Day; type: "paint_terrain"; x: number; y: number; r: number; biome: Biome }  // sandbox only
  | { day: Day; type: "disaster"; kind: "drought" | "fire" | "quake" | "outbreak"; settlement: SettlementId; intensity: Pct }
  | { day: Day; type: "reveal"; target: "project" | "citizen" | "building"; id: number }   // investigate: a record or a rumor, for Knowledge
  | { day: Day; type: "set_attitude"; civ: CivId; other: CivId; value: number }        // a decree of peace or enmity
  | { day: Day; type: "mission"; mission: number; accept: boolean }
  | { day: Day; type: "reveal_vision"; vision: number }                                  // spend Knowledge to read a clear line
  | { day: Day; type: "set_focus"; civ: CivId; field: ResearchField }                    // tell a civ's lab what to work on
  | { day: Day; type: "found_colony"; civ: CivId; from: SettlementId };                 // a second town, paid from the treasury, settled by the crowded

// ───────────────────────────── events, metrics, snapshots ─────────────────────────────

/** Anything that happened and might matter to the player or the narrator. */
export interface WorldEvent {
  day: Day;
  /** Dotted namespace: "econ.business_closed", "story.md.lab_funded", "health.outbreak". */
  type: string;
  /** 0..10. ≥7 pauses Story Mode and appears in the timeline. */
  importance: number;
  citizens?: CitizenId[];
  businesses?: BusinessId[];
  settlement?: SettlementId;
  civ?: CivId;
  /** Free-form numeric payload for the narrator and the inspector (before/after values). */
  data?: Record<string, number | string>;
  /** Event ids or metric names that contributed; this is what "why did this happen" reads. */
  causes?: string[];
}

export interface DailyMetrics {
  day: Day;
  population: number;
  births: number;
  deaths: number;
  gdp: Money;               // sum of value of goods produced at market price + wages for services
  gdpPerCapita: Money;
  unemployment: Pct;
  gini: number;             // 0..1000 integer (per-mille), so metrics stay integer-only
  priceIndex: number;       // 1000 = day-0 basket
  foodDaysReserve: number;
  avgWellbeing: Pct;        // mean of needs
  avgHealth: Pct;
  unrest: Pct;
  treasuryTotal: Money;
  machineAutonomyRisk: Pct;
  infected: number;
  /** Units of goods that arrived by caravan today. */
  trade: number;
  /** Caravans on the road at the end of the day. */
  caravans: number;
}

export interface WorldState {
  version: 3;
  seed: number;
  day: Day;
  mode: "sandbox" | "story" | "chronicle";
  rng: RngStreams;
  terrain: TerrainLayer;
  climate: Climate;
  citizens: Citizen[];
  buildings: Building[];
  businesses: Business[];
  settlements: Settlement[];
  civs: Civilization[];
  markets: MarketState[];
  projects: ResearchProject[];
  /** Goods on the road (M7). Removed on arrival. */
  caravans: Caravan[];
  nextCaravanId: number;
  roads: Road[];
  story: StoryState;
  /** Money minted/burned so far, for the conservation invariant. */
  moneyMinted: Money;
  moneyBurned: Money;
  initialMoney: Money;
}

/** A full copy of state at a day; taken every 30 days and at every intervention. */
export interface Snapshot {
  day: Day;
  state: WorldState;
}

/** Result of the EndingResolver (story/endings.ts). Plain data so it can be saved and posted. */
export interface EndingResult {
  id: string;
  title: string;
  family: "technology" | "disease" | "climate" | "politics" | "society" | "cosmic" | "fallback";
  severity: number;
  day: Day;
  /** Paragraphs. */
  epilogue: string[];
  /** Secondary outcomes: other eligible endings with score ≥ 40. */
  secondary: { id: string; title: string }[];
  /** Headline numbers for the ending screen. */
  stats: { label: string; value: string }[];
}

/** Persisted run: enough to replay or fork. Stored in IndexedDB by the Worker. */
export interface SavedWorld {
  version: 3;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  seed: number;
  mode: WorldState["mode"];
  settings: WorldSettings;
  latest: WorldState;
  /** Day 0, then every 30 days, then every day an intervention was applied (taken before it). */
  snapshots: Snapshot[];
  /** Events with importance ≥ 2. */
  events: WorldEvent[];
  metrics: DailyMetrics[];
  interventions: Intervention[];
  ending: EndingResult | null;
  forkedFrom: { id: string; name: string; day: Day } | null;
  /** Oracle baseline products (story/oracle.ts); null until computed. Stored as plain data. */
  baseline: unknown | null;
}

/** What the saves list shows without loading a world. */
export interface SavedSummary {
  id: string;
  name: string;
  seed: number;
  settlement: string;
  day: Day;
  population: number;
  endingTitle: string | null;
  updatedAt: number;
  forkedFrom: SavedWorld["forkedFrom"];
}

/**
 * Portable export: tiny, because a deterministic world is its seed plus its interventions.
 * `latestHash` lets the importer verify that replaying reproduces the same world.
 */
export interface WorldExport {
  format: "545days-world";
  version: 1;
  name: string;
  seed: number;
  settings: WorldSettings;
  day: Day;
  interventions: Intervention[];
  latestHash: string;
  ending: EndingResult | null;
  exportedAt: number;
}

export interface WorldSettings {
  size: "tiny" | "small" | "medium";
  terrain: "continent" | "archipelago" | "islands";
  climate: "temperate" | "dry" | "mixed";
  civs: 1 | 2 | 3;
  /** Citizens per civilization. */
  population: number;
  disasters: "off" | "low" | "normal" | "chaotic";
  difficulty: "casual" | "standard" | "hard";
  endingPreview: "clear" | "cryptic" | "off";
}

// ───────────────────────────── lookup tables ─────────────────────────────

export const BIOME_INDEX: Biome[] = ["ocean", "coast", "grassland", "forest", "hills", "mountain", "desert"];
export const RESOURCE_INDEX: Resource[] = ["none", "fertile", "ore", "coal", "aquifer"];
