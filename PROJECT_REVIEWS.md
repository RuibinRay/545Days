# PROJECT_REVIEWS

## 545 DAYS — M0 design package (2026-10-21)

**Objective.** Produce the eight design deliverables from the master spec (architecture, data models, daily cycle, rendering, story system, Oracle, three ending specs, milestone plan) as a repo that the next session can build on, with real TypeScript for the models and a verified toolchain.

**Chosen direction.** Pure-function deterministic engine in a Worker; the Oracle is the same engine run ahead; top-down pixel art; story layer as a data-driven conditional scheduler; three endings built, thirty defined.

**What exists and was verified in this session**
- `docs/01–08` written.
- `src/sim/types.ts` (plain-data state model) and `src/sim/rng.ts` (seeded multi-stream RNG).
- `npm install` → `tsc --noEmit` clean → `vitest` 7/7 green, including the common-random-numbers test and a pinned RNG snapshot.

**What does not exist yet.** Everything else: worldgen, engine, systems, story data, renderer, UI, storage, deploy workflow, art. No performance numbers have been measured; the budgets in docs/03 are targets.

**Pushback recorded against the source spec** (see docs/01 §10): modern-era start only; no war in v1; no isometric; 3 built endings; no LLM per citizen; no backend.

**Critic scores.** Not applicable — there is no running product to score. First scoring at M1.

**User feedback.** None yet.

**Recommended next step.** M1 (living map). Spike Pixi v8 chunked tilemap + Worker build on the Pages base path in week 1, before any art.

**Open questions for the owner**
1. Repository name and location (`base` in `vite.config.ts` assumes `/545-days/`).
2. Confirm modern-era start and the three first endings.
3. Whether a GitHub Actions deploy is acceptable (the portfolio deliberately had no build step).

---

## 545 DAYS — M1 living map (2026-10-21)

**Objective (docs/08).** Worldgen, one settlement, Pixi tilemap + camera + selection, day/night, performance tiers, `?why`, hash router, Pages deploy workflow.

**Built and verified in this session**
- `src/sim/worldgen/` — terrain (noise + quantile sea level + quantile hill/mountain thresholds), 4-connected rivers that always reach the sea, resources, settlement site choice, 17-building layout with 1-tile margins, 30 citizens with homes, jobs and itineraries. Tests: determinism over 6 seeds, land-share bounds per preset, every building on land / off rivers / non-overlapping, all citizens housed, money sums. 28/28 green.
- `src/sim/engine.ts` — day/season advance + real metrics; interventions throw rather than no-op. `hashState` for determinism tests.
- `src/workers/` — protocol + sim Worker (typed-array frames, transferred).
- `src/render/` — procedural placeholder pixel art (tiles, 16-mask river autotile, 11 building kinds × tiers, citizens per occupation), chunked RenderTextures, 4-frame water, overlays (territory / moisture / elevation / resources from real layers), itinerary-driven citizen walks, day/night multiply tint, selection, camera (drag, wheel, pinch, keys), tier ladder full → lite → still, `?why` status. Still-tier 2D canvas fallback.
- `src/app/` — hash router, Create World form, HUD with speeds and Step, inspector (building / citizen / tile), DOM twin lists (role=listbox) for keyboard and screen-reader selection, reduce-motion toggle (respects `prefers-reduced-motion`, persisted), rendering-tier override, text-only mode.
- Production build passes; served with `vite preview` and exercised in headless Chromium (SwiftShader): home, world at Day 0, running at 4×, selection via the list, territory overlay, night tint, zoom-out, 390-px phone viewport. No page errors. Screenshots in the M1 package.

**Measured.** Headless Chromium on 2 cores/SwiftShader ran at ~10 fps and correctly dropped to the `lite` tier ("≤ 2 CPU cores"). That is the fallback working, not a performance number: **no real-GPU fps, Lighthouse, or Core Web Vitals have been measured.** The 60-fps acceptance criterion is unverified until the owner runs it on a laptop and a phone (`?why` shows fps).

**Critic scores (1–10, evidence = the screenshots; nothing here is a user study)**
| Dimension | Score | Why |
|---|---|---|
| Visual originality | 5 | Palette and tier system are deliberate; the sprites are procedural placeholders and read as such. |
| Brand identity | 6 | Type, palette, ember accent and the "every world has a future" line are consistent across home and HUD. |
| Typography | 5 | System fallback stack; Instrument Sans is not yet self-hosted; map label is a generic monospace. |
| Layout & composition | 6 | HUD/stage/side grid works at 1280 and 390 px; HUD wraps into three rows on phones (too tall). Home is a plain form, not the living-world hero docs/01 promised. |
| Motion design | 6 | Walks, water, day/night tint are honest (every stop is in state); walk cycle is two frames; no transition on selection. |
| User experience | 6 | Clear controls, shortcuts documented, Step button, inspector cross-links. Camera does not re-centre on resize or on tier change. |
| Accessibility | 6 | Focus rings, listbox twins, aria-live day counter, reduced motion, text tier. Unverified by a screen reader; no contrast audit yet. |
| Responsiveness | 6 | Works at phone width; map area small; pinch zoom implemented but untested on a device. |
| Functionality | 7 | Every control changes state; nothing is a placeholder. Economy/story absent by design. |
| Performance | – | Not measured on real hardware. |
| Code quality | 7 | `sim/` purity enforced by a test; typed protocol; strict TS. `Game.tsx` is 300 lines and should split. |
| Business/product effectiveness | 4 | A map you can watch is not yet a reason to return; that arrives with M2's autonomous town. |

**Five strongest decisions.** (1) Quantile sea level and hill/mountain thresholds — every seed gets a sane map. (2) 4-connected rivers with BFS distance-to-sea — rivers can no longer strand or pool. (3) Wall-clock day phase in the renderer — immune to the ticker's 100 ms delta clamp. (4) The `sim/` purity test. (5) The DOM twin lists: keyboard selection worked in the headless run before any pointer code was exercised.

**Five weakest.** (1) Placeholder art — citizens are oversized relative to houses. (2) Home page is a form, not the living world. (3) No real-device measurement. (4) Rivers are staircase-shaped at zoom 1 (4-connectivity without smoothing). (5) `islands` preset is still too fragmented and salts every islet with "mountain" because the thresholds are global quantiles.

**Bugs found and fixed during the session** (recorded in DESIGN_MISTAKES.md): river tiles rendered as dots because tracing was 8-connected while the autotile set is 4-connected; day phase drifted on slow frames because it summed clamped `deltaMS`; worldgen could leave citizens homeless when the site was cramped (house count is now derived from population).

**Recommended next steps.** (1) Owner runs `npm run dev`, opens `?why` on a laptop and a phone, and records fps + tier here. (2) Split `Game.tsx` (HUD, Inspector, Settings). (3) Self-host Instrument Sans. (4) Then M2.

---

## 545 DAYS — M2 autonomous town (2026-10-21)

**Objective (docs/08).** 30 citizens with needs and a decision function; farms/workshop/market/clinic/lab/plant with wages, market clearing, taxes, business open/close; memories → beliefs; live inspector; analytics.

**Built and verified**
- Engine phases 1–5 + 7 (`src/sim/systems/environment.ts, citizens.ts, economy.ts, civ.ts`), a `Ledger` through which every cent moves, `invariants.ts`, and the sandbox `drought` intervention (the only one implemented; all others throw).
- `tools/harness.ts` — the tuning loop. Final numbers over **200 seeds × 545 days with invariants on**: 0 invariant failures; **0/200 seeds with a death**; unemployment avg 8.5 %; food price ends within ±5 % of base; ~7 upgrades and ~3 new businesses per run; **61 ms per run** (budget 500 ms).
- Tests: 45/45 (`economy.test.ts` adds the 200-seed harness, drought causality against a no-drought control, replay determinism with interventions, common-random-numbers, and refusal of unimplemented interventions).
- UI: tabbed side panel (Inspect / Chronicle / Analytics / Powers / Settings); live citizen inspector with needs meters, beliefs, memories and relationships (fetched on demand from the Worker); building/business inspector; chronicle of engine events in plain sentences; six Recharts series plus a market/council table; the Drought power with intensity slider. Exercised in headless Chromium: run to day ~109 at 16×, drought triggered from the UI, charts show the $3 → $15 → $3 food-price arc, no console errors.

**Tuning record (what it took to get from "everyone dies by day 60" to 0 deaths; each is in DESIGN_MISTAKES.md).** 1) Work had to dominate rest/socialize (T 20 → 14, higher income term, work gives belonging). 2) A food glut crashed prices and bankrupted farms → producers withhold stock below 90 % of base (supply response) + spoilage. 3) Layoffs fired on tiny losses → thresholds and a 30-day cooldown. 4) The public sector (lab, clinic, official, pension, welfare) could not be financed by a 30-person tax base → smaller public payroll, sales tax, clinic fees, and a fiscal rule that cuts budgets. 5) Upgrade permits counted as operating losses → upgrade-then-layoff churn; now capex with a 60-day cooldown. 6) Profit stayed trapped in firms as dead cash → dividends to owners. 7) Employed people at insolvent firms starved while "employed" → means-tested welfare and the right to look for a job when payroll slips. 8) Droughts were either harmless (farms sit by the river) or total (all farmland → 0) → river-fed land dries slowly, other land fast, and recovery was made faster. 9) `profit30` was an EMA of daily profit while the thresholds assumed a 30-day sum.

**Critic scores (1–10)**
| Dimension | Score | Why |
|---|---|---|
| Functionality | 7 | Every control changes state; drought is a real intervention; everything shown is read from state. No births, no migration, no second settlement yet. |
| Simulation credibility | 6 | Money is conserved and audited; prices clear; firms open, grow, close. But the baseline is placid (wellbeing ≈ 99, unrest 0) and inequality is extreme (Gini ≈ 0.74) because all profit flows to a handful of owners — that is emergent, but it is also untested against anything real. |
| User experience | 6 | The inspector is readable; the chronicle makes causes visible; the first 50 days are quiet. HUD now wraps to two rows at 1280 px. |
| Motion design | 6 | Unchanged from M1; citizens' routes now follow what they actually did today (work / town hall / friend's house / market). |
| Accessibility | 6 | Tabs use `role=tab`; meters use `role=meter`; the chronicle is `aria-live`. Still unverified with a screen reader. |
| Code quality | 7 | Engine stays pure (purity test now covers 22 files); systems are separate modules; `Game.tsx` was split into panels but is still ~330 lines; `economy.ts` is 480 lines and should be split into produce / market / lifecycle. |
| Performance | – | Headless only. |

**Five strongest decisions.** The ledger (every bug surfaced as a conservation failure, never a silent drift); the headless harness as the main dev loop; means-tested welfare; the supply response; profit30 as a sum.
**Five weakest.** Many constants were set by hand to make 30 people balance — none are derived from anything; the clinic/lab economics are thin; children have no household model (they borrow an adult's wallet); the sandbox drought is the only intervention; `economy.ts` is too long.

**Open risks.** Scaling to 150 citizens (M6) will shift every balance; the fiscal rule will need to become the ruler agent before a second civ exists; chronicle noise at 16×.

**Next.** M3 — the 545-day engine: Worker protocol for snapshots every 30 days, IndexedDB saves, replay/fork, timeline UI, the "why" cause inspector over `WorldEvent.causes`, and the EndingResolver with the fallback epilogue.

## 545 DAYS — M3 the 545-day engine (2026-10-21)

**Objective (docs/08).** Worker protocol with speeds, snapshots every 30 days, IndexedDB saves, replay/fork/restart, event log + timeline, a "why did this happen" cause inspector, and an EndingResolver that always produces an epilogue at Day 545.

**Built and verified**
- `src/sim/snapshot.ts` — `takeSnapshot` (structuredClone), `snapshotBefore`, `replay(snapshot, interventions, toDay)`, `toPortable/fromPortable` (typed arrays ↔ JSON). `src/sim/story/endings.ts` — `ENDINGS` registry (empty until M5), `resolveEnding` with four fallback variants ("The Unfinished Age" — plenty / hard / fragile / quiet) and "The Empty Valley" on extinction; the epilogue is written from the world's own numbers and names.
- Engine phase 8: `story.countdown_end` at `DAYS = 545`, `story.extinction` when no one is alive; `run()` stops at terminal and returns the ending.
- Worker: snapshot before every intervention and every 30 days; autosave every 30 days and at the ending; `fork(day)` replays from the snapshot at or before `day` into a new world id with `forkedFrom`; `peek(day)` replays to a past day without touching the live run; `restart`; `export` writes a tiny file (seed + settings + interventions + latest hash); `import` replays it and verifies the hash before saving.
- `src/storage/db.ts` — IndexedDB (`worlds`, `summaries`); Home lists saves with rename/delete/import.
- UI: Timeline with scrub (range input, intervention diamonds, "Return to today"; the map and panels show the peeked day with a "VIEWING n" badge); Chronicle "why?" expands a cause tree built from `WorldEvent.causes`; World tab (name, save now, export, restart); EndingScreen overlay with stats, epilogue, and Continue / Restart / Branch from snapshot / New world / Export.
- Tests: **69/69** (`events.test.ts` checks every engine event type renders as a sentence; `engine.test.ts` adds: replay from every 30-day snapshot matches the original hashes; snapshots are independent of later mutation; portable JSON round-trip is hash-identical; 50 seeds reach Day 545 with an epilogue that names the settlement and fewer than 20 % "hard" variants; extinction resolves to "The Empty Valley"; the resolver is pure).
- Headless Chromium against `vite preview`: the Worker's state hash at day 0 (`05379266`) and day 60 (`e48ee84b`) equal the hashes computed in Node for the same seed — **Worker-vs-main-thread determinism verified**. Scrubbing to day 20 shows "VIEWING 20 / 545"; 10 chronicle events expose "why?"; 545 single steps reach "The Unfinished Age — A Quiet Age"; branching from day 300 opens a new world at day 300 named "… · fork from day 300"; Home lists both saves; no console errors.
- Measured snapshot cost (Node 22, 30 citizens, 96×96): 1.1 ms per structuredClone, 263 KB portable JSON, 12 ms serialise, 1.7 ms parse. The M3 risk in docs/08 ("> 20 ms → move to the Worker") did not materialise; snapshots were in the Worker from the start.

**Critic scores (1–10)**
| Dimension | Score | Why |
|---|---|---|
| Functionality | 8 | Every control changes state or storage; fork/peek/export/import all verified end-to-end; the ending always exists. Missing: speeds beyond 16×, a save slot UI beyond the list, and no undo of an intervention (by design — you fork instead). |
| Determinism & correctness | 9 | Replay, portable round-trip, Worker-vs-Node, and 50-seed endings are all tested, not asserted. The one untested path is IndexedDB itself (exercised headless, not in vitest). |
| User experience | 6 | The timeline + "why?" + ending screen make the loop legible. Weak points: the ending overlay arrives abruptly (no reveal), the "VIEWING n" state could be missed, the HUD still wraps at 1280 px, and the Home page is a form, not a world. |
| Writing | 5 | The fallback epilogue is competent template prose with real numbers in it; it reads as generated. The designed endings (M5+) must do better than a variant switch. |
| Motion design | 5 | Unchanged from M2; no transition into the ending, no timeline scrub animation. |
| Accessibility | 6 | Timeline is a native range input with a label; ending overlay is `role=dialog`; cause tree is a nested list. Still no screen-reader session, no device check. |
| Code quality | 7 | Pure engine held (purity test covers 24 files); `sim.worker.ts` grew to ~300 lines and `Game.tsx` is back to ~380 after the timeline/peek additions — both want a split before M4 adds the Oracle. |
| Performance | – | Headless only; no field numbers. Replay of 245 days from a snapshot took ~0.3 s cold in Node, well under the 2 s Oracle budget. |

**Five strongest decisions.** Snapshots in the Worker with only day numbers sent to the UI (nothing to synchronise); `peek` as a replay rather than a stored frame history (zero memory, always consistent); the export file as "seed + interventions + hash" (a world is a few hundred bytes and self-verifying); the ending resolver as a pure function of (state, events, metrics) so it can be tested on 50 seeds in 9 s; a chronicle built from `causes` ids rather than prose, so "why?" is a graph walk.
**Five weakest.** The fallback epilogue prose; the ending arrives without ceremony; `snapshotDays` had to be added to every frame after the fork select came up empty (the protocol was designed around a single `world` message and then patched); Home still names saves "Osshaven · day 545" with no thumbnail; forked worlds inherit the parent's name with a suffix rather than getting their own.

**Fixed during verification.** Fork select empty (snapshot days only arrived with the initial `world` message); ticker printed raw `story.countdown_end` JSON; "a engineer" in the epilogue; side panel scrolled horizontally because unbreakable cause text sat in a `1fr` grid column.

**Open risks.** The Oracle (M4) replays 545 days per prediction — ~0.1–0.3 s at 30 citizens, but it will run on every intervention; budget it before adding citizens. Portable JSON at 263 KB per snapshot × 19 snapshots per world is ~5 MB per save at this size; fine for IndexedDB, not for export (export already avoids it).

**Next.** M4 — the Future Oracle: OracleWorker baseline run at Day 0, fragment selection from the baseline's ending and notable events, a vision sequence, the Future panel, and divergence indicators (baseline-vs-actual on the charts; "this changed because of you" on events whose causes include an intervention).

## 545 DAYS — M4 civilizations, war, research and the Oracle's missions (2026-10-22)

**Objective (re-scoped by the owner).** Several civilizations of 100 that farm, research and fight; visibly different building models per tier; randomized missions the player can take or leave, with consequences either way; evolving factions, procedural events, branching storylines.

**Built and verified**
- Worldgen for 1–3 civilizations (one of each disposition in a three-civ world), sites spread across a 128×128 map, a ruler per civ, buildings scaled to population, 300 citizens all housed and ≥ 75 % of adults employed at Day 0 (12 seeds asserted).
- New systems: `research.ts` (points → tech levels → output, medicine, strength, automation and machine risk), `ruler.ts` (succession, coup, conscription, budgets, taxes, research focus), `war.ts` (attitudes, declarations, raids with casualties/loot/ruins, peace, conquest), `missions.ts` (ten templates, offer/expiry/answer, procedural events). Interventions implemented: `remove_citizen`, `destroy_building`, `build`, `set_policy`, `set_attitude`, `nudge_belief`, `mission`.
- Worker: civ and settlement snapshots per frame, the mission list, an automatic pause on an offer and a two-branch 90-day forecast (`forecast`) replayed from a snapshot of the live state — the first working form of the Oracle. Saves bumped to version 2; older saves are refused with a message.
- UI: Civs panel (ruler, army, budgets, tech meters, risk, attitudes, wars, centre-on-town), Oracle panel (brief, action, forecast side by side with ▲▼ deltas and each branch's notable events, Act / Decline, history), a HUD mission button that pulses on offer, direct Remove / Destroy powers in the Inspector with confirmation, civ-coloured markets table, Home selectors for civilizations and population.
- Art: three models per building kind per tier (hut → cottage → stone townhouse; furrows → barn → orchard and silo; palisade → walled barracks → fortress; hall → columned hall → palace …), taller tiers rising above the footprint with bottom-anchored sprites, civ colour on doors, awnings, flags and banners, soldier and ruler sprites, settlement labels in civ colour that update on conquest, raid/conquest flashes.
- Tests: **110/110** (`civs.test.ts` adds 13: worldgen shape, 40-seed baseline invariants/starvation/performance/evolution/endings table, interventions, mission accept-vs-decline replay, mid-run replay with interventions). `tools/missions-harness.ts` runs ignore / accept-all / peaceful players.
- Headless Chromium: a 3×100 world ran from Day 0 to Day 545 at 16× answering 11 missions (alternating Act/Decline), forecasts in ~1 s, chronicle sentences for every new event type (tested), ending screen with "Missions taken 6 of 11", no console errors.

**Measured**
- Baseline (40 seeds × 545 days, strict): 0 starvation; 12 battle + 9 old-age deaths per run; 1.9 wars, 12 raids, conquest 8 %; endings fragile 60 % / Machine Dominion 22 % / Scorched Border 8 % / plenty & hard the rest; 0.6 s per run in Node (budget 2 s).
- Mission harness (24 seeds): ignore → MD 29 %, risk 57, 11.8 battle deaths; accept everything → MD 0 %, risk 1, 2.8 battle deaths, 4.3 people removed; peaceful only → MD 0 %, 11 battle deaths, 2.1 wars. Missions change outcomes, and the two forecast branches diverge (asserted by hash).
- Forecast cost in the browser: ~0.9–1.1 s for both 90-day branches at 300 citizens on a 2-core headless machine.

**Tuning record (each is in DESIGN_MISTAKES.md).** Nine passes: 155 starved per seed at first (supply response geometric collapse; public sector unaffordable; three owners holding two-thirds of the money via the power plant's dividends; farms over-provisioned then under-provisioned; conscription eating the farmers; the granary dumping loot onto the farmers; wars every 150 days like clockwork; conquest in 46 % then 7 %).

**Critic scores (1–10)**
| Dimension | Score | Why |
|---|---|---|
| Functionality | 8 | Everything advertised works end to end and is tested; missions, war, research, succession all drive real state. No Oracle vision cutscene yet; no second settlement per civ; no migration. |
| Simulation credibility | 6 | Wars are legible (declaration → raids → peace/conquest) and factions do change character (coups, research focus, arms races). But many constants are hand-set, soldiers walk across water, raids are abstract, and the baseline is still placid between wars (unrest ≈ 0). |
| Game design | 6 | Missions are the first real decisions and the forecast makes them informed. Weakness: all missions are free, so "accept everything" is dominant (measured); assassination has too little blowback; mission variety is ten templates. |
| Visual design | 6 | Tiered models and civ colours make towns readable and distinct at a glance; the labels and HUD glyphs help. Still placeholder pixel art; the farm tiers are the weakest; no transition on conquest beyond a flash. |
| Writing | 5 | Briefs and the new endings read fine but are templated; the forecast is numbers plus event sentences rather than a vision. |
| Accessibility | 6 | Meters have roles and values; buttons have labels; confirmations on destructive actions. Not tested with a screen reader; the mission pulse respects reduced motion. |
| Code quality | 6 | Engine stays pure (purity test covers 28 files). But `economy.ts` is ~700 lines, `Game.tsx` ~470, `sim.worker.ts` ~460; the ruler/war/missions split is clean, the economy is not. |
| Performance | – | Headless only: 0.6 s/run in Node, 1.5–7 ms per step in the Worker, lite tier on 2 cores. |

**Five strongest decisions.** Forecasts as replays from a snapshot (zero new state, always consistent, reuses the Oracle budget); missions as ordinary interventions (replay/fork/export carry them for free); the barracks sized by budget with a conscription floor for farmers; the granary rules (buy low, sell dear, never dump); the mission harness with three scripted players as the acceptance test.
**Five weakest.** Free missions; soldiers' itineraries cross water and mountains; conquest in only 8 % of baselines (the Scorched Border is mostly player-made); wars still come in a 150-day rhythm; the fallback epilogue barely mentions the civs.

**Open risks.** Balance is a knife-edge: every system added this milestone re-broke food first. The M5 IP/KP economy must price missions or the game is "say yes". The Oracle vision (M4b) needs a baseline run at Day 0 — the forecast code is that, minus the UI.

**Next.** M4b — the Oracle proper (baseline at Day 0, vision fragments, divergence on the charts), then M5 — story chains with clues, mission costs and blowback.

## 545 DAYS — M4b the Oracle proper (2026-10-22)

**Built.** `story/oracle.ts` (baseline, visions, divergence — all pure), Worker baseline after the map shows (stored with saves, kept by forks/restarts), the Day-0 vision overlay (reveal one fragment at a time, keyboard and reduced-motion aware), the Oracle tab's "What the Oracle saw" block with a 0–100 departure meter and the foreseen-but-missing / unforeseen event lists, dashed baseline series on every chart, and "The Oracle foresaw / what came" on the ending screen.

**Measured.** 116/116 tests. Baseline hash-matches a no-intervention run at every 30-day mark; a day-91 intervention matches before and differs after; divergence 0 → 8 after removing a chancellor (the unforeseen turning point it listed was the coup that followed). Baseline cost: 0.6 s Node, **3.5 s** headless 2-core Chromium — over the 2 s budget on weak hardware; mitigated by running after the first frame, not fixed.

**Critic.** Functionality 8 (everything advertised works and is tested). Writing 5 — the cryptic lines are a fixed table per event type; the same world type reads the same every time. Game design 6 — the vision gives the player a reason to look at the Civs tab, and the departure meter makes intervention legible; but nothing yet rewards matching or breaking the vision. Visual 5 — a text overlay, not a scene. Strongest decision: the baseline lives beside the state, never in it, so determinism checks stay simple. Weakest: baseline cost on weak machines; fragments without art.

**Next.** M5 — story chains with clues, mission costs (Influence/Knowledge) and blowback; Knowledge-gated reveal of the clear visions.

## 545 DAYS — M5 story chains, clues, Influence (2026-10-22)

**Built.** A data-driven story scheduler per civilization with a condition DSL and effect vocabulary; the Machine Dominion chain (proposal → grant → machines on the floor → engineer's report → oversight bill → containment → Accord) and a blowback chain (martyr / reprisal / ashes) that answers the player's removals; the Influence/Knowledge economy with costs on every mission and direct power, regen 1 per 2 days to a cap of 30; investigation of people (rumors from their memories and beliefs) and buildings (evidence read from state) for Knowledge; Knowledge-gated plain readings of the visions; ending 02 Human–Machine Accord; the Oracle tab's resources line, cost display, "read plainly" buttons and the clue list; Investigate / Remove / Destroy with costs and cooldowns in the Inspector.

**Measured.** 139/139 tests (`story.test.ts` adds 9, `events.test.ts` now covers every story chain id: chain data sanity, condition semantics, md order and cancellation, Influence charging/refusal/regen, mission cost = sum of effects and no credit, evidence vs rumor and cooldown, vision reveal, blowback ≥ 75 %, determinism with story state). Mission harness: accept-all now 6.8 battle deaths and 1.7 wars (reprisals undo the "assassination = peace" exploit), MD 0 %; ignore 35 % MD. Headless: investigate a lab → evidence (◇ +2), three people → rumors, "read plainly" on a vision, chronicle sentences for every story event, no console errors.

**Critic.** Functionality 8. Game design 7 — choices now have a price and the world answers back; but Influence still affords one mission per cycle, so the scarcity bites only when direct powers compete. Writing 6 — clue text is templated but reads as the world's voice (the deposed king's successor "blames the neighbours, and the crowd that was muttering is cheering"). Code quality 6 — `engine.ts` took on investigate() and should hand it to story/; `Game.tsx` keeps growing. Strongest: chains as data per civ with engine milestones joining `fired`. Weakest: no evidence board, no secret projects, and the false rumor is a single decoy.

**Next.** M6 — Red Plague and Great Drought (infection model, clinics, climate chain, warehouse) with their mission templates and endings 07/13; then the art pass.

## 545 DAYS — M6 Red Plague and Great Drought (2026-10-22)

**Built.** `health.ts` (incubating/sick/recovered/dead, contact-capped transmission through itineraries, clinic coverage, merchants carrying the fever between towns, quarantine), `migration.ts` (the hungry walk to cheaper food), the rp and gd story chains with nine new condition kinds and seven new effects, the `quarantine` policy and `set_focus` intervention, warehouse (double granary) and irrigation (75 % crop floor), the `disasters` setting, rulers that fund clinics and close gates, five new mission templates with urgency (plague and drought offers come first), four endings (07 Red Plague, 08 The Last Cure, 13 Great Drought, 14 The Green Compact), sick citizens tinted green, the land re-baked straw-coloured during a drought, sentences for every new event, health and migration rows in the Civs panel, an Infected chart.

**Measured.** 164/164 tests (`disasters.test.ts` adds 8: epidemic shape 2–25 % dead and burn-out, the sick stay home, quarantine keeps other towns clean, a funded clinic saves lives, irrigation floor, drought chain + migration + disasters-off, migrant accounting, 40-seed ending table). Baseline table (40 seeds): hard 27 / fragile 27 / Red Plague 17 / Great Drought 10 / Scorched 8 / MD 8 / Green Compact 3 %. Scripted peaceful player: Last Cure 6/16, Green Compact 7/16, Red Plague 2/16 (was 4/16 before plague offers were made urgent). Headless Chromium: plague seed shows "25 sick · gates closed" in the Civs panel, the drought HUD line, dry terrain, rumors from the chain in the clue list, no console errors. Runtime 0.75 s per 545-day run.

**Tuning record.** Four passes: the market was a superspreader (p scaled with everyone present — cap contacts per place at three); the sick still went shopping (bed-bound itineraries, pre-symptomatic spread instead); the first plague swept 90 % of a town in 70 days and killed 4 % (slower, deadlier, triage-based coverage); droughts did not bite at all (drying 2/6 → 3/8 per day, 50 + 100-day droughts, −20 rainfall); rulers lifted the player's quarantine (ruler-imposed vs decreed).

**Critic.** Functionality 8. Simulation credibility 7 — epidemics have a believable shape (merchant → cluster → clinic full → cross the river → burn out) and droughts now hurt the way the design wanted; but households don't move together, farms stay green on the map in a drought, and the cure is almost always the player's doing (rulers reach the budget threshold only with help). Game design 7 — plague and drought offers are urgent and the forecast shows the difference; four more endings are in reach. Writing 6. Code quality 6 — the scheduler's condition switch is getting long; `chains.ts` is 300 lines of data and should split by chain.

**Next.** M7 — society and analytics: births, households that move together, the second settlement per civ, migration as policy, trade routes with real goods, overlays, achievements, and the "S" endings that need them (Chosen City, Great Exodus, Long Peace with trade, Iron Council). Then M8 — the art pass and field performance.

## 545 DAYS — M7 society, trade, colonies and gates (2026-10-22)

**Objective.** The "society and analytics" milestone: people who have families, towns that grow and found others, goods that move, gates that open and shut — and the endings and missions those make possible — without breaking determinism, the books or the budget.

**Built.** `systems/society.ts` (partners, births, coming of age, `household`, `relocateHousehold`, colonies: `crowded`, `colonySite`, `foundColony`, `expansionPhase`), `systems/trade.ts` (`canTrade`, caravans with real cargo, tariffs, the fever riding along), migration by household honouring `borders`, three toggle policies the ruler manages and the player can lock for a season (`quarantine`, `borders`, `exportBan` with `policyLock`), `closedDays`, local hiring (jobs are where you live), dry-commons foraging, the `co` and `ex` chains with three new conditions and one new effect, five mission templates (`open_borders`, `close_gates`, `lift_export_ban`, `found_colony`, `open_trade`), five endings (The Chosen City, The Great Exodus, The Founders, The Iron Council, The Merchant Road), a widened Great Drought, `found_colony` and the decrees as powers, frames that carry `delta` (new people and towns, the owner map), `caravans`, `routes` and `applied` interventions, live overlays (food / wealth / sickness / trade roads and gates) with a legend, a caravan sprite on the road, achievements (18, in a new IndexedDB store, checked every ten days and at the end, listed on the home page, announced in the ticker), family facts in the Inspector, births/trade rows in the Civs panel, colony and gate rows, two new chart series, sentences for 21 new event types, two more scripted players in the missions harness (*builder*, *closer*), save version 3.

**Measured.**
- 194/194 tests (`society.test.ts` adds 10: partner mirroring and newborn shape, no births in a famine, a household moves together through `relocate_citizen`, `found_colony` builds and charges and keeps the books, refusal without money, cargo conservation sent = arrived + in flight, the export ban's exact scope, the decree lock, every M7 ending's resolver on a real state, and a 20-seed liveness check: births in 20/20 worlds, colonies in 8/20, caravans in 20/20).
- Baseline table, 40 seeds × 545 days: fallback.fragile 12 / fallback.hard 8 / Machine Dominion 8 / Red Plague 6 / Iron Council 2 / Scorched Border 2 / Green Compact 1 / Great Drought 1. Starvation in 3/40 worlds (8 %); 19 births, 0.7 colonies, 120 caravans on 2.5 routes, 3.5 export bans per world; 451 ms per run.
- Scripted players (16 seeds): ignore → MD 6, hard 4, Red Plague 3, Iron Council 2; accept-all → Green Compact 6, Last Cure 5, Merchant Road 2; peaceful → Green Compact 7, Last Cure 3; builder → Green Compact 9, Last Cure 4; closer → **Iron Council 13**, MD 3. Battle deaths: 11.2 (ignore) vs 4.8 (builder).
- Trade and famine, isolated: the same 40 seeds with trade disabled starve in 20 % of worlds and reach Great Drought 7/40; with trade, 5–8 % and 1–3/40. Export bans at 125 % of base did not change this (the bans mostly bite after the caravans have already evened prices). Reported in docs/07; the Great Drought rule was widened to ≥ 4 % dead of hunger after a second drought.
- Plague after local hiring: Red Plague 0/40 → 7/40 with merchants carrying at 5 %, caravans at 10 %, base death 22 % and an 8 % threshold.
- Headless Chromium (SwiftShader, 2 cores): home page lists 18 achievements; a world reaches day 120 in 37 s at 16×; the Civs panel shows "1 born · borders shut" and "0 units in · 29 out"; a decree flips "Shut the borders" to "Open the borders" the next day; "Found a colony" founds Veyley (12 people) and the Civs panel lists it as a colony; the timeline counts 3 interventions without a reload; the chronicle has births; the Analytics tab has the caravan series; overlays verified by pixel diff against no-overlay (political 17 k px, food 127 k, elevation 586 k) and by eye for roads and carts on seed 7919 at day 203; no console errors.
- Not measured: real devices, screen readers, the cost of the live overlays on a phone (a 128×128 nearest-town pass every five days — cheap on paper).

**Tuning record.** Six passes. Local hiring removed the fever's road (deliberate; retuned transmission and the threshold instead of restoring commuting). Trade at attitude ≥ 10 erased the drought (routes 2.7/world, Great Drought 1/40); at ≥ 30 it erased trade (0.9 routes, starvation 18 %); settled at ≥ 15. Export bans as the protectionist reflex (140 → 125 % trigger) — measured no effect on famine, kept for the story and the missions. Foraging dries in a drought (+2 starving worlds). Birth rate 1/250 per couple-day gives ~19 births per 300 people in 545 days, within the "no population explosion" bound (ending population 285 ± 15 vs 300 start). Colony trigger (3 homeless or +5 people with ≤ 2 beds free) gives colonies in 18/40 baselines at ~12 settlers that do not grow — the "A town of its own" event (20 people) needs the player's colony or a second wave.

**Critic (1–10).** Visual originality 5 (gold roads and carts are new; the overlays are competent heat-maps, not a signature) · Brand identity 6 · Typography 6 · Layout 6 (the Powers tab is now a long column of decrees and should be grouped per civ with the Civs panel) · Motion 5 (carts slide on straight lines; the colony founds with a flash) · UX 7 (decrees read back their lock date; the legend says what the colours mean; the achievement ticker never hints) · Accessibility 6 (live overlays are colour-only — no pattern or text alternative beyond the Civs rows) · Responsiveness 5 (unchanged, not re-measured) · Functionality 8 (everything advertised works and is tested; the seed-15 world — raided, starving, emptying, neighbours banning grain — is the emergent story the milestone was for) · Performance 7 (451 ms per run, +3 % over M6; the frame grew by caravans and routes) · Code quality 6 (`Game.tsx` 600 lines, `economy.ts` 720, `chains.ts` 400 — the split is overdue; `missions.ts` repeats civ-scanning helpers) · Business effectiveness 7.

**Five strongest decisions.** (1) Deltas in the frame instead of re-announcing the world: births and colonies cost one small message. (2) The decree lock: a mission's effect survives the ruler's next tick, which is what makes `open_borders` and `lift_export_ban` real choices. (3) `household()` as the unit of movement — one function, used by migration, relocation and settlement. (4) The export ban as a ruler reflex rather than a chain effect: it fires in every famine, with or without the drought story. (5) Scripted *builder* and *closer* players as the acceptance test for the new endings.

**Five weakest.** (1) Colonies stay at 12 people — settlers do not pair up in time and nobody follows them; "A town of its own" almost never fires in a baseline. (2) The Great Drought fell out of the 5–40 % band; the fix (a wider rule) is honest but it is a patch on a world that now feeds itself by trade. (3) Live overlays are colour-only. (4) Carts cross water. (5) The Chosen City and The Great Exodus lose to Red Plague/Scorched Border on score whenever both are eligible, so the player rarely sees them as the headline.

**Recommended next.** M8 — the art pass and field performance (real-device fps, Lighthouse, Core Web Vitals, a self-hosted font) plus the overdue splits (`economy.ts`, `Game.tsx`, `chains.ts`, `sim.worker.ts`); then roads as a cached land path between towns for carts and soldiers.

## 545 DAYS — M8 roads, art pass, performance, sound, guide (2026-10-23)

**Objective.** The polish milestone the plan called "art pass and field performance": make the map read as a place, make the first paint fast, pay down the four files that had grown past reason, and measure what can be measured here.

**Built.** `worldgen/roads.ts` (Dijkstra over terrain costs; roads laid at worldgen and on colony founding; `tripLength` for caravans; a 16-mask road autotile; carts and marching soldiers placed along the road by arc length; roads in the still renderer too); the art pass in `art.ts` (four variants per land tile with decorations, shore foam with four shimmer frames, mountain peaks, forest saplings and old trees, three clothing cuts, beards and scarves, hats and tools per trade — 24 cached looks per occupation); the splits (`systems/economy/{index,market,lifecycle,books}.ts`, `story/chains/{md,bb,rp,gd,co,ex}.ts`, `workers/frame.ts`, `panels/Powers.tsx`, `panels/WorldTab.tsx`); progressive terrain baking with a per-tick budget and a `?why` row; vendor chunks and a lazy Analytics tab; the self-hosted Instrument Sans (SIL OFL); CLS fixes (fixed-height side panel on narrow screens, an always-present ticker line); heading order (hidden h1/h2, section labels as h3) and an aria-label that contains its visible text; `sound.ts` (five synthesized cues, off by default, created on the first gesture); `panels/Guide.tsx` (five state-keyed tips, dismissed for good in one click); a deeper second drought and ending precedence (the drought outranks the exodus it caused); `fromCiv`/`toCiv` on migration events.

**Measured.**
- 208/208 tests (`roads.test.ts` adds 4: land-only, 4-connected, deterministic roads between every pair; a forest detour is preferred; null across the sea and exact mask bits; a colony's road and caravan journey length). Every pre-existing suite green after the three splits — the splits moved code, not behaviour (the baseline table is identical before and after them; the drought floor was the only tuning).
- Lighthouse 12 (mobile preset, 4× CPU throttle, SwiftShader GL): **home 94 / 100 / 100** (performance / accessibility / best practices; FCP 2.5 s, LCP 2.5 s, TBT 0, CLS 0); **world page 61 / 100 / 100** (FCP 2.6 s, LCP 2.9 s, CLS 0.001, TBT 6.0 s). The world page's TBT is software-GL chunk baking under throttle — "Other" 9 s attributed to the pixi chunk; the same bake takes 2.4 s unthrottled in the same browser and is spread over ticks, so the HUD answers during it. Before the fixes: world 46, CLS 0.155, a11y 99.
- Timeline in headless 2-core Chromium (lite tier): first map frame **0.66 s** (1× CPU) / **1.45 s** (4×); terrain bake done 2.7 s / 5.0 s; Oracle vision at 3.3 s / 5.9 s; worker step 1.4 ms per day; fps 16 / 11 — a SwiftShader number, not a GPU one.
- Bundle: index 49 kB gzip, react 54 kB, pixi 160 kB (preloaded), charts 98 kB (lazy, only on the Analytics tab), worker 185 kB raw, fonts 4 × 7–17 kB woff2.
- Baseline table (40 seeds): fragile 14 / hard 9 / Machine Dominion 5 / Red Plague 5 / Great Drought 2 / Iron Council 1 / Founders 1 / Great Exodus 1 / Scorched 1. Starvation in 7/40 worlds (18 %; 2.7 dead per world on average). Scripted players: closer → Iron Council 13/16; accept-all → Last Cure 7, Green Compact 3; builder → Green Compact 6, Last Cure 4.
- Headless UI check: guide tip at day 0, the Oracle tip when the first offer lands, "No more tips" removes it for good; the sound preference persists; `?why` shows the bake; heading order H1 → H2 → H3; no console errors.
- **Not measured, and said so:** field Core Web Vitals (no real device or RUM here), real-GPU fps, screen readers. The plan's "BYOK narrator" and "docs site" were not built — the narrator needs a key and a server-side proxy to be safe, and nothing in this build should depend on either.

**Tuning record.** The deep-drought floor: 0.25 (M7, Great Drought 0/40 after roads changed the caravan timings) → 0.10 (25 % of worlds starving, 72–79 dead in two) → 0.15 (18 %, Great Drought 2/40, Exodus 1/40). Ending precedence added because the famine's emigrants won the headline from the famine.

**Critic (1–10).** Visual originality 7 (roads, variants, foam and hats make a scene that reads as a place; still procedural, still 16 px) · Brand identity 7 · Typography 7 (the typeface is finally loaded) · Layout 7 (the Powers tab is its own file and no longer a column of everything; the mobile panel no longer moves the map) · Motion 6 (carts on roads and marches that bend around a lake are real motion; nothing eases) · UX 7 (the guide answers "what do I do" in five lines; sound is opt-in) · Accessibility 8 (Lighthouse 100 on both pages; not screen-reader tested) · Responsiveness 6 (CLS fixed; the 45 vh panel is a guess at phone comfort, unverified on a phone) · Functionality 8 · Performance 7 lab / unknown field · Code quality 7 (`economy/`, `chains/`, `frame.ts` and the two panels; `scene.ts` is now the biggest file at ~900 lines and `Game.tsx` 490) · Business effectiveness 7.

**Five strongest decisions.** (1) Roads as state, not decoration — one path serves the economy's travel time, the carts, the soldiers and the terrain. (2) Baking the nearest chunks first and the rest on a budget: first frame in two thirds of a second. (3) Byte-buffer textures and a pixel-diff harness instead of trusting the eye. (4) The drought outranking the exodus it caused — endings name causes. (5) Measuring with the throttle on and reporting the lab/field distinction instead of a single number.

**Five weakest.** (1) Field performance is still unmeasured; the plan's acceptance for M8 said "in the field" and this build cannot satisfy it. (2) Everything is still procedural pixel art; the "hand-drawn sheets" of the design were never drawn. (3) `scene.ts` has absorbed roads, overlays, caravans and baking and wants its own split. (4) The sound set is five tones; there is no ambience and no volume slider. (5) The guide is five static lines — it does not notice a player who already knows them.

**Recommended next.** M9 — field measurement and release: a GitHub Pages deploy with a RUM beacon (web-vitals → a free endpoint or console export), a phone session, a screen-reader pass; then `scene.ts` split (terrain, citizens, overlays, caravans); then the content the endings deserve — ending-specific epilogue art and a chronicle export.

## 545 DAYS — M9 release readiness (2026-10-23)

**Objective.** Make the build something that can be deployed and judged: measure what the design asked to be measured in the field, audit accessibility with a tool rather than a glance, make the phone layout real, finish the renderer split, and put the record in the player's hands.

**Built.** `app/vitals.ts` (`web-vitals` with `reportAllChanges`, shown in the World tab and `?why`, a copyable plain-text report with device facts); `app/chronicleExport.ts` ("Download the record": settings, the player's hand, every day's notable sentences, the epilogue); `makeBridge` and bridges in both renderers; `render/terrain.ts`, `render/overlays.ts`, `render/caravans.ts` behind the `WorldRenderer` façade (985 → 630 + 191 + 190 + 106 lines); axe-core fixes (the Inspect lists were `listbox/option` with buttons inside — now plain lists of `aria-pressed` buttons; the stage is `<main>`; the Oracle button's dim text meets contrast); the HUD as a fixed CSS grid at three widths; `font-display: optional` + preloads from `public/fonts`; the ticker as one fixed row that hosts the Oracle button; a reserved tab mark and a reserved mission slot; the Oracle no longer switches the panel's tab; a phone layout (stage ≥ 42 vh, five-column stats, no overflow); `docs/09-release.md`.

**Measured.**
- 208/208 tests; the renderer split moved code only (no test touches rendering, so the check was the headless run: same screens, no console errors, bake 0.42–0.62 s).
- **axe-core 4** (WCAG 2.0 A/AA, 2.2 AA, best practices): 0 violations on the home page, the world at day 0, the world after ~100 days with the World tab open, and the world at an iPhone 12 viewport. Before: nested-interactive (434 nodes), region, landmark-one-main, color-contrast.
- **Lighthouse 12** (mobile, 4×): home 93 / 100 / 100 (LCP 2.6 s, CLS 0); world 61 / 100 / 100 (FCP 2.4 s, LCP 3.0 s, **CLS 0**, TBT 4.7 s — software-GL bake under throttle, as in M8).
- **In-page CLS** over a 40-second session (offers, declines, six tab changes): desktop 0.461 → **0.007**; phone 0.764 → **0.016**. The four causes, each found by logging `layout-shift` sources: the HUD wrapping when the stats widened (0.46), the panel switching to the Oracle tab on an offer (0.06–0.10 per offer), the web font swapping in at 0.9 s (0.145), the Oracle tab's "◈" reflowing the tab row (0.02).
- **In-page LCP** 2.8 s in headless SwiftShader (the vision card); INP needs real interactions — the report lists it as pending until there are some.
- **Phone**: before this milestone the stage was 56 px tall at 390 px wide — the map was not on screen at all. Now 279 px with the panel at 239; `scrollWidth === innerWidth`.
- The record: a 93-day world exported as 6.1 kB of Markdown with 50 day headings, the player's interventions and the ending slot.

**Not measured, and said so.** Field vitals (the page can now collect them; nobody has run it on a device yet); real screen readers; real GPUs. Not pushed: the deploy needs the owner's repository and a push I do not make unasked.

**Critic (1–10).** Visual originality 7 · Brand identity 7 · Typography 7 · Layout 8 (fixed grids at three widths; the phone finally shows the map; the empty HUD row on phones is the one visible seam) · Motion 6 · UX 8 (the record, the report, offers that no longer yank the view) · Accessibility 8 (0 axe violations and a sane heading tree; still untested with a reader) · Responsiveness 8 (measured, not assumed, at 390 and 412 px) · Functionality 8 · Performance 7 lab / unknown field · Code quality 8 (no file over 760 lines; `art.ts` is the largest and is data-like) · Business effectiveness 8 (a build the owner can deploy and measure).

**Five strongest decisions.** (1) Logging layout-shift sources instead of guessing — four distinct causes in one afternoon. (2) The HUD as a fixed grid: the map's position no longer depends on the length of a town's name. (3) Letting the page measure itself: field numbers without a server. (4) The record as Markdown — a world's story leaves the game. (5) Stopping the Oracle from switching tabs: a UX fix that was also the biggest remaining shift.

**Five weakest.** (1) INP cannot be judged until a person plays. (2) The phone HUD has an empty area beside "Hide panel". (3) Bridges are one sprite; a ford on a diagonal reads oddly. (4) The record omits events under importance 4, so it never shows a caravan or a birth unless the ending does. (5) The deploy is a checklist, not a deploy.

**Recommended next.** Push to the repository, enable Pages, play on a phone and a laptop, and paste the two performance reports here. Then the content pass the endings deserve (epilogue art per family) and the remaining design-doc endings.

## 545 DAYS — M10 content pass: six endings and their scenes (2026-10-23)

**Objective.** Spend a milestone on what the player reads at the end: more of the design document's endings, each honestly reachable, and a picture for every one.

**Built.** Five new endings in `story/endings.ts` — The Divided Humanity, Quarantine Nations, The Silent Generation, The Famine Fever, The Broken Crown — with a `quarantineDays` counter in the civ and the frame; cause-over-consequence rules (the Famine Fever needs both killers; the Silent Generation needs fertile couples still under one roof and a famine or fever on the record, so the Day-0 generation ageing out does not count); `render/epilogue.ts` (a scene per family with per-id variants, drawn from the map's own art at native pixel size) on the ending screen with an `aria-label`, and a `?gallery` page; a *technophile* scripted player in the missions harness; `tests/endings.test.ts` (6).

**Removed before shipping.** The Digital Exodus (03). It was written, then measured: the technophile player (every lab on automation, oversight 0, budget ×4) reaches Machine Dominion in 14/16 worlds and never 20 % unemployment, because this economy's automation lowers staff targets slowly and migration only follows hunger. An ending nobody can reach is a lie in a list, so it went back to the table as L with the reason.

**Measured.** 214/214 tests. Baseline (40 seeds): fragile 11 / hard 7 / Machine Dominion 5 / Silent Generation 4 / Red Plague 4 / Divided Humanity 2 / Iron Council, Broken Crown, Great Exodus, Scorched Border, Green Compact, Great Drought, Famine Fever 1 each — twelve distinct designed endings in one table. Scripted: closer → Iron Council 7, MD 6, Quarantine Nations 3; accept-all → Last Cure 6, Green Compact 3, Broken Crown 2; technophile → MD 14. Gallery: 19 scenes render with no errors; a 30-person world run to day 545 in headless Chromium shows the Red Plague scene (35,840 painted pixels of 35,840) above the numbers.

**Tuning record.** Silent Generation 6/40 → 4/40 after requiring a cause and fertile couples. Famine Fever 4/40 → 1/40 after requiring both killers (it had been taking the drought's and the plague's worlds). Digital Exodus 0/40 and 0/16 under every player → removed.

**Critic (1–10).** Visual originality 7 (the scenes are composed from the game's own art, which makes them of a piece; they are also small and similar in framing) · Brand identity 8 · Typography 7 · Layout 7 · Motion 6 (the scenes are still images) · UX 8 (the ending now has a picture, a vision check, numbers and an epilogue in that order) · Writing 7 (six new epilogues in the world's voice; the Broken Crown's "a thing people pick up off the floor" is the line of the milestone; the Divided Humanity's second paragraph is a list of numbers) · Accessibility 7 (scene canvas has a label; no text alternative describes the picture) · Functionality 8 · Performance 7 · Code quality 7 (`endings.ts` is 640 lines and should split by family like the chains did) · Business effectiveness 8.

**Five strongest decisions.** (1) Measuring an ending's reachability before shipping it, and cutting the one that failed. (2) Cause outranks consequence, stated as rules in the resolver. (3) Fertile-couples guard on the Silent Generation — the first version was an age artifact. (4) Scenes from the map's own art, so the ending looks like the world. (5) A gallery page for review.

**Five weakest.** (1) The scenes share one composition (a road, buildings on it, people on the road). (2) No text equivalent of the scene for screen readers. (3) The Loop (30) still needs the baseline passed to the resolver. (4) `endings.ts` is the largest hand-written file again. (5) The Broken Crown fires on successions by old age plus one removal — it reads a quiet dynasty as chaos when legitimacy happens to be low.

**Recommended next.** Split `endings.ts` by family; pass the baseline's fired set to the resolver for The Loop; a one-line alt text per scene; then the first real deploy and the field reports.
