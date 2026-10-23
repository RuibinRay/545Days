# DESIGN_MEMORY — proven principles

Only lines that shipped and were checked on a device belong here. Untested ideas go in CREATIVE_EXPERIMENTS.md.

## Carried over from ruibinray.github.io (shipped 2026-10-19 → 10-21)

- **Build the fallback ladder before the effect.** Full → lite → still → text. Every tier keeps the experience alive instead of switching it off.
- **"It's frozen" usually means an OS setting.** Add a `?why` diagnostic that prints tier, reason, fps, GPU before debugging a report.
- **Reduce Motion is a mode, not a kill switch.** The world still updates; motion is replaced, not removed. Keep a visible pause control (WCAG 2.2.2).
- **Content in data files, code in modules.** Empty values hidden publicly; a `?draft` view for the owner.
- **Set `loading="lazy"` before `src`**, give `srcset` real widths, account for cover-cropping in `sizes`.
- **Deduplicate before adding** (byte-for-byte, then visually), **strip metadata** from every shipped file, **screen for private data**.
- **Preserve old anchors when restructuring**; delete orphaned config.
- **Prefer native when the existing loop already does the job** (dropped GSAP/ScrollTrigger, ~115 KB).
- **Self-host fonts**; no trackers.
- **Record decisions with a date and the owner's words** so the next session doesn't undo them.

## Added by 545 DAYS M0 (2026-10-21) — engineering, verified in this session

- **Named RNG streams per subsystem** (xoshiro128** + splitmix32 seeding) make "common random numbers" trivial: a test confirms burning the `citizens` stream leaves `weather` identical. (tests/rng.test.ts)
- **Plain-data RNG state** (a 4-number array) survives `JSON` and `structuredClone` round-trips and keeps producing the same sequence — snapshot/fork/Worker transfer come free.
- **Pin the first RNG outputs in a vitest snapshot** so a refactor cannot silently change every generated world.

## Added by 545 DAYS M2 (2026-10-21) — verified by the 200-seed harness

- **Audit the money before anything else.** A ledger with a conservation invariant turned every accounting bug into a hard failure on the day it happened. Tune nothing until the invariant holds on 200 seeds.
- **A headless harness beats the UI for tuning.** 200 runs × 545 days in ~15 s; the UI run shows one world at a time. Print the handful of numbers that matter (deaths, unemployment, price band, closures/openings/upgrades, ms/run) and iterate.
- **Stabilisers before features.** Supply response, demand elasticity, means-tested transfers and a budget rule made the world survive; none of them are "features" a player sees.
- **Everything the step needs lives in `WorldState`.** Module-level caches silently couple runs.

## Added by 545 DAYS M3 (2026-10-21) — verified by tests and a headless browser run

- **Snapshots stay in the Worker; the UI gets day numbers.** Nothing to keep in sync, and `peek`/`fork` are a replay away. Measured: 1.1 ms per snapshot at 30 citizens on 96×96.
- **"Peek" = replay, not a stored history.** Scrubbing the timeline re-simulates from the nearest snapshot (≤ 29 days, tens of ms). Zero memory, always consistent with the live state's rules.
- **An export file is seed + settings + interventions + the final hash.** Hundreds of bytes, replays exactly, and import can prove it did. Never ship state when you can ship the recipe.
- **Make the ending resolver a pure function of (state, events, metrics).** It becomes testable on 50 seeds in seconds and the story milestones only have to register entries.
- **Cross-context determinism is a test, not an assumption.** Compare the Worker's hash with a Node run of the same seed in the headless check; it caught nothing this time, which is the point.
- **Causes as ids, prose at the edge.** Events carry `causes: eventId[]`; "why?" is a graph walk; sentences are produced once, in `eventText`, with a test that every event type has one.

## Added by 545 DAYS M4 (2026-10-22) — verified by the 40-seed harness and the mission harness

- **A forecast is a replay.** Snapshot the live state, apply each answer, run N days, summarise. No new state, no drift, and it reuses the Oracle budget. The player gets exact knowledge of *this* world's two branches.
- **Missions are interventions.** Offer in state, answer as an `Intervention` → replay, fork, export and determinism tests all cover them with no extra code.
- **Scripted players are the acceptance test for a decision system.** ignore / accept-all / peaceful on 24 seeds showed in one table that missions matter and that free missions make "yes" dominant.
- **Size armies by budget and cap them by people.** `staffTarget = budget / wage`, capped at a quarter of adults, with conscription floors for food producers — the one rule that stopped war from becoming famine.
- **Give factions personality through the ruler, not through constants.** Trait-driven thresholds and rest points produced the variety that tuning numbers never did.
- **Trace money before tuning.** Summing balances by holder and reading one citizen's ledger found the monopoly in minutes; guessing had cost an hour.
- **Validate offers with the executor.** Any action the game proposes must be checked by the same function that will perform it.
- **Keep derived futures out of the state.** The baseline sits beside `WorldState` (in the run and the save), so the live hash still equals a Node run of the same seed and determinism tests stay one line. (M4b)
- **Measure the "2 s" budget where it runs.** 0.6 s in Node became 3.5 s in a 2-core headless browser; schedule heavy one-offs after first paint and report the browser number. (M4b)
- **Blowback is what makes a cheap power expensive.** Charging Influence alone did not stop "accept everything"; a reprisal chain that rallies the successor and shortens the ceasefire did (wars 0.8 → 1.7 under accept-all). Price consequences in the world, not only in the wallet. (M5)
- **Engine milestones join the story's `fired` list.** Chains can then depend on systemic events (loss of control, conquest, coup) with the same `fired` condition as on authored events. (M5)
- **Cap contacts per place.** Infection risk from a crowded building must saturate (min(count, 3)), or the market is a superspreader and every epidemic is a one-month sweep. (M6)
- **Make the obvious responses the ruler's, the decisive ones the player's.** Rulers fund clinics and close gates slowly; the cure and the warehouse come from the Oracle's offers — so the designed endings are earned, and the baseline keeps them in the 5–40 % band. (M6)
- **Urgent offers first.** With ten templates drawn at random, a plague got no offer in time; a short urgency list fixed the peaceful player's outcomes without changing any template. (M6)
- **Lock the player's decree for a season.** A toggle the ruler manages (quarantine, borders, exports) needs a lock date, or the council undoes the mission on its next tick and the choice was theatre. (M7)
- **Move households, not people.** One `household()` function used by migration, relocation and colonisation keeps families together everywhere and makes the tallies agree. (M7)
- **Frames carry what the world grew.** New people, new towns and the territory map travel as a delta in the next frame; nothing is re-announced and nothing is stale. (M7)
- **Rerun the ending table after any change to who meets whom.** Hiring locality, trade, borders — each one is an epidemiology and famine change in disguise. (M7)
- **Scripted strategies are the acceptance test for endings.** *closer* reached The Iron Council 13/16 and proved the ending and the decree lock in one run; a baseline frequency alone cannot show that a player can get there. (M7)
- **Paint live overlays by nearest town, fading with distance.** The five-tile territory hides under the buildings; a 16-tile reach reads at any zoom. (M7)
- **Upload overlays as bytes.** `BufferImageSource` works where canvas-backed textures did not (headless SwiftShader). (M7)
- **Roads are state.** One Dijkstra path per pair of towns feeds travel time, cart placement, marches and the terrain bake; the renderer only reads it. (M8)
- **Bake what the camera sees first, the rest on a budget.** Nine chunks synchronously, 6 ms per tick after; first frame fell from seconds to two thirds of one. (M8)
- **Variants by position hash, not by random.** `hash2(x, y, seed) % 4` picks a tile variant deterministically, costs nothing, and ends the wallpaper look. (M8)
- **Headings: a hidden h1 and h2 let the panels keep their small-caps h3s** without failing heading-order; aria-labels must contain the visible text. (M8)
- **Lab numbers with the throttle named.** "0.66 s at 1×, 1.45 s at 4×, SwiftShader" is a claim someone can repeat; "fast" is not. (M8)
- **Sound off by default, created on a gesture, every cue also text.** Nothing depends on audio and nothing plays before the player touches the page. (M8)
- **Log `layout-shift` sources before fixing CLS.** Four unrelated causes hid under one number; each took a different fix. (M9)
- **HUDs are grids, not wrapping flex rows.** `minmax(0, 1fr)` for the text that may grow, ellipsis on it, fixed areas for the rest. (M9)
- **Reserve the slot.** A tab mark, a mission card, a ticker line: give each its space when empty so arrivals do not move the rest. (M9)
- **Let a static site measure itself.** `web-vitals` + a copyable report gives field numbers without a server; INP stays blank until a person plays, and the panel should say so. (M9)
- **Audit with axe at every width, then fix the pattern, not the node.** One rule change fixed 434 violations. (M9)
- **Never move the player's view on a world event.** Light the thing; let them come. (M9)
- **Reachability before prose.** An ending earns its epilogue by appearing in a baseline or a scripted player's table; otherwise it goes back to the design doc with the reason. (M10)
- **A cause-ending must rule out the calendar.** Guard "X stopped" endings with "and X could still have happened". (M10)
- **Combined disasters need both parts lethal**, or the combination outranks the singles everywhere both chains fire. (M10)
- **Scenes from the game's own art** keep the ending in the world's register and cost nothing new. (M10)
