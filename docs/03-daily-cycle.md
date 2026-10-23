# 03 — The daily simulation cycle

`engine.step(state, inputs) → { state, events, metrics }`. One call = one day. Phases run in this fixed order; each phase draws randomness only from its named stream. Every number below is a *starting value* to be tuned at M2/M3 — the structure is the commitment, not the constants.

## Phase order

| # | Phase | RNG stream | Writes |
|---|---|---|---|
| 0 | **Apply interventions** queued for today | — | anything the Intervention type allows; emits `player.*` events |
| 1 | **Environment** | `weather` | climate, terrain.moisture, building.condition (disasters) |
| 2 | **Citizens: needs & health** | `health` | needs decay, infection progression, deaths, births, ageing |
| 3 | **Citizens: decide** | `citizens` | each citizen picks one action for the day; writes itinerary |
| 4 | **Economy: produce → pay → trade → tax** | `market` | business inventories/cash, citizen wealth, market prices, treasury |
| 5 | **Civilization** | `civ` | ruler policy adjustments, research progress, legitimacy, unrest, migration |
| 6 | **Story scheduler** | `story` | fire eligible StoryEvents, emit clues, cancel broken chains |
| 7 | **Record** | — | WorldEvents, DailyMetrics, ledger; check invariants in dev builds |
| 8 | **Terminal check** | — | extinction, irreversible catastrophe, day 545 → EndingResolver |

Rendering is **not** a phase. The Worker derives a `RenderFrame` from the new state after step 8 and posts it.

## 1. Environment

- `season = floor((day mod 360) / 90)`; rainfall base by season and climate preset.
- Drought: if `climate.droughtDays > 0`, `moisture[t] -= 3` on non-river tiles (floor 0), `droughtDays--`. Drought onset is a story/disaster event, not random weather, so it is traceable.
- Recovery: toward a per-tile `baseMoisture` (worldgen value, stored as a 7th terrain layer at M2): tiles within 2 of a river `+2/day`, others `+1 × rainfall/100`, never above base. *(M1 correction: the earlier "recover toward 255" rule had no equilibrium — every map would saturate by Day 200.)*
- Pollution: `+1` per operating factory and coal power plant per day, `−2/day` natural decay, clamp 0..100.
- Fire/quake disasters lower `building.condition` of affected tiles; condition < 20 flips a building to `ruin` and evicts its residents/business (`econ.business_closed`, cause `disaster.*`).

## 2. Citizens: needs, health, decision

**Needs decay** (per day): food −12, shelter −4 if homeless else −1, safety −(unrest/20), belonging −3. Eating restores food to 100 and consumes 1 unit from `foodStock`; a citizen with `foodStock = 0` and no affordable food loses health `−8/day`. Health < 1 → death (`life.death`, cause `starvation`).

**Decision function.** Each citizen scores a small action set and picks with bounded rationality:

```
U(a) = w_income·I(a) + w_needs·N(a) + w_social·S(a) − w_risk·R(a) − w_cost·C(a)
pick a with probability ∝ 2^(U(a)/T)          T = 20 default, 35 for "curious"/"rebellious"
```

(2^x is computed with a 1024-entry integer table; no `Math.exp`.)

Action set (v1): `work`, `seek_job`, `buy_food`, `rest`, `socialize`, `study`, `start_business`, `invest_in_business`, `migrate`, `apply_to_lab`. Each action has a fixed effect table and a cost in cents and/or hours. `R(a)` is scaled by beliefs: `R(start_business) × (1 + strength("business_is_risky")/100)`.

**Memories → beliefs.** When an event with `importance ≥ 4` touches a citizen or someone in their `relationships`, append a Memory. Each night, a belief rule table turns memories into belief strength changes (e.g. memory `econ.business_closed` about a friend → `business_is_risky += 15`). Beliefs decay 1/day toward 50. This is deliberately simple; it produces the farmer-who-won't-open-a-shop behaviour without a planner.

**Goals.** Once every 30 days a citizen re-evaluates `goal` from a weighted table of traits × current state (wealth, employment, skills). Goals bias `U` by +15 toward their matching action.

## 3. Economy

Four goods flow: `food` (farms), `materials` (workshops from ore; factories refine), `energy` (power plant from coal), services (clinic, lab, market staff). Money is conserved; the only mint/burn is explicit (`policy.stimulus` creates money through the treasury and logs it).

**Produce.** For each business: `output = baseOutput × workers × productivity`, where
`productivity = (0.5 + avg_skill/200) × (1 + automation/100) × conditionFactor × resourceFactor`.
Farms: `resourceFactor = moisture/255` averaged over the farm's 3×3 tiles; a drought is therefore felt through *this line only*. Inputs are consumed per unit; if inputs are short, output is capped and an `econ.input_shortage` event fires with `causes` pointing at the market.

**Pay wages.** Each business pays `wage × workers` from cash; if cash is insufficient it pays what it can and lowers `wage` 5% (`econ.wage_cut`). Workers whose wage drops below the food price × 2 start scoring `seek_job` higher the next day.

**Trade.** One clearing per market per good per day (no order book):
- demand = Σ citizen food purchases (1 unit if `foodStock < 3` and affordable) + Σ business input demand
- supply = Σ business inventory offered (everything above 7 days of their own input needs)
- cleared = min(demand, supply), proportional rationing, at today's price
- `price_{t+1} = price_t × (1 + 0.08 × (demand − supply) / max(supply, 1))`, clamped to ±15 %/day and to [10 % … 1000 %] of the day-0 price
- Between settlements with `relations = "trade"`, 20 % of a surplus can move to the other market at +10 % price (merchants earn the spread). Embargo = 0 %.

**Tax & spend.** Treasury receives `taxRate % × wages paid`. Treasury pays `researchBudget` to funded labs, `healthBudget` to clinics, and buys food into `market.reserve` up to `foodReserveDays`. If treasury < 0 for 10 days, legitimacy −2/day and the ruler agent cuts budgets (phase 5).

**Business life-cycle.** `profit30` rolling. `profit30 < −(30 × wage)` for 30 days → closure (`econ.business_closed`, employees → unemployed, memories written). `profit30 > 60 × wage` and cash > upgrade cost → `building.tier++` and `baseOutput × 1.15`. A citizen with goal `start_business`, wealth ≥ startup cost, and a free lot opens one (`econ.business_opened`).

## 4. Civilization

**Ruler agent.** The ruler is a citizen with weights like anyone else, but their action set is policy moves, re-evaluated every 7 days: adjust each policy by ±1 step toward a target computed from (legitimacy, treasury, unrest, foodDaysReserve, machineAutonomyRisk, traits). An `ambitious` technocrat ruler funds labs; a `cautious` one raises oversight when risk > 40 — *if the risk is visible to them*, which is a function of the project's `secret` flag and whether an engineer has reported (story event).

**Research.** Funded project: `progress += (lead.science/100) × (1 + staff/4) × 2` per day. Safety work: `safety += oversight/50` per day. `machineAutonomyRisk += Δprogress × (1 − safety/100) × (centralization)`, where centralization = share of settlements on one power plant / one automated factory network. Oversight policy ≥ 60 adds `−1/day` to risk.

**Unrest & legitimacy.** `unrest = clamp(0.4×unemployment + 0.3×(100−avg food need) + 0.3×(priceIndex−1000)/20 − legitimacy/4)`. Unrest > 70 for 20 days → `civ.riot` event: a random business is damaged and the ruler's legitimacy −10.

**Migration.** A citizen with goal `migrate`, or needs average < 30 for 15 days, moves to the settlement with the best (wage − food price) if a house has capacity; otherwise becomes homeless there (shelter decay). This is how a drought in one valley becomes a housing crisis in the next.

## 5. Story scheduler

See docs/05. In one line: for each not-yet-fired, not-cancelled StoryEvent, if `day ∈ [earliest, latest]` and all `required` conditions hold and no `blockedBy` holds, fire with `probability` from the `story` stream; emit its effects, clues and follow-ups.

## 6. Record & invariants (dev builds and tests)

Checked after every step:
- Σ(citizen.wealth) + Σ(business.cash) + Σ(civ.treasury) = initialMoney + minted − burned
- all inventories ≥ 0; all needs/health in 0..100
- every alive citizen has a settlement; every employee's workplace is alive
- `hashState(state)` recorded in metrics for determinism tests

## M1 status

Implemented: phase 1 (day, season) and phase 7 (metrics: population, unemployment, Gini, wellbeing, health, treasury, risk, infected). Everything else returns 0 and is labelled so in `metrics.ts`. Measured: 545 days of the M1 step for 30 citizens in ~30 ms headless (vitest, Node 20) — meaningless until phases 2–5 exist, recorded only as the baseline.

## Performance budget

| Population | step() target | 545 days (Oracle) |
|---|---|---|
| 30 | < 0.4 ms | < 0.25 s |
| 150 | < 2 ms | < 1.2 s |
| 500 | < 8 ms | < 5 s (Oracle shows progress bar) |

The citizen decision phase dominates; it is O(citizens × |actions|) with no pathfinding (itineraries are building ids; the renderer draws the walk).

---

## M2 as built (2026-10-21) — what differs from the design above

The structure held; the constants and several rules changed once the 200-seed harness ran. These are the rules that exist in code now (`src/sim/systems/*`), listed where they differ from the text above:

**Decisions (`citizens.ts`).** Action set is `work, seek_job, rest, socialize, study, start_business`; buying food/energy/goods is a household routine inside the market phase, not an action. `U(a) = (w·I + w·N + w·S − w·R − w·C)/100 + goal bias`, softmax with `2^((U−Umax)/T)`, `T = 14` (24 for curious/rebellious). Work gives +4 belonging ("colleagues count as company"), socialize +40. `start_business` is only considered when some good trades at ≥ 1.3× base (or the goal is to start one). An employed citizen looks for a job only when the wage is under 2× the food price or the employer is ≥ 3 days behind on payroll.

**Market (`economy.ts`).** One clearing per good per day with proportional floor-rationing; the settlement's market business is the escrow and keeps an 8 % fee; the treasury takes a 5 % sales tax from the pool; a public reserve (stock liquidated from closed businesses) sells into the market for the treasury. **Supply response:** when a good trades under 90 % of base, each producer offers only ~90 % of its share of yesterday's cleared quantity, so a glut shrinks instead of bankrupting everyone. **Demand elasticity:** households stock up to +3 when food is under 70 % of base, stretch −2 when over 150 %; energy and discretionary goods are bought only up to 2× base, and comfortable households buy more of both. Price moves `k = 0.08`, clamped ±15 %/day and to 30–500 % of base; price-spike events have 30-day hysteresis. Food spoils 3 %/day in business stock.

**Firms.** `profit30` is a rolling ~30-day sum (`p + daily − p/30`), not a mean. Layoffs: 30-day loss worse than 10 wages *and* cash under 10 days of payroll, one worker per 30 days, never the owner. Closure: 15 consecutive days unable to meet payroll (public clinic/lab exempt). Upgrade: `profit30 > 20 wages`, cash ≥ cost + 30 wages, fully staffed, 60-day cooldown; the permit is a capital expense, not an operating cost (counting it caused upgrade-then-layoff churn). Wages: −5 % every 10 insolvent days down to 2× food price; +3 % every 10 days while hiring. **Dividends:** a private firm with more than 60 days of payroll pays half the excess to its owner every 10 days — this is what recycles profit into household demand, and also why Gini rises to ~0.7. Private firms are owned by their first employee at worldgen; clinic and lab are public. Buildings wear 1 condition/10 days; firms buy a unit of materials to repair below 90.

**Public money.** Income tax 20 % of wages, sales tax 5 %. The treasury pays the research and health budgets to lab and clinic (which cover their payroll), an official's wage, pensions, and a **means-tested welfare** payment to anyone with under ten days of food money (not only the unemployed — unpaid workers at insolvent firms starved before this). The clinic also charges a $3 fee to treat up to 6 patients per working doctor. **Fiscal rule** (`civ.ts`): with under 15 days of spending in hand, every budget is cut 10 % every 10 days down to 60 % of its Day-0 value and legitimacy drops a point; with over 120 days in hand, cuts reverse.

**Environment.** Drought dries river-fed land (within 2 tiles of a river, stored as `terrain.riverNear`) 1 point/day and other land 3/day; recovery toward `baseMoisture` is 4/day river-fed, `2 × rainfall/50` elsewhere. Farm output scales by `0.25 + 0.75 × moisture`.

**Harness numbers (200 seeds, 545 days, continent, Day-0 settings):** deaths in 0 % of seeds; unemployment averages 8–9 %; food ends within ±5 % of base; Gini ≈ 0.74; wellbeing ≈ 99 (the baseline world is calm — stress comes from interventions and, later, story chains); ~7 upgrades and ~3 new businesses per run; 61 ms per 545-day run in Node.

## M4 as built (2026-10-22) — civilizations, war, research, missions

**Phase order now:** 0 interventions · 1 environment · 2 needs · 3 decide · 4 economy · **4b research** (`research.ts`) · 5 civ (unrest, riots, fiscal rule) · **5a ruler** (`ruler.ts`: succession, conscription, budgets, taxes, research focus) · **5b war** (`war.ts`: diplomacy, declarations, raids, peace, conquest) · **6 missions & procedural events** (`missions.ts`) · 2b beliefs · 7 metrics · 8 terminal checks. Research and the ruler use no RNG; war draws from `civ`, missions and procedural events from `story`.

**Scale.** Defaults are three civilizations of 100 on a 128×128 map; each civilization has one settlement, a disposition (agrarian / scholarly / martial — a three-civ world has one of each), a ruler citizen, and a plan of buildings scaled by population (farms ≈ pop/12, workshops ≈ pop/40, one market per 60, clinic, lab, power plant, barracks, town hall, houses for everyone). Sites are chosen on a 17×17 buildable window at least `max(22, size/4)` tiles apart.

**Economy changes that the jump from 30 to 100 people forced.** Farm output 12/worker-day (was 11) with farms sized to the population rather than a glut; workshops 4/worker-day; the power plant is a public utility (its dividends were two-thirds of all money in the world); public businesses return cash above 30 days of payroll to the treasury every 10 days; a 1 % **wealth tax** every 10 days on savings above 100 days of food; the unemployed **forage** half a unit of food a day; the **granary** (public food reserve) buys 2 %/day toward `foodReserveDays × population` while food is under 130 % of base and the treasury holds 30 days of spending, sells into markets at ≥ 150 % of base, and otherwise only trickles out a surplus above target — it never dumps on the farmers (that dumping, after loot, once closed every farm in a town). Price floor 50 % of base. Income tax follows the books: +5 points every 10 days under 30 days of spending in hand (to 40 %), −5 over 200. The old-age mortality is `0.00005 × (age − 60)` per day past sixty.

**Research.** Each lab produces `Σ(scientists' science skill) / 40 × (1 + 0.25 × (tier − 1))` points a day (half if unpowered; automation work ×(1 − oversight/200)). The civ's `researchFocus` field gains a level when the pool reaches `20 + level`. Effects: farm output ×(1 + (agriculture − 30)/200), workshop/plant output likewise from industry, soldier strength ×(1 + military/100). Automation ≥ 50 reaches the floor: workshops and factories gain automation (one post removed per 25 points) and `machineAutonomyRisk` grows `(automation − 45)/5 − oversight/25` every 10 days; `research.loss_of_control` fires at 85.

**War.** Attitude −100..100 per pair. Peacetime drift every 5 days toward a rest point (agrarian +25, scholarly +15, martial −40, +20 for a cautious ruler, −10 for an ambitious one, +10 when legitimacy < 50); a martial civ outgunning a neighbour by 1.5× / 2.5× loses 2 / 3 more. Declaration when attitude ≤ −50 (−65 cautious, −42 ambitious), legitimacy ≥ 40, ≥ 3 soldiers, strength ≥ 0.8× the target's, one war at a time, 25 % per 5 days once eligible. Strength = Σ (40 + combat) × (1 + military/100); defenders ×1.5 at home, a town with no soldiers fields a militia of 6 per adult. Only a side with ≥ 1.2× the other's strength marches; raids every 15 days; the loser loses up to 20 % of its soldiers scaled by how badly it lost; a won raid loots 25 % of the granary and damages 1–2 buildings (−35 condition; a ruin at 0). Wars end when both attitudes recover above −20 (weariness +2 per 5 days plus 1 per 20 days of war) or one side has had no soldiers for 70 days; peace sets attitudes to ≥ 0 and a 150-day ceasefire. **Conquest:** a town with ≤ 1 soldier that loses its fourth raid in a row changes civ; a civ with no towns dies and its treasury passes to the conqueror.

**Rulers.** One per civ (occupation `ruler`, stipend 2× the official wage). On death: an official succeeds, else the most ambitious well-connected adult; legitimacy −20 (−30 after an assassination); the civ's wars pause with a ceasefire; if legitimacy < 35 the succession is a **coup**: the civ becomes a martial autocracy. Every 10 days the ruler moves budgets 10 % within 0.6–2× of base; under threat (a hostile, stronger neighbour at ≤ −30) or at war the military budget rises 25 %/10 days up to a cap by disposition (martial 2×/3×, agrarian 2×/2.5×, scholarly 1.5×/2×) while 20 days of spending remain; the barracks' headcount target is `militaryBudget / wage`, capped at a quarter of the town's adults, filled by hiring or, under threat, by **conscription** (one a day per 10 days: the unemployed, then workers, then the least skilled farmers, never below three farmers per ten mouths).

**Missions.** From day 15, then every 40–50 days while none is open: the candidate list (`candidateMissions`) is built from the present state — a lab lead where automation ≥ 40 (remove / oversight law / raze the lab at ≥ 60), a martial ruler turning on a neighbour (depose / raze its largest farm), a civ at war (raze its barracks; broker peace after 10 days), a civ outgunned 1.3× by a hostile neighbour (arm: build a barracks or double the base military budget), a town with food ≥ 125 % of base or in drought (stock the granary to 30 days), a civ with average health < 70 (double the health budget). Templates offered in the last 120 days are skipped; one is drawn with the `story` stream; it stays open 20 days. Accepting applies the listed interventions that day; declining or letting it lapse applies nothing. The Worker pauses on an offer and replays both answers 90 days ahead (`forecast`) — a product of the Worker, not of state, so replay never needs it.

**Procedural events** (`story` stream, per settlement per day): fire 1/300 (−40 condition on a non-farm building), bumper harvest 1/150 (+30 food at a farm), wandering trader 1/200 (+15 materials, +10 energy to the granary), bandits 1/400 (repelled if the civ has soldiers; otherwise 20 % of the granary and fear 40), and a festival every 120 days (+20 belonging).

**Harness numbers (40 seeds, three civs of 100, no player):** 0 starvation; ~12 battle deaths and ~9 old-age deaths per run; 1.9 wars, 12 raids, conquest in ~8 %; automation 65 and machine risk ~55 in the scholarly civ by Day 545; Machine Dominion ~22 %, The Scorched Border ~8 %, the rest fallback; ~11 missions offered; 0.6 s per 545-day run in Node. With a scripted player accepting every offer: 0 Machine Dominion, 2.8 battle deaths, 1.1 wars; accepting only the non-violent offers: 0 Machine Dominion, 11 battle deaths, 2.1 wars (`tools/missions-harness.ts`).

## M6 as built (2026-10-22) — disease, droughts, migration

**Phase order now:** … 2 needs · **2a health** (`health.ts`) · **2c migration** (`migration.ts`) · 3 decide (the sick rest) · … The `health` RNG stream is used by the disease and by old age; migration draws from `citizens`.

**Disease.** none → incubating (7 days, contagious at half weight, still out and about) → sick (14 days, at home, contagious at full weight) → recovered (immune, −10 health) or dead. Daily infection for a susceptible person: `0.01 × Σ over the buildings on their itinerary of min(3, infectious weight there) × (1 − 0.5 × clinic coverage) × crowding`, capped at 0.4; coverage = working doctors × 10 / sick in the town. Death at the end of the sick phase: `0.18 + (100 − health)/400 − 0.10 × coverage`, halved once the civ's `rp.cure` has fired, floor 0.01. Between towns: a town with incubating merchants infects one random person a day in each other town with probability 0.02 per merchant, unless either side is quarantined or they are at war. Rulers raise the health budget 15 %/10 days (to 2.5×) while ≥ 5 % are sick, close the gates at 15 %, reopen under 2 % (never a quarantine the player decreed), and the clinic hires one doctor per $12/day of budget.

**Droughts.** The gd chain (agrarian civs only, `disasters ≥ low`): dry spring (−10 rainfall) → first drought (50 days) → hoarding (food ×1.3 once ≥ 140 % of base) → second drought (100 days, −20 rainfall; blocked by irrigation) → irrigation (agriculture ≥ 60, or a warehouse and 30 days in the granary: farms keep ≥ 75 % of their crop) / abandonment (food ≥ 250 % and an empty granary). Drought drying is now 3/day on river-fed land and 8/day elsewhere. A **warehouse** doubles the granary's target and fill rate.

**Migration.** A working-age adult hungry three days running in a town where food is ≥ 2× base leaves (15 %/day) for the town with the cheapest food among those not at war with theirs and not quarantined, if it is under 60 % of the price at home; they arrive jobless and take a free bed or none. `civ.migrantsIn/Out` count them.

**Settings.** `disasters: off | low | normal | chaotic` is copied into `story.disasters`; `off` disables the rp and gd chains (the regression tests use it).

**Harness (40 seeds, three civs of 100, disasters normal):** plague in ~65 % of worlds (≈ 20 deaths each, 5–13 %); the drought chain in ~70 %, starvation in 13 % of worlds, ~4 migrants per run; endings — hard 27 %, fragile 27 %, Red Plague 17 %, Great Drought 10 %, Scorched Border 8 %, Machine Dominion 8 %, Green Compact 3 %. Scripted "peaceful" player (quarantine, fund the clinic, stock, warehouse, irrigate): The Last Cure 6/16, Green Compact 7/16, Red Plague 2/16.

## M7 as built (2026-10-22) — society, trade, colonies, gates

- **Phase order now:** 0 interventions · 1 environment · 2 needs · 2a health · 2c migration · **2d society** · 3 decide · 4 economy · **4c trade** · 4b research · 5 civ · 5a ruler · 5b war · **5c colonies** · 6 missions · 6b story · 6c Influence regen · 2b beliefs · 7 metrics · 8 terminal checks.
- **Society (`systems/society.ts`, stream `citizens`).** Every ten days two single adults (18–55) under one roof with affinity ≥ 25 become partners (30 % per check; mirrored `partner` ids). A partnered couple of child-bearing age (≤ 45) with a roof that has one spare bed, four days of food between them, nobody hungry or sick, and bread under double its base price has a 1/250 daily chance of a child: a citizen like any other (name, traits inherited half the time, two `family` relationships, a week of the pantry). Children come of age at 16 on the anniversary day and look for work. `household(c)` = partner under the same roof + children under the same roof; `relocateHousehold` moves them together, jobless, to the first bed that fits them all (else any bed, else the street) and counts them once per civ tally when nations differ.
- **Migration** now moves households (M6 moved individuals) and honours `borders`: a civ with its gate shut turns the hungry away (`civ.turned_away`, tallied every ten days).
- **Colonies (`expansionPhase`, stream `civ`).** Every ten days a civ with no war, a treasury ≥ 1.5 × the colony cost ($4,000), under three towns, no colony in the last 150 days and a *crowded* first town (≥ 3 homeless, or grown by five with under three beds free) founds one with 35 % probability at a site 16–34 tiles away chosen by `chooseColonySite` (land, water nearby, clear of other towns). The colony claims a 5-tile circle, gets a market, two farms and three houses placed by `findFootprint`, the treasury pays $4,000 of which $1,600 capitalises the businesses, and the homeless and jobless of the parent move in with their households up to the beds built (12). The chain `co` and the player (`found_colony`, 10 ◆) found colonies the same way.
- **Trade (`systems/trade.ts`, stream `market`).** Two towns may trade when they are the same civ, or two civs whose `relations` are both `trade` (attitude ≥ 15) and not at war, and neither is quarantined. Each day, for each importing town with a working market and each good, when the home price is ≥ 1.25 × the exporter's, the market buys up to 15 % of the exporter's producer stock (per producer, in id order) at the exporter's price from its own cash (keeping ten days of wages), at most one caravan per route and good every four days. The caravan takes `distance / 10` days; on arrival the goods join the market's inventory (sold like any producer's), a 10 % tariff on their destination value goes to the destination treasury, and the merchants' trade skill creeps up. A caravan from a town whose merchants are incubating the fever can carry it (10 % per sick merchant). Books balance: cargo in flight is counted by the invariant.
- **Gates (`ruler.ts`).** Three 0/100 policies the ruler toggles: `quarantine` (M6), `borders` (shut when ≥ 4 homeless or ≥ 35 % idle and migrants have come; reopened when nobody is outside and idle < 15 %), `exportBan` (set when bread in any of its towns is ≥ 125 % of base; lifted below 105 %; blocks food caravans to other civs, not to its own colonies, not cloth or coal). A player decree on any of the three writes `policyLock[key] = day + 120`; a locked gate is the player's for a season. `closedDays` counts every day a civ's borders are shut (The Iron Council).
- **Metrics** gain `births`, `trade` (units arrived) and `caravans` (on the road).
- **Chains.** `co` (No room at the inn → The surveyors → The founding [effect: found a colony] → The first winter / A town of its own) and `ex` (Talk of the road → The first families → Shut gates → Empty streets). New conditions: `crowded`, `othersClosed`, `colonyPop`, and `civ` paths `migrantsIn/Out`, `births`, `settlements.length`; new effect `civ.colony.found`; placeholders `{colony}` and `{migrantsOut}`.
- **Foraging** yields a quarter of its usual half-unit in a drought (the commons dry too).
- **Plague retune.** Local hiring (jobs are where you live — colonies made this necessary) removed the cross-town commuting that had been the fever's main road, so the Red Plague vanished from the baseline; merchants now carry it at 5 % per incubating merchant per day, caravans at 10 % per sick merchant, the base death rate is 22 % (was 18 %), and Red Plague needs 8 % of the world dead of it (was 10 %).

## M8 as built (2026-10-23) — small engine changes

- **Roads** (`worldgen/roads.ts`) are laid at worldgen and in `foundColony`; `trade.tripLength` uses the road's length for caravan days. Pure, no RNG; `s.roads` is part of the hashed state.
- **Deep drought.** Once a drought has run fifty days the un-irrigated crop floor falls from a quarter to 0.15 (`economy/index.ts` `productivity`); an irrigated civilization keeps three quarters. Over 40 seeds this raised starvation worlds from 8 % to 18 % and brought the Great Drought back to 2/40; a floor of 0.10 was tried and starved 25 % of worlds (72–79 dead in two of them) — too much.
- **Ending precedence.** When the second drought is on the record, Great Drought scores +30 and the exodus it caused −35, so the cause headlines and the consequence is secondary.
- **Migration events** carry `fromCiv`/`toCiv` at the time of the move (a town's civ can change by conquest later).
- **`economy.ts` → `economy/`** (`index` phase + production + wages + public payments + itineraries, `market` clearing, `lifecycle` hiring/closures/founding, `books` the day's revenue and cost). **`chains.ts` → `chains/{md,bb,rp,gd,co,ex}.ts`** data with the DSL kept in `chains.ts`. **`workers/frame.ts`** builds WorldInfo and RenderFrame from a state plus what the main thread knows.
