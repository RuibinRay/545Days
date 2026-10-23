# 02 — Data models

The models are code, not prose: **`src/sim/types.ts`** is the source of truth. This page explains the conventions and the parts that are easy to get wrong.

## Conventions

| Rule | Why |
|---|---|
| Plain data only (no classes, Maps, Sets, functions) | `structuredClone` for snapshots/forks, `postMessage` to Workers, IndexedDB persistence, JSON export — all for free. |
| `id === array index`; removals are tombstones (`alive: false`) | Stable ids across the run; the event log and clues can reference anything that ever existed. |
| Integers everywhere: cents, units, per-mille | Cross-engine bit-exact determinism; no `0.1 + 0.2` surprises in a ledger. |
| Typed arrays for terrain layers | 9k–65k tiles; a `Uint8Array` is 1 byte/tile and clones fast. |
| Hidden story data lives *in* state but is tagged (`secret`, `storyRole`) | The engine needs it; the UI filters it. Never two sources of truth. |

## The entities

```
WorldState
├─ terrain: TerrainLayer       biome / elevation / moisture / resource / river / owner
├─ climate                      rainfall, season, droughtDays, pollution
├─ citizens[]                   needs, skills, wealth, health, infection, memories, beliefs, relationships, goal, itinerary
├─ buildings[]                  kind, position, condition, tier, capacity, business link
├─ businesses[]                 owner, employees, wage, cash, inventory, inputs→output, automation, profit30
├─ settlements[]                civ, centre, population, unrest, housingShortage
├─ civs[]                       form, ruler, treasury, policies, legitimacy, relations, tech
├─ markets[]                    per-settlement prices, cleared quantities, public reserve
├─ projects[]                   research projects (lab, lead, field, progress, safety, funded, secret)
├─ story                        baseline ending + schedule, fired/cancelled events, clues, influence/knowledge, interventions
└─ rng                          7 named xoshiro128** streams
```

Alongside the state, each run accumulates `WorldEvent[]` (the history), `DailyMetrics[]` (the charts) and `LedgerEntry[]` (money movements; kept only in dev/test builds beyond the last 30 days).

## The three fields that carry the game

1. **`Citizen.weights` + `beliefs`** — the decision function (docs/03 §2) is `U(a) = w_income·I + w_needs·N + w_social·S − w_risk·R − w_cost·C`. Traits set the initial weights; memories update beliefs; beliefs modulate `R`. That is how a citizen who watched a business fail becomes risk-averse without any special-case code.
2. **`Civilization.tech.machineAutonomyRisk`** — a single 0..100 scalar that automation, centralization and research progress push up and oversight pushes down. Machine Dominion's eligibility reads it. Making this one number visible (once discovered) is the whole Story Mode loop in miniature.
3. **`WorldEvent.causes`** — every emitted event names the events/metrics that produced it. The "why did this happen?" inspector is a graph walk over this field, not an LLM guess.

## Snapshots and saves

- Snapshot every 30 days and immediately before each intervention. 545 days → ≤ 19 scheduled snapshots + interventions. At ~150 citizens a snapshot is ~200 KB; a full run is a few MB in IndexedDB. Fine.
- Fork = clone a snapshot, assign a new `SavedWorld.id`, keep the same seed, append a `forkedFrom` note in the event log.
- Replay = snapshot at day *d* + the intervention list from *d* onward → must reach the same `hashState` as the original (tested).

## Save-format versioning

`WorldState.version` is a literal `1`. Any change to `types.ts` that affects persisted shape bumps it and adds a migration in `src/storage/migrations.ts`. There are no silent shape changes.

## Memory budget (why `memories` is capped)

`Citizen.memories` is capped at 24 entries (ring buffer; older entries with |valence| < 20 are dropped first). Uncapped memories were the single biggest state-size risk; 150 citizens × 545 days × 1 memory/day would be 80k objects.

## M7 as built (2026-10-22) — additions to the shapes

- `Citizen`: `partner` (mirrored id or −1), `born` (day, −1 for the Day-0 population); `Relationship.kind` adds `partner`.
- `Settlement`: `parent` (settlement it was founded from, −1 for Day-0 towns), `foundedDay`.
- `Policies`: `borders` and `exportBan` (0/100) beside `quarantine`; `TogglePolicy` names the three. `Civilization`: `policyLock` (per toggle, the day the ruler may manage it again), `tradeIn`/`tradeOut` (units by caravan), `births`, `lastColonyDay`, `closedDays`.
- `Caravan` (`id, from, to, good, qty, departDay, arriveDay, merchant, paid`); `WorldState.caravans`, `nextCaravanId`. Cargo in flight is money already spent and goods not yet anywhere — the invariant counts it.
- `DailyMetrics`: `births`, `trade`, `caravans`.
- `Intervention`: `found_colony { civ, from }` (10 ◆). `EndingResult.family` adds `society`.
- `WorldState.version` and `SavedWorld.version` are 3; older saves are refused with a message.
- Protocol: `CivSnapshot` adds births, trade in/out, borders, exportBan, closedDays, policyLock; `SettlementSnapshot` adds parent, foundedDay, homeless, foodRatio, sick; `RenderFrame` adds `caravans`, `routes`, `applied` and an optional `delta` (new citizens, new settlements, owner map); `CitizenDetail` adds partner, born, origin, children.
- Storage: IndexedDB version 2 adds an `achievements` store (`id, earnedAt, world, day`).
