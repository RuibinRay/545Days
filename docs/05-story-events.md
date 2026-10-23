# 05 — Story event dependency system

The story layer is a **data-driven conditional scheduler** that runs as phase 6 of every day. It owns no simulation state of its own except `WorldState.story`. Everything it does is either (a) read world state through `Condition`s, (b) change world state through the same `WorldEffect`s the economy uses, or (c) emit clues and events. It cannot, for example, "make the AI take over": it can raise `machineAutonomyRisk`, flip a project to `secret`, or spawn an incident event; the ending resolver reads the resulting state.

## Condition DSL

Conditions are data so they can be authored in tables, tested in isolation, and shown in the post-game "why" inspector.

```ts
type Condition =
  | { kind: "metric"; name: keyof DailyMetrics; op: Op; value: number }
  | { kind: "civ"; civ: "any" | CivId; path: "tech.machineAutonomyRisk" | "policies.oversight" | "legitimacy" | "treasury" | ...; op: Op; value: number }
  | { kind: "project"; role: string; path: "progress" | "safety" | "funded" | "secret"; op: Op; value: number | boolean }
  | { kind: "citizen"; role: string; path: "alive" | "occupation" | "workplace" | "health" | `belief:${string}`; op: Op; value: number | string | boolean }
  | { kind: "building"; role: string; path: "alive" | "condition"; op: Op; value: number | boolean }
  | { kind: "fired"; event: EventId; withinDays?: number }
  | { kind: "notFired"; event: EventId }
  | { kind: "count"; what: "businesses" | "citizens"; where: Partial<...>; op: Op; value: number }
  | { kind: "all"; of: Condition[] } | { kind: "any"; of: Condition[] } | { kind: "not"; c: Condition };
type Op = "<" | "<=" | "==" | ">=" | ">" | "!=";
```

**Roles, not ids.** Conditions reference `role: "md.scientist"` rather than citizen 42. World generation binds roles to concrete entities (`Citizen.storyRole = "md.scientist"`) and records the binding in `StoryState`. If the bound citizen dies, the role is re-bound by a rule in the event definition (`rebind: "best_science_skill_in_same_lab" | "none"`), which is exactly how "kill the scientist and another one continues the project" happens without scripting.

## StoryEvent

```ts
interface StoryEvent {
  id: EventId;                       // "md.lab_funded"
  chain: string;                     // "md" (Machine Dominion), "rp", "gd" …
  title: string;
  earliestDay: number; latestDay: number;
  required: Condition[];             // all must hold
  blockedBy: Condition[];            // any blocks
  probability: number;               // per eligible day, per-mille (0..1000) — drawn from the `story` stream
  once: boolean;
  effects: WorldEffect[];            // same effect vocabulary the economy uses
  clues: ClueTemplate[];             // what the player may learn
  importance: number;                // 0..10; ≥7 pauses Story Mode
  rebind?: Record<string, RebindRule>;
  onCancel?: EventId[];              // events that become impossible if this one is cancelled
}
```

Effects are the only mutation path: `{ kind: "civ.policy.delta" }`, `{ kind: "project.progress.delta" }`, `{ kind: "citizen.belief.delta" }`, `{ kind: "business.automation.set" }`, `{ kind: "disaster" }`, `{ kind: "spawn.event" }` …  They are applied by the same functions phase 4/5 use, so they obey the ledger and the invariants.

## Scheduling algorithm (phase 6, deterministic)

```
for ev in EVENTS sorted by (earliestDay, id):          // stable order
  if ev.id in fired(once) or cancelled: continue
  if day < ev.earliestDay: continue
  if day > ev.latestDay: cancel(ev); continue         // window missed → chain breaks here
  if any(blockedBy): continue
  if not all(required): continue
  if nextInt(story, 0, 999) >= ev.probability: continue
  apply(ev.effects); emitEvent(ev); emitClues(ev); record(fired)
cancel(ev): mark cancelled; for f in ev.onCancel: cancel(f)   // transitive
```

A chain is a DAG of events linked by `required: [{kind:"fired", event:…}]`. Nothing is hard-wired to a day; windows plus conditions give the pacing in docs/07 without guaranteeing it.

## Clues: rumor / evidence / vision

```ts
interface ClueTemplate {
  grade: "rumor" | "evidence";
  text: string;                       // with {citizen}, {business}, {settlement} placeholders
  truthful: boolean;                  // rumors can be false by design
  discoverBy: "auto" | "inspect_citizen" | "inspect_building" | "news" | "knowledge_cost";
  cost?: number;                      // knowledge points, for knowledge_cost
  refs: ("citizen" | "business" | "project" | "settlement")[];
}
```

- **Rumor**: shown in World News / overheard when inspecting a citizen. May be `truthful: false` (authored decoys, ~1 in 4). Rumors never carry numbers.
- **Evidence**: generated *from verified state* at the moment of discovery (e.g. "Lab ledger: 4,120 c/day in grants, project 'Sentinel' at 61 %"). Always true because it is a read, not a template.
- **Vision**: Oracle fragments (docs/06). Shown at Day 0 and unlocked as Knowledge grows. True *about the baseline*, which the player is changing — which is the point.

The Evidence Board is a graph UI over `RevealedClue.refs`; the player pins clues and the board shows which story chain each pinned entity participates in **only once the chain has produced ≥ 2 evidence-grade clues**, so the board never reveals an undiscovered chain by its shape.

## Interventions (Story Mode economy)

Influence Points (IP) regenerate 1/day, cap 30. Knowledge Points (KP) come from evidence discoveries. Sandbox ignores both.

| Intervention | IP cost | Notes |
|---|---|---|
| `set_policy` ±1 step | 4 | Requires `legitimacy ≥ 30` for the civ; the ruler can later revert it (an event) |
| `fund_project` / `defund_project` | 6 | Defunding a secret project needs it discovered first |
| `nudge_belief` ±20 | 3 | A citizen with `loyal` resists (half effect) |
| `nudge_trait` | 8 | One trait at a time; emits a memory for the citizen ("felt changed") |
| `relocate_citizen` | 5 | Only to a settlement with housing capacity |
| `remove_citizen` | 15 | Causes: colleagues' beliefs shift, role may rebind, legitimacy of the civ −5 if the person was prominent, `civ.disappearance` news event |
| `build` (clinic/warehouse/lab/power plant) | 10–20 | Also costs the treasury (must be ≥ cost) |
| `disaster` | 12 | Sandbox: free. Story: allowed but it is an intervention with full consequences |
| `reveal` | KP 5 | Converts the next rumor about the target into evidence |

Every intervention is also a `WorldEvent` with `type: "player.*"`, so the Day-545 "what changed" screen is the diff between the baseline schedule and the run's fired list, annotated with the player's own actions as causes.

## Fairness rules (enforced by the batch harness, not by hope)

For each implemented ending, a headless harness runs 200 baselines where that family is the primary threat and asserts:
1. ≥ 1 evidence-grade clue is discoverable before the chain's point of no return in ≥ 95 % of runs;
2. ≥ 2 distinct intervention paths (from docs/07) flip the baseline ending in ≥ 60 % of runs each when applied by a scripted "reasonable player";
3. the ending's baseline frequency sits in 5–40 %;
4. no run reaches Day 545 with zero eligible endings (fallback always valid).

## M4 addendum — missions (built) and how they relate to StoryEvents (M5)

The mission system shipped before the story scheduler and is deliberately simpler than it: a mission is **one offer with one action**, generated from the present state rather than from an authored chain, and its consequence is whatever the simulation does next. The scheduler above remains the design for *chains* (clues, windows, cancellation); missions are the Oracle's voice on top of it. When M5 lands, mission templates become one more `WorldEffect` a StoryEvent can carry (`spawn.mission`), and chain state (`fired`, roles) joins the preconditions in `candidateMissions`.

Rules as built (`src/sim/systems/missions.ts`): cadence from day 15 then every 40–50 days while none is open; one open at a time; 20 days to answer; templates not repeated within 120 days; the answer is an `Intervention` of type `mission` so replays, forks and exports carry it; the Worker computes a two-branch 90-day forecast on offer and pauses. Templates: `remove_researcher`, `oversight_law`, `raze_lab`, `depose_ruler`, `raze_farm`, `raze_barracks`, `broker_peace`, `arm_civ`, `stock_reserve`, `fund_clinic`. Influence/Knowledge points are not yet charged (Story Mode economy is M5); every mission is free, which the mission harness shows makes "accept everything" the dominant strategy — the M5 cost model and blowback events (martyrdom, reprisals) are the fix, not weaker missions.

## M5 as built (2026-10-22)

- **Scheduler** (`src/sim/story/scheduler.ts`, phase 6b): the algorithm above, run per civilization with fired ids `${event}@${civ}`; engine milestones (`research.loss_of_control`, `war.conquest`, `civ.coup`) are recorded into `fired` the day they happen so chains can depend on them. Conditions as built: `civ` (dotted path, op, value), `fired`/`notFired` (optional `withinDays`), `rulerTrait`, `hasLead` (a lab scientist of at least N science), `recent` (a notable event in the civ within N days, optionally by `occupation` or cause prefix — the last 90 days of importance ≥ 5 events live in `story.recent`), `atWar`, `all`/`any`/`not`. Effects: policy delta/set (base and current), tech delta, legitimacy delta, form set, attitude delta toward all, research pool delta, belief deltas for the lab lead / the engineers / everyone, conscription, ceasefire shortening, energy cut. Clues are filled from state (`{civ} {town} {lead} {ruler} {title} {budget} {automation} {risk} {oversight}`); evidence grants 2 Knowledge on firing, rumors none.
- **Chains** (`chains.ts`): **md** — proposal (5–120, needs a lead ≥ 55 science and automation ≥ 20; a true rumor and a false one) → lab_funded (needs research budget ≥ 3000; evidence from the ledger; +60 pool, +3 automation) → automation_sold (automation ≥ 50) → engineer_report (automation ≥ 55, risk ≥ 20; engineers come to believe the lab is dangerous; importance 7) → oversight_bill (needs a cautious ruler or oversight ≥ 40; +30 oversight, −10 risk; blocked once control is lost) → contained (after loss of control, oversight ≥ 60; −40 risk) → accord (contained and legitimacy ≥ 50; technocracy; ending 02). **bb** (blowback) — martyr (a scientist removed within 30 days: +$20/day research grant, +40 pool), reprisal (a ruler removed: attitudes −30 to all, +$30/day military budget, 4 conscripts, legitimacy +15 as the crowd rallies, ceasefire cut to 20 days), ashes (a building destroyed by the player: legitimacy −5, fear). Each fires at 25 %/day while its condition holds, at most once per 90–120 days per civ.
- **Influence / Knowledge** (`STORY_ECON` in `types.ts`): Influence starts at 15, +1 every other day, cap 30. Costs: remove 15, destroy 10, build 8, policy 4, decree 6, nudge 3, investigate 1; a mission costs the sum of its effects; nothing is taken on credit (the engine throws, the UI disables). Knowledge: +2 per evidence (a building investigated, or a chain's evidence clue), +1 per rumor (a person investigated); 5 buys the clear line of one vision. Investigation has a 60-day cooldown per target. All of it is state, so replays, forks and exports carry it.
- **Measured** (`tools/missions-harness.ts`, 20 seeds): ignore → MD 35 %, 13.9 battle deaths, 1.8 wars; accept everything (now paying Influence) → MD 0 %, 6.8 battle deaths, 1.7 wars — reprisals bring the wars back (before blowback: 0.8); peaceful → MD 0 %, 12.9 battle deaths. Blowback fires after ≥ 75 % of removals (test).
- **Not built:** the evidence board graph; `reveal` of secret projects (projects do not exist yet); Red Plague and Great Drought chains; mission costs still allow one mission per cycle at the regen rate — the tension is between missions and direct powers, not between missions.

## M7 as built (2026-10-22)

Two chains and five mission templates for the society systems.

- **co — the colony.** `co.crowded` (town full, one town only) → `co.survey` (treasury ≥ $4,000, no war; legitimacy +3; evidence clue) → `co.founding` (effect `civ.colony.found`: the chain founds the colony itself, silently nothing when there is no land or money) → `co.hardship` (a hunger death in the civ within 20 days of a colony standing: legitimacy −8, "the settlers buried their first dead") or `co.thrive` (the colony reaches 20 people: legitimacy +10, attitudes +5). Engine-founded colonies push `civ.colony@civ` to `fired`, so the chain, the ruler and the player all converge on the same milestone.
- **ex — the exodus.** `ex.talk` (bread ≥ 160 %) → `ex.first_families` (≥ 5 emigrants; legitimacy −5; the gate tally as evidence) → `ex.gates` (a neighbour's borders shut while bread ≥ 140 %: attitudes −15) and/or `ex.empty_streets` (town ≤ 70 % of Day 0: legitimacy −10, food price eases).
- **Missions.** `open_borders` (urgent; a civ with shut borders while a neighbour's bread is ≥ 150 %), `close_gates` (≥ 5 arrivals and ≥ 3 outside: shut the gate — the gray choice), `lift_export_ban` (urgent; a civ banning exports while a neighbour pays ≥ 150 % and its own bread is under 130 %), `found_colony` (a crowded, solvent, peaceful civ with land in reach), `open_trade` (two neutral, non-martial civs: warm both to 25 so the road opens). Decrees lock the ruler's hand for 120 days, so a mission's effect is not undone the next tick.
- **Not built:** the exodus chain has no "return" event when the famine ends; colonies have no founding ceremony on the map beyond a green flash; chains still live in one `chains.ts` (now 400 lines) that should split by chain.
