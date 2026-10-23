# 01 — Game design architecture

**Project:** 545 DAYS — browser-based civilization god simulator with a pre-simulated future.
**Status:** M0 design package (2026-10-21). Nothing in this document describes a running system yet.
**Reader:** the next developer or AI session. Read this before touching any other file.

---

## 1. One-paragraph definition

A player creates a small world. The engine secretly simulates its next 545 days with no intervention, determines which of a set of defined endings that baseline reaches, and shows the player fragments of it. The world is reset to Day 0 and the player can observe, investigate, and intervene. On Day 545 the engine evaluates the *actual* world state and picks the ending that fits. The promise: the future has been simulated, not decided.

## 2. Non-goals for v1 (explicit, so nobody re-litigates them)

| Dropped or deferred | Reason |
|---|---|
| Stone-age → robotics era progression | 545 days cannot carry that; v1 starts **modern-era** (small towns, factories, one research lab). Era progression is a later "Accelerated Evolution" mode. |
| "Incarnate" story identity (RPG inside the sim) | A second game. Observer identity only. |
| Fantasy species, religions, languages, genetics | WorldBox has these; they don't serve the Oracle loop. Not before M6. |
| An LLM per citizen | Rule-based agents. Optional BYOK narration reads the event log and can never write state. |
| Server backend | GitHub Pages only. Everything runs client-side. |
| 30 implemented endings at launch | All 30 are *defined* (07-endings.md); 3 are *built*. |
| Multiplayer, world sharing | Export/import of a world as JSON is enough for v1. |

## 3. Layered architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UI  (React + Tailwind)                                       │
│  Home · Game HUD · Story panels · Archive · Analytics         │
└───────────────▲──────────────────────────┬───────────────────┘
                │ RenderFrame / Metrics     │ Commands
┌───────────────┴──────────────────────────▼───────────────────┐
│  SimController (main thread)                                  │
│  play/pause/speed, intervention queue, snapshots, save/load   │
└───────────────▲──────────────────────────┬───────────────────┘
                │ postMessage (structured)  │
┌───────────────┴──────────────┐  ┌────────▼────────────────────┐
│  Renderer (PixiJS)           │  │  SimWorker (Web Worker)      │
│  tiles, sprites, FX, camera  │  │  engine.step(state, inputs)  │
│  consumes frames only        │  │  story scheduler, metrics    │
└──────────────────────────────┘  └────────┬────────────────────┘
                                           │ same engine code
                                  ┌────────▼────────────────────┐
                                  │  OracleWorker                │
                                  │  headless 545-day baseline   │
                                  └─────────────────────────────┘
                 ┌──────────────────────────────────────┐
                 │  Storage (IndexedDB): worlds,        │
                 │  snapshots, event logs, archive      │
                 └──────────────────────────────────────┘
```

**The engine is a pure function.** `step(state, dayInputs, rngStreams) → { state', events, metrics }`. No DOM, no Pixi, no `Date.now()`, no `Math.random()`. This is the property that makes the Oracle, replays, forks, and tests possible. Everything else is built around it.

## 4. Folder layout

```
545Days/ (repository RuibinRay/545Days)
├── docs/                      design package (this folder)
├── DESIGN_MEMORY.md …         learning files (see §9)
├── src/
│   ├── sim/                   PURE. No imports from app/ or render/.
│   │   ├── types.ts           all state shapes (plain data, serializable)
│   │   ├── rng.ts             seeded, named streams
│   │   ├── engine.ts          step(), phase order
│   │   ├── systems/           environment, citizens, economy, civ, health, story
│   │   ├── story/             conditions, events, clues, endings/
│   │   ├── worldgen/          terrain, biomes, settlements, people
│   │   ├── metrics.ts         GDP, Gini, unemployment …
│   │   └── invariants.ts      money conservation, non-negativity (used by tests AND dev mode)
│   ├── workers/               sim.worker.ts, oracle.worker.ts, protocol.ts
│   ├── render/                Pixi scene, tilemap chunks, sprite pools, camera, FX
│   ├── app/                   React routes, HUD, panels, archive
│   ├── storage/               IndexedDB (idb), save format, migrations
│   └── ai/                    optional narrator (BYOK), reads event log only
├── tests/                     vitest: invariants, determinism, replay, endings
└── public/art/                original pixel art (16px tiles, 16×24 citizens)
```

Dependency direction is enforced: `sim/` imports nothing outside `sim/`. An ESLint `no-restricted-imports` rule guards this.

## 5. Determinism rules (non-negotiable)

1. **One seed, many streams.** The world seed derives named RNG streams (`weather`, `citizens`, `market`, `story`, `worldgen`). A player intervention that touches citizens must not reshuffle tomorrow's weather. This is the "common random numbers" technique and it is what makes "I changed one thing and the drought still came" meaningful.
2. **No `Math.sin/cos/exp/pow/log` in the engine.** Transcendental functions are not guaranteed bit-identical across JS engines. Use integer math, lookup tables, or the included polynomial approximations. `Math.floor/min/max/abs/sqrt` are fine (IEEE-exact).
3. **Money is an integer (cents).** No floating-point money. Quantities of goods are integers too.
4. **Stable iteration order.** Entities live in arrays indexed by numeric id; never iterate a `Map`/`Set` in a way that depends on insertion history that could differ between runs. Sort any derived list before acting on it.
5. **Inputs are data.** Player actions are `Intervention` records appended to a day's input queue, applied at a fixed phase. The event log plus the seed plus the intervention log fully reproduce a run.
6. **A run has a hash.** `hashState(state)` at any day; tests assert identical hashes across two runs and across Worker vs. main thread.

## 6. Time model

- 1 tick = 1 simulated day. 545 ticks per main timeline.
- Sub-day structure (morning / work / evening / night) is a *phase order inside the tick*, not separate ticks. The renderer animates those phases over the real-time length of a day (4 s at 1×).
- Speeds: paused, 1× (4 s/day), 4×, 16×, "skip to next significant event". At 16× the renderer drops to one frame per day.
- Day 0 is the start of observation, modern era. Calendar is fictional ("Day 212"), no months.

## 7. World scale for v1

| Parameter | v1 | Reason |
|---|---|---|
| Map | 128×128 tiles default (96×96 for one civ), 16 px tiles | three towns of ~45 buildings need the room; 16k tiles is still cheap to simulate and render |
| Civilizations | 1–3, one settlement each (M4) | agrarian / scholarly / martial dispositions; diplomacy, war, conquest |
| Citizens | 100 per civilization (M4; 30–100 selectable) | 300 × 545 days runs in ~0.6 s headless, inside the Oracle's 2 s budget |
| Buildings | ~45 per town | homes, farms, workshops, market, lab, town hall, clinic, power plant, barracks |
| Goods | food, materials, energy + money | Four is enough for shortages, prices, and production chains |

## 8. Cross-cutting rules carried over from the portfolio playbook (proven on a real deploy)

- Fallback ladder before the fancy effect: full Pixi → reduced-FX → static map image → text-only panels. `?why` query shows which tier is active and why.
- Reduce Motion is a mode, not a kill switch: world still updates, sprites snap instead of walk, no particles, HUD pause button always visible (WCAG 2.2.2).
- Content/data separated from code: endings, events, clues, building definitions live in `src/sim/data/*.ts` as typed tables.
- Strip metadata from every shipped image. No trackers. Only external request is optional BYOK narration, and only when the player enters a key.
- Difference from the portfolio: this project **needs a build step** (Vite, Workers, TS). Deploy via GitHub Actions to Pages; Vite's hashed filenames replace the manual `?v=` cache-buster. Router is hash-based so deep links work on Pages without a 404 rewrite.

## 9. Learning files

`DESIGN_MEMORY.md`, `DESIGN_MISTAKES.md`, `CREATIVE_EXPERIMENTS.md`, `PROJECT_REVIEWS.md`, `DESIGN_SYSTEM.md` are seeded in the repo root. Rule: a line moves from CREATIVE_EXPERIMENTS to DESIGN_MEMORY only after it has shipped and been checked on a device.

## 10. Decisions and pushback on the source spec

| Spec says | Decision | Why |
|---|---|---|
| "Simulate procedural terrain, rivers, oceans, forests, mountains, biomes, resources, weather" | Terrain + rivers + 4 biomes + 3 resource deposits + rain/temperature fields. No weather *simulation* beyond seasonal rainfall and drought events in v1. | Weather only matters through food production. Model that edge, not the atmosphere. |
| "Civilizations with rulers, institutions, technological development, diplomacy, conflicts" | v1: one government per settlement with a ruler agent that sets 4 policies (tax rate, research budget, oversight law, food reserve). Diplomacy = trade or embargo. War deferred to M6. | Machine Dominion, Red Plague and Great Drought don't need war. Building war first is the WorldBox trap. |
| "Pixel-art, animated terrain and water, buildings that visibly change" | Yes, but citizen *movement* is rendered from each citizen's recorded daily itinerary (home → workplace → market → home). The renderer invents paths, never state. | Keeps the honesty rule: nothing on screen that isn't in state, but animation stays cheap. |
| 30 endings "with explicit eligibility conditions, event chains, clues…" | 30 defined with family, one-line eligibility and the systems they need; 3 fully specified; the other 27 are a backlog, not a promise. | A solo dev with AI help can balance three. Thirty unbalanced endings is worse than three good ones. |
| Recharts | Kept for analytics pages. Not used for in-world overlays (those are Pixi tint layers). | Two chart systems in one view is a smell. |
| Tailwind | Kept for layout; design tokens live in CSS variables (`--c-abyss` etc.), not scattered utility colors. | See DESIGN_SYSTEM.md. |
| "Story Mode can automatically pause at important discoveries" | Yes; pauses are driven by `narrativeImportance ≥ 7` on emitted events. | Cheap and makes the mystery readable at 16×. |

## 11. Risks (ranked)

1. **Agent loop too slow for the Oracle** at larger populations. Mitigation: profile at M2 with 150 citizens; budget is 545 days in < 2 s on a 2020 laptop. If missed, aggregate low-importance citizens into households for the Oracle run only (same rules, coarser actors) — and say so in `?why`.
2. **Endings that are always or never reachable.** Mitigation: a batch harness runs 200 seeds headless and reports ending frequencies; target for a defined ending is 5–40% of baselines when its family is the primary threat.
3. **Clues that are either trivial or unreadable.** Mitigation: playtest the Machine Dominion slice with three people who have not read this doc before building ending #2.
4. **Pixel-art asset volume.** Mitigation: a 16-colour palette and strict sprite sizes (16×16 tiles, 16×24 citizens, 32×32 / 48×48 buildings) so one spritesheet covers the slice.
5. **Floating-point drift between Worker and main thread.** Mitigation: rules in §5 plus a cross-context determinism test from M3 onward.
