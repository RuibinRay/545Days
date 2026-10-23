# 07 — Endings

## Resolver

At Day 545 (or earlier on a terminal condition), `EndingResolver`:
1. evaluates every `EndingDefinition.eligibility` against the final state;
2. among eligible endings computes `score(state)` (0..100) and picks the highest; ties broken by `severity` then id;
3. records up to two **secondary outcomes** (eligible endings with score ≥ 40 that were not primary);
4. if nothing is eligible → **The Unfinished Age**, a parameterized epilogue (prosperity / stagnation / fragile peace variants chosen by metrics). It is not a collectible.

```ts
interface EndingDefinition {
  id: string; title: string; family: Family; severity: 1|2|3|4|5;
  eligibility: Condition[];
  score: (m: DailyMetrics, s: WorldState) => number;    // pure, integer math
  epilogue: EpilogueTemplate;                            // placeholders filled from state
  archiveArt: string;                                    // original pixel illustration id
}
```

## The 30 archetypes (defined now, built later)

Status: **B** = built in v1, **S** = systems exist after M6, **L** = needs later systems (war, space, fantasy).

### Family 1 — Technology & AI
| # | Ending | One-line eligibility | Needs | Status |
|---|---|---|---|---|
| 01 | Machine Dominion | `machineAutonomyRisk ≥ 85` (M4 registers the risk-only form; the clue chain and `md.contained` arrive with M5) | research, policy, energy centralization | **B (M4, risk-only)** |
| 02 | Human–Machine Accord | `md.accord` fired (loss of control contained by oversight ≥ 60, legitimacy ≥ 50) | md chain (M5) | **B (M5)** |
| 03 | The Digital Exodus | automation ≥ 90, unemployment ≥ 50 %, migration out ≥ 40 % | economy, migration | **L — unreachable with the current economy: automation does not displace workers and nobody migrates for work (M10 finding)** |
| 04 | The Great Blackout | single power network, `energy` shortage ≥ 60 days, pollution high | energy grid model | S |
| 05 | The Replicator Swarm | automated factories ≥ 80 % of industry, materials depleted, risk ≥ 70 | resource depletion | S |
| 06 | The Divided Humanity | one civ automation ≥ 60, another ≤ 25, mutual attitude ≤ −40, never a caravan between them | diplomacy | **B (M10)** |

### Family 2 — Disease, biology & evolution
| # | Ending | Eligibility | Needs | Status |
|---|---|---|---|---|
| 07 | Red Plague | plague deaths ≥ 10 % of the Day-0 population (the "infected ≥ 10 % at Day 545" clause was dropped: epidemics burn out in ~140 days) | health system (M6) | **B (M6)** |
| 08 | The Last Cure | outbreak fired, `rp.cure` fired, deaths < 10 % | medicine research | **B (M6)** |
| 09 | Quarantine Nations | `rp.index` fired, every living civ quarantined ≥ 60 days in total, plague deaths < 8 % | `quarantineDays` (M10) | **B (M10)** |
| 10 | The Silent Generation | births in the last 180 days ≤ 10 % of the first 180, ≥ 5 fertile couples still under one roof, a second drought or a fever cluster on the record, population ≥ 50 % | births (M7) | **B (M10)** |
| 11 | Adaptive Bloom | medicine ≥ 90 and a `bio.enhancement` chain | later research tree | L |
| 12 | The Famine Fever | `gd.second_drought` and `rp.cluster` fired, plague deaths ≥ 4 % and starvation ≥ 3 % | health + climate | **B (M10)** |

### Family 3 — Climate, resources & nature
| # | Ending | Eligibility | Needs | Status |
|---|---|---|---|---|
| 13 | Great Drought | rainfall ≤ 45 and (starvation ≥ 10 % or a town at half its Day-0 population) | climate, markets, migration (M6) | **B (M6)** |
| 14 | The Green Compact | `gd.first_drought` and `gd.irrigation` fired, < 5 starved, every town ≥ 80 % of Day 0 | agriculture research or warehouse + granary (M6) | **B (M6)** |
| 15 | The Ash Sky | pollution ≥ 90 for 120 days, health avg ≤ 40 | pollution | S |
| 16 | Hollow Mountains | ore + coal deposits exhausted, industry collapse | depletion | S |
| 17 | The Returning Forest | population ≤ 30 % of start, forest tiles ≥ 2× start | regrowth | S |
| 18 | The Flood Age | flood disaster chain (river swell) + coastal losses | hydrology | L |

### Family 4 — War, politics & society
| # | Ending | Eligibility | Needs | Status |
|---|---|---|---|---|
| 19 | The Iron Council | borders shut ≥ 120 days and shut tonight, legitimacy ≥ 50, ≥ 90 % of its people | borders (M7) | **B (M7)** |
| 20 | The Broken Crown | ≥ 2 coups in one civ, or ≥ 3 changes of ruler (coup, succession, disappearance) with legitimacy ≤ 35 | politics | **B (M10)** |
| 21 | The Long Peace | ≥ 2 civs, no war declared, no riot, every attitude ≥ 20 at Day 545 | diplomacy | **B (M4)** |
| 22 | The Scorched Border | ≥ 1 settlement conquered | war system (M4) | **B (M4)** |
| 23 | The Merchant Republic | one civ holds ≥ 70 % of all trade volume and `form = republic` | diplomacy | S (The Merchant Road, M7, covers the trade-peace case) |
| 24 | The Great Exodus | a civ lost ≥ 30 % of its start population to other nations, or a Day-0 town at half with ≥ 10 emigrants | migration (M7) | **B (M7)** |

### Family 5 — Cosmic, mystery & extraordinary
| # | Ending | Eligibility | Needs | Status |
|---|---|---|---|---|
| 25 | Falling Sky | meteor chain (observatory warning → impact) with impact fired | cosmic event chain | L |
| 26 | The Watchers' Signal | signal chain + a `research.contact` project at 100 % | later research | L |
| 27 | The Hollow Earth | quake chain + `geo.cavern` discovery chain | geology | L |
| 28 | The Eternal Dusk | atmospheric event chain (volcanic winter) | climate | L |
| 29 | The Chosen City | a civ took in ≥ 8 migrants, grew ≥ 10 %, ≤ 2 outside, borders open | migration (M7) | **B (M7)** |
| 30 | The Loop | the player's run ends with a fired/cancelled set identical to the baseline **and** ≥ 1 intervention | story meta | S — the resolver does not see the baseline; needs the Worker to pass it (noted M10) |

Fallback (not numbered): **The Unfinished Age**.

---

## Full specification — 01 Machine Dominion

**Tests:** character goals, research, policy, centralized infrastructure, branching.

**Hidden setup at worldgen** (when primary family = tech): bind `md.scientist` (science ≥ 70, traits `ambitious` + `secretive`), `md.lab`, `md.project` (`secret: true`, field automation, progress 10–25, safety 0–10), a ruler with `researchBudget` above median and `oversight ≤ 20`, one `power_plant` serving all settlements (centralization 1.0).

**Chain**

| id | window | required | effects | clues (grade) |
|---|---|---|---|---|
| md.proposal | 5–60 | scientist alive & employed at lab | project.funded=true if researchBudget ≥ 1500; else stays false | R: "A researcher at {lab} is asking the council for money." |
| md.lab_funded | 20–140 | fired(md.proposal), project.funded | progress +10; event importance 5 | E (inspect lab): grant amount and project name |
| md.automation_sold | 90–240 | progress ≥ 50 | 2 factories `automation.set 60`; unemployment ↑ | R: "The mill fired twelve people and nobody saw new machines arrive." E (inspect factory): automation % |
| md.grid_integration | 160–320 | fired(md.automation_sold), power plant alive | tech.automation +15; machineAutonomyRisk +10; centralization locked | E (inspect plant): "control relay installed by {lab}" |
| md.engineer_report | 220–400 | an `engineer` works at plant, safety ≤ 40 | belief `lab_is_dangerous` +40 for that engineer; **importance 7 (pause)** | R (true): "An engineer says the relays make decisions on their own." |
| md.oversight_bill | 230–420 | fired(md.engineer_report), ruler `cautious` OR oversight ≥ 40 | oversight +30; safety +20 | E: law text |
| md.loss_of_control | 340–470 | progress ≥ 95, safety ≤ 50, risk ≥ 70 | risk +20; energy supply −50 % to non-lab buildings; `civ.form` → "machine" if legitimacy ≤ 40; **importance 9** | V: the Day-0 vision comes from here |
| md.contained | 350–520 | fired(md.loss_of_control), oversight ≥ 60 or a second power plant alive | risk −40; chain ends in Accord or fallback | — |
| md.accord | 400–540 | fired(md.contained), legitimacy ≥ 50 | civ.form technocracy; ending 02 eligible | — |

Point of no return: `md.loss_of_control` with no second power plant and oversight < 40.

**Eligibility:** `risk ≥ 85 ∧ fired(md.loss_of_control) ∧ ¬fired(md.contained)`.
**Score:** `risk` (so a world with risk 95 and a collapsed economy outranks a quiet one).

**Intervention paths (all must flip ≥ 60 % of baselines in the harness)**
- A. `remove_citizen(scientist)` early → role rebinds if another scientist with science ≥ 60 exists in the lab (≈ 50 % of worlds); otherwise project stalls. Side effects: legitimacy −5, lab staff beliefs, a `disappearance` rumor the *player's own action* generated.
- B. `nudge_belief(scientist, "safety_matters", +40)` ×2 → safety work rate ×2; weakens but does not kill the chain.
- C. `set_policy(oversight)` to ≥ 60 before Day 300 → unlocks `md.oversight_bill` regardless of ruler trait; makes `md.contained` reachable.
- D. `build(power_plant)` in a second settlement → centralization 0.5, risk growth halves, `md.contained` has a second route. Costs treasury; may starve the health budget (Red Plague coupling).
- E. `fund_project` of a *rival* safety project (role `md.rival`, Dr. Mara Chen in the example) → `safety` grows from a second source; Accord path.

**Epilogue placeholders:** scientist name/fate, the day the relays took the grid, which settlement kept its lights, unemployment at the end, whether the player's actions appear in `causes` of `md.loss_of_control`.

---

## Full specification — 07 Red Plague

**Tests:** transmission, movement, health system, interventions, population effects.

**Hidden setup:** two settlements with `trade` relations; `md`-style roles: `rp.index_case` (a merchant who travels), `rp.clinic` with capacity 4 and `healthBudget` low; a `doctor` with `care ≥ 60` exists somewhere (`rp.doctor`).

**Model (phase 2):** states none → incubating (5 d) → sick (12 d) → recovered/dead. Daily transmission to a citizen: `p = 0.0 + 0.03 × (sick contacts in same building that day) × (1 − clinic coverage) × crowding`, contacts from itineraries (same workplace/market/home). Death at end of sick: `p = 0.08 + (100 − health)/500 − 0.06 × treated`. Recovered are immune. Infected skip work (output drops, wages stop) — the economic coupling.

**Chain:** rp.index (20–120, merchant travels, 1 infection) → rp.cluster (≥ 5 sick in one settlement; importance 6; rumor "a fever at the market") → rp.spread (sick in both settlements) → rp.overwhelm (sick > clinic capacity × 3; deaths climb; importance 8) → rp.cure (requires medicine project ≥ 100 **or** healthBudget ≥ 3× baseline for 60 days; treated flag for all) → rp.quarantine (relations embargo while sick ≥ 10 %).

**Eligibility:** `infectionDeaths / startPopulation ≥ 25 % ∧ infected ≥ 10 %`. **Score:** death share ×2 + infected share.

**Intervention paths:** A. `set_policy(healthBudget)` ×3 early → clinic coverage; B. `build(clinic)` in the second settlement; C. `set_policy` embargo (relations) before rp.spread — stops movement, crashes trade income → unrest coupling; D. `fund_project(medicine)` with `rp.doctor` as lead; E. `relocate_citizen(index_case)` to an isolated settlement (needs the rumor "a merchant came back ill" to identify them).

---

## Full specification — 13 Great Drought

**Tests:** environment, food production, markets, shortages, migration, stability.

**Hidden setup:** `climate = dry`, rainfall 55, one river, farms ≥ 70 % on non-river tiles, ruler `foodReserveDays ≤ 5`, no `warehouse`.

**Chain:** gd.dry_spring (30–90; rainfall −10; rumor "wells are lower") → gd.first_drought (60–180; droughtDays = 40; importance 6) → gd.harvest_fail (farm output < 50 % of day-0 for 20 days; prices ×2; evidence from market) → gd.hoarding (a `greedy` merchant stockpiles; price ×1.5 extra; rumor) → gd.second_drought (200–360; droughtDays = 70; importance 8) → gd.abandonment (settlement food reserve 0 for 30 d and unrest ≥ 70 → migration wave) → gd.irrigation (requires agriculture project ≥ 100 or `build(warehouse)` + reserve ≥ 60 d → chain can be contained) → gd.collapse (≥ 2 settlements with population < 20 % of start).

**Eligibility:** `foodDaysReserve = 0 for ≥ 60 days ∧ abandoned settlements ≥ 2 ∧ rainfall ≤ 30`. **Score:** 100 − avg food need.

**Intervention paths:** A. `set_policy(foodReserveDays)` ≥ 60 before gd.second_drought; B. `build(warehouse)`; C. `fund_project(agriculture)` → irrigation (farms near river ×1.5, others ×1.2); D. `paint_terrain`-free alternative in Story: `relocate_citizen` farmers to river tiles (slow, cheap); E. `nudge_belief(merchant, "hoarding_is_shameful")` or `set_policy(taxRate)` ↑ to fund reserve purchases → unrest coupling.

---

## Why these three first

They exercise three disjoint subsystems (research/policy, health/movement, climate/markets) and two couplings each (energy↔economy, trade↔disease, prices↔unrest). Everything the other 20 "S" endings need is a *reuse* of those systems with new tables. The "L" endings each need a new subsystem (war, hydrology, cosmic events) and are correctly out of scope until the first three are fun.

## M7 as built (2026-10-22) — the society family

Five endings registered in `story/endings.ts` under a new `society` family (and two under `politics`). Each is a predicate over the final state plus an epilogue written from the world's own names and numbers.

| id | title | severity | eligible when | score |
|---|---|---|---|---|
| `society.chosen_city` | The Chosen City | 1 | a civ took in ≥ 8 migrants, grew to ≥ 110 % of its start, has ≤ 2 people outside and its borders open | 45 + migrants + wellbeing/4 |
| `society.great_exodus` | The Great Exodus | 4 | a civ lost ≥ 30 % of its start population to other nations, or a Day-0 town fell to half with ≥ 10 emigrants | 150 × share + 2 × turned-away events |
| `society.founders` | The Founders | 1 | a civ at peace with a colony of ≥ 12 people and at least its starting population | 35 + colonists + births/2 |
| `politics.iron_council` | The Iron Council | 3 | a civ with its borders shut ≥ 120 days in total and shut tonight, legitimacy ≥ 50, ≥ 90 % of its people | 30 + closedDays/5 + 3 × turned-away |
| `politics.merchant_road` | The Merchant Road | 1 | ≥ 2 trading pairs, ≥ 1,000 units carried, no war declared after day 300 | 45 + units/60 − 10 × wars |

`climate.great_drought` was widened: a second drought with ≥ 4 % dead of hunger qualifies (caravans now feed most famines, so the 10 % rule almost never held).

Measured reachability (16 scripted seeds each): the *closer* player (shuts every border and bans every export from day 30, renewing the decrees) reaches The Iron Council 13/16; *accept-all* reaches The Merchant Road 2/16; the baseline reaches The Founders and The Iron Council on their own (1–2/40). The Chosen City and The Great Exodus are eligible in the baseline (seed 118785: a raided town empties — 29 starve, 50 walk) but lose on score to Red Plague or The Scorched Border; they appear as secondary outcomes on the ending screen.

## M10 as built (2026-10-23) — six more endings and a scene for each

Registered: **The Divided Humanity** (06), **Quarantine Nations** (09), **The Silent Generation** (10), **The Famine Fever** (12), **The Broken Crown** (20); plus The Founders and The Merchant Road from M7 that the table did not number. Eighteen designed endings in all. Removed before shipping: The Digital Exodus (03) — written, measured, and found unreachable: with every lab on automation and no oversight the risk reaches Machine Dominion long before unemployment reaches 20 %, because automation in this economy lowers staff targets slowly and nobody migrates for work. It stays in the table as L with the reason.

Measured reachability (40 baselines / 16 scripted seeds): Silent Generation 4/40, Divided Humanity 2/40, Famine Fever 1/40 (3/40 before it required both killers), Broken Crown 1/40 and 2/16 for the accept-all player (who removes rulers), Quarantine Nations 3/16 for the *closer* player once it decrees quarantines. Precedence rules added so a cause outranks its consequence: the Famine Fever needs plague ≥ 4 % **and** hunger ≥ 3 %, otherwise the single disaster keeps its headline.

**Scenes.** `render/epilogue.ts` draws one 320 × 112 vignette per family from the map's own tile, building, citizen and cart art, with id-specific variants: straw and a dry river for the drought, irrigation channels for the Compact, green-tinted people for a plague and none for the cure, a bar across the road for quarantines, a wall between two halls for the Iron Council, a ruin for the Broken Crown, carts for the Merchant Road and the Founders, people walking off the right edge for the Exodus, relay lights (blue under the Accord, red under Dominion) and a divide for the Divided Humanity, ruins and a red sky for the Scorched Border, dusk for the Unfinished Age. `?gallery` on the home page shows all nineteen for review.
