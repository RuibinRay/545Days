# 06 — The Future Oracle

## What it is

The Oracle is **the same engine, run ahead, headless, in a Worker**. It is not a prediction model and not an LLM. "The future has been simulated" is literally true: the fragments the player sees at Day 0 come from a real 545-day run of the world they are about to play.

## Algorithm

```
1. generate(seed, settings)             → state₀, roles bound, hidden story conditions set
2. snapshot₀ = structuredClone(state₀)
3. OracleWorker: for d in 1..545: step(state, [])      no interventions, no rendering
      collect events[], metrics[], every 30 days hash(state)
4. ending = EndingResolver(state₅₄₅)                   primary + secondary outcomes
5. fragments = selectFragments(events, ending, settings.endingPreview)
6. baselineSchedule = story events fired, with days
7. SimWorker: load snapshot₀; story.baselineEnding = ending; story.baselineSchedule = …
8. show fragments; begin play at Day 0
```

Cost: at 30 citizens the baseline is ~0.25 s; at 150 ~1.2 s. The loading screen shows "simulating 545 days…" with real progress, and the first fragment is revealed when it finishes — no fake delay.

## Why determinism makes this honest, and where it stops

- With **no** interventions, the player's run is bit-identical to the baseline (`hash(day d)` matches; a test asserts it). The schedule the Oracle recorded *is* what will happen.
- With an intervention on day *k*, days ≤ *k* still match. After *k*, only subsystems whose RNG stream was touched diverge in their randomness; unrelated streams (`weather`) continue producing exactly the baseline's numbers. So if the drought still comes after the player defunds the lab, it is because the *weather* was always going to do that — not because the dice were rerolled. That is the entire reason for named streams.
- What this does **not** mean: that an intervention changes only "its" subsystem. The economy couples everything; the point of the design is that the player must reason about the coupling, not that the coupling is hidden.

## Fragment selection

Input: baseline events sorted by `importance`, the ending id, and the preview setting.

| Setting | Day-0 reveal | Unlockable later (via Knowledge) |
|---|---|---|
| clear | ending title + 3 fragments (importance ≥ 8) with day ranges ("between Day 380 and 440") | all importance ≥ 6 events as visions |
| cryptic (default) | 3 fragments, **no ending title**, no days, entity names replaced by role descriptions ("a researcher", "the northern town") | same, revealed names at KP cost |
| off | nothing | nothing (Chronicle mode) |

A fragment is rendered as a *vision* cutscene: palette-shifted still of the relevant map region as it looked in the baseline on that day (the Oracle saves a 96×96 biome/owner/fx snapshot for each selected fragment — a few KB each), plus one line of authored text from the event's `vision` template. Visions are illustrated by the engine's own map, never by generated imagery, so they are always consistent with what the player can later find.

Selection rules: at least one fragment from the primary chain, at most one from a secondary chain, never the chain's *first* event (the mystery must leave the cause to be found), prefer fragments with `refs` to entities the player can inspect at Day 0.

## Divergence tracking

Each day the SimWorker compares `story.fired` to `baselineSchedule`:
- an event fired in the baseline but now `cancelled` → **"the future shifted"** indicator in the Future panel (no detail);
- a baseline event missed its window → same;
- a *new* event not in the baseline → "unforeseen" indicator.

Every 30 days the metrics panel can show baseline vs. actual for discovered metrics only (e.g. `machineAutonomyRisk` once the player has evidence it exists). The baseline curve is a reference, not a promise, and the UI says so once.

## Interaction with the three initial endings

- **Machine Dominion** baseline: the scientist's project is funded, progresses, safety stays low, the civ centralizes energy, risk crosses 85 by ~Day 420, the loss-of-control event fires, the resolver picks MD.
- **Red Plague** baseline: an outbreak event fires in a trade settlement, clinics underfunded, infection crosses 40 % of population, deaths > 25 %, resolver picks RP.
- **Great Drought** baseline: drought chain lowers moisture, food reserve policy is low, prices ×4, migration + unrest, two settlements collapse, resolver picks GD.

World generation picks the **primary threat family** (one of the three in v1) and seeds the corresponding hidden conditions (a secretive scientist; a trade route and a weak clinic; a dry climate preset and a low-reserve ruler). It does *not* guarantee the outcome: ~25–35 % of baselines should end in the fallback "Unfinished Age" because the world happened to cope, and the harness checks this. When the baseline ending is the fallback, Story Mode reveals that as "the future is quiet — for now" and the secondary threats become the mystery.

## Performance safeguards

- The Oracle runs in its own Worker so the menu's background world keeps animating.
- Populations > 300: the Oracle uses `oracleFidelity: "fast"` — identical rules, but citizens with `importance = 0` (no story role, no business) are decided in batches of 4 sharing one draw. The playable run uses full fidelity. The UI states this in `?why` and the Future panel caveat. Not needed for v1 (≤ 150).
- Baseline artefacts (events, metrics, fragment snapshots) persist in IndexedDB with the save; reloading a world never re-runs the Oracle.

## What the Oracle is *not* used for

Not for "Ask the World" counterfactuals in v1. Counterfactual = fork a snapshot + intervene + run, which is already the Alternate Universe feature at Day 545. An LLM answering "what if the kingdom had never declared war" by *writing* an answer is exactly the fabrication this design forbids.

## M4b as built (2026-10-22)

- **Baseline** (`src/sim/story/oracle.ts` → `computeBaseline`): the Worker clones the Day-0 state after the map is on screen and runs it to Day 545 with no interventions in 30-day chunks, keeping the ending, every event of importance ≥ 5, the daily metrics, a state hash at every 30-day mark, and per-civ end facts. It is not written into `WorldState` (so the live hash still equals a Node run of the same seed); it is stored with the save (`SavedWorld.baseline`), copied to forks and restarts, and recomputed on import. Measured: 0.6 s in Node at 300 citizens; 3.5 s in a 2-core headless Chromium (the budget in docs/08 said 2 s — on weak machines it is over, and the map is interactive while it runs).
- **Visions** (`visionFragments`): up to three fragments — the first occurrence of each of the baseline's most dramatic event types (conquest, loss of control, coup, war, succession, price spike, raid, riot, destruction), earliest first — plus the ending, each with a cryptic line and a clear line. `settings.endingPreview` picks cryptic / clear / off. Shown once at Day 0 (and on restart) as a reveal-one-at-a-time overlay; kept in the Oracle tab; the clear lines replace the cryptic ones once the run has ended.
- **Divergence** (`divergence`): at any day, population, machine risk, unrest and prices against the baseline's, plus key events foreseen-but-missing and happened-but-unforeseen (type, civ/settlement, within 20 days), scored 0–100 and shown as a meter in the Oracle tab; the Analytics charts draw the baseline as a dashed line beside the live one; the ending screen states what was foreseen, what came, how many interventions, and the departure score.
- **Tests** (`tests/oracle.test.ts`): a no-intervention run hash-matches the baseline at every 30-day mark; one intervention on day 91 matches before and differs after; divergence is 0 before it and positive after; visions reference real baseline events and never print the day in cryptic mode; the baseline is a pure function of the state.
- **Not built yet:** Knowledge-gated reveal of the clear lines before Day 545; fragments as drawn scenes; the Day-545 "what changed" diff by intervention (the ending screen gives counts and the unforeseen turning points, not the per-action trace).
