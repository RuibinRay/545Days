# DESIGN_MISTAKES — recurring problems, root causes, prevention

Format: **Symptom** → root cause → prevention. Add any bug that costs > 2 hours.

## From ruibinray.github.io

- **Homepage "frozen" on the owner's device** → Reduce Motion enabled, no calm mode → ship a calm mode and a `?why` diagnostic from day one.
- **Scroll zoom stopped after calm mode** → the calm mode also froze the camera → when adding a degraded mode, list every subsystem it touches and test each separately.
- **Chrome fetched every gallery photo on load** → `src` set before `loading="lazy"` → attribute order matters; lint for it.
- **Duplicate photos appeared** → prepared photos also in an auto-discovered folder → one source of truth per asset type.
- **Template author's name leaked in a PDF** → metadata not scrubbed → scrub and verify metadata on every published file.
- **Stale JS after deploy** → cache-buster not bumped → use hashed filenames (Vite) instead of manual `?v=`.
- **Broken JS from a GitHub web edit** → straight apostrophe inside a single-quoted string → prefer typographic ’ in content strings; run a syntax check in CI.

## Anticipated for 545 DAYS (not yet hit — move to the section above only when they happen)

- Floating-point drift between Worker and main thread → no `Math.sin/exp/pow` in `sim/`, integer money → cross-context hash test from M3.
- Iterating a `Map`/`Set` in the engine in an order that depends on history → arrays by id, sort derived lists.
- Memories growing without bound → cap at 24 per citizen (docs/02).
- Endings that never or always fire → batch harness over 200 seeds with a 5–40 % band (docs/05 §fairness).
- A story effect writing money without a ledger entry → effects reuse the economy's transfer function; invariant checks in dev builds.

## Hit during 545 DAYS M1 (2026-10-21)

- **Rivers drew as disconnected dots/crosses** → river tracing moved diagonally but the river autotile only knows N/E/S/W → generate data with the same connectivity the art can draw (now 4-connected); keep a "render a world to PNG" script and look at it before wiring the renderer.
- **Day/night and citizen walks lagged the day counter at low fps** → Pixi's ticker clamps `deltaMS` at 100 ms, so summing deltas undercounts time → derive intra-day phase from `performance.now() - frameArrivedAt`, never from accumulated deltas.
- **Some seeds left citizens homeless** → fixed house count of 8 didn't survive cramped sites → derive counts from population and widen the search radius for houses.
- **Rivers pooled into lakes when allowed to wander freely** → "don't move away from the sea" is too weak a constraint on flat terrain → weight seaward progress heavily (`(Δdist+1)×12`) and add a small deterministic wiggle instead.

## Hit during 545 DAYS M2 (2026-10-21) — economy tuning

- **Everyone starved by day 60** → only ~40 % of workers chose "work"; rest and socialize scored too close → the work utility must dominate for the employed (temperature 14, work also meets the belonging need).
- **A food glut bankrupted the farms** → inelastic demand + fixed output → price at the floor → payroll impossible → producers now withhold stock when the price is weak, and food spoils so hoarding has a cost.
- **Layoff/rehire churn every 7 days** → a tiny negative 30-day profit triggered layoffs → real-loss threshold plus a 30-day cooldown.
- **Upgrade, then layoff the next day** → the permit counted as an operating cost → treat capital spending separately from operating profit.
- **Treasury emptied, then the unemployed starved** → a 30-person tax base cannot carry a 9-person public sector at private-sector wages → smaller public payroll, sales tax, fees, and a fiscal rule; "balance the budget first, then tune everything else".
- **Profit trapped in firms** → no owners, no dividends → dead money and no household demand → ownership + dividends (and, as a side effect, high inequality).
- **Employed people starved** → unpaid workers at insolvent firms were "employed" and so got no welfare and never looked elsewhere → means-tested welfare; job search when payroll slips.
- **`profit30` was a mean, thresholds assumed a sum** → naming a variable after a window is not the same as computing one; write the formula in the comment.
- **Drought was all-or-nothing** → farms next to rivers were immune, other land went to zero → two drying rates, faster recovery, and a quarter-crop floor.
- **Module-level caches in the engine** (`BASE_POLICIES`, `unrestStreak`) leaked between seeds in the harness → everything the step needs persists in `WorldState`, no exceptions.

## Hit during 545 DAYS M3 (2026-10-21) — replay, saves, endings

- **The fork select was empty** → snapshot days were sent once, in the initial `world` message, and the UI that needed them mounted later → anything the UI may need at any time belongs in every frame (or behind a request), not in a one-shot handshake.
- **Raw event JSON in the HUD ticker** → a new engine event type without a sentence in `eventText` → the `default` branch should fail a test, not render; add the sentence in the same commit as the event.
- **"a engineer"** in generated prose → article choice by first letter; a tiny tell that text is templated → every generated sentence needs a grammar helper or a fixture test that reads it.
- **Side panel scrolled sideways** → long unbreakable cause ids in a `1fr` grid column → `minmax(0, 1fr)` plus `overflow-wrap: anywhere` on any column that holds machine-generated text.
- **Extinction test setup took three tries** → the engine's stabilisers (welfare, job search, dividends) kept the town alive even with health 5 → when a test needs a degenerate world, zero every stock *and* every flow, and say so in the test name.
- **`fromPortable` needed an `unknown` cast** → the portable format is a parallel type, not a cast target; give it its own interface next time instead of casting through `unknown`.

## Hit during 545 DAYS M4 (2026-10-22) — scaling to 300 citizens and three factions

- **155 of 300 starved at first run** → the M2 supply response cut each producer's offer to 90 % of *yesterday's cleared quantity*, a geometric decay to zero whenever the price dipped → base the response on what buyers *wanted*, never below 95 % of it.
- **Public sector unaffordable at 100 people** → pensions, welfare, officials, research and military scaled with population while the tax base did not → fiscal floor 30 % under 5 days of cash, income tax that follows the books, cheaper pensions/welfare, foraging for the unemployed.
- **Three owners held two-thirds of all money** → the power plant was a private monopoly paying dividends → public utility; public firms return surplus to the treasury; a 1 % wealth tax every 10 days above 100 days of food. Trace the richest citizen's ledger before guessing.
- **Farms sized by a constant, not by mouths** → first a 2.5× glut (farmers unpaid), then at output 4 a total famine, then thin margins that any shock tipped → farms ≈ population/12 with output 12, a 1.6–1.9× margin, and farms first in the plan so small towns staff their fields before their lab.
- **Conscription ate the farmers** → arming to 4× base pulled a quarter of the workforce into barracks → caps by disposition, one conscript per 10 days, never below three farmers per ten mouths, army ≤ a quarter of adults.
- **Loot dumped on the farmers** → the granary sold any surplus above target at any price, so a raided town's reserve (and the attacker's loot) crashed food to the floor and closed every farm → the granary sells only when food is dear or trickles 2 %/day of a surplus at ≥ base.
- **Wars like clockwork, conquest in 46 % of worlds, then 7 %** → every martial civ hit −50 on day ~60 and re-declared every ceasefire → ruler temperament sets the threshold and the rest point, one war at a time, a 25 %/5-day roll, ambition only at 1.5×/2.5× strength, defenders arm by disposition. Variety comes from personality and seeds, not from constants.
- **An offered mission could not be executed** ("no room for a barracks") → validate every mission's preconditions with the same function the intervention uses, at offer time.
- **A doubled budget doubled again** → `set_policy` wrote base *and* current, then the threat rule multiplied the new base → missions act on base policies; caps are expressed against base and population.
- **Fallback "hard" fired on every world** once old-age deaths existed → count the deaths that mean something (not "old age") and scale thresholds by population.
- **Succession fired every day** when no successor existed → retry a failed succession monthly, not daily.

## Hit during 545 DAYS M5 (2026-10-22)

- **Assassination was a peace button** → removing a ruler dropped legitimacy below the war threshold and paused wars, so accept-all produced the calmest worlds → the reprisal chain rallies legitimacy (+15), hardens attitudes and cuts the ceasefire.
- **Influence costs changed nothing in the harness** → regen (1/day) outran mission cadence (40–50 days) → halve the regen and make direct powers draw on the same pool; note that cadence, not price, sets the real constraint.
- **Tests broke on costs** → every intervention test now needs Influence; a test fixture that sets `story.influence = 30` before acting is the pattern.
- **Rumor text leaked tag names** ("still talks about day 65: declared") → map memory tags to phrases before they reach prose; the events test covers event types, not memory tags.

## Hit during 545 DAYS M6 (2026-10-22)

- **The market was a superspreader** → risk scaled with everyone present; 275 sick at once by day 60 → cap the infectious contacts per place at three and let only the incubating go out.
- **The sick kept shopping** → `itineraries()` still routed bed-ridden people through the market → the health system must own the sick person's day, not the economy.
- **Droughts did nothing** → river-fed farms with a 1.9× food margin shrugged off 70 days → drying rates and durations tuned until a seed starves (then the granary and irrigation are worth something).
- **The ruler undid the player** → the 2 %-sick rule reopened a quarantine the player had decreed → a ruler changes only what it imposed (`policies`), never the player's `basePolicies`.
- **A comment swallowed a statement** → `// …` before `emit(...)` on the same line; the typecheck caught it, the test runner reported "no tests". Block comments inside one-liners.
- **Plague offers never came** → random draw among ten templates in a 100-day window → urgency.

## Hit during 545 DAYS M7 (2026-10-22)

- **A realism fix deleted an ending.** Making jobs local (people worked in other civs' towns before) removed the fever's only road between towns; Red Plague went 17 % → 0 %. Any change to who meets whom is an epidemiology change — rerun the ending table after it.
- **Trade quietly fixed the famine.** Caravans at attitude ≥ 10 cut starvation from 20 % to 3 % of worlds and the Great Drought to 1/40. Good economics, lost story. The band check (5–40 %) is what caught it; the answer was partly a threshold, partly a protectionist reflex, partly honesty in the review.
- **Static world info.** `WorldInfo` (names, towns, territory) was announced once; births and colonies produced "#312" names and unlabelled towns until frames carried deltas.
- **A counter inside a 10-day gate.** `closedDays++` sat in the ruler's ten-day block and counted a tenth of the days; The Iron Council never fired until the counter moved to the daily loop. Put tallies where the clock ticks.
- **Interventions only loaded with the world.** The timeline said "0 interventions" after two decrees and the achievements could not see direct powers; frames now carry `applied`.
- **Canvas-backed textures in headless Chromium.** A 128×128 canvas texture uploaded a strip of itself under SwiftShader; the overlay "did not render". Extracting the sprite's GPU pixels and diffing against the canvas found it in one step; byte-buffer sources fixed it. Pixel-diff screenshots against a no-overlay baseline before concluding a layer is invisible.
- **A test that inflates a treasury breaks the money invariant.** Book the gift (`moneyMinted`) or the strict run throws on the next day.
- **Seed-pinned tests go stale when the world changes.** The migration test's seed stopped migrating once trade fed it; pick the seed from the harness table, not from memory, and say why in the test.

## Hit during 545 DAYS M8 (2026-10-23)

- **A refactor script ate the data.** The first chains split matched `[` in the type annotation `StoryEvent[]` and sliced an empty array over the real one; the file was written before the assertion. Assert the parse *before* writing, and keep the last zip as the restore point (it was).
- **Comments break naive parsers.** A `// a day's walk` comment opened a string in the brace scanner. Skip `//` to end of line before tracking quotes.
- **Lazy baking moved the cost, Lighthouse still counted it.** Spreading the chunk bake over ticks cut first paint from seconds to 0.66 s, but TBT under 4× throttle rose because each software-GL chunk render is itself > 50 ms. Lab TBT on SwiftShader is not a GPU number; report both, fix what the user feels (first frame), and do not chase the lab metric past that.
- **The mobile panel moved the map.** `max-height` on a panel whose content changes daily is a layout shift every day. Fixed height on narrow screens.
- **`pkill` of the preview server killed the shell's compound command** (exit 144) and swallowed the heredoc after it; the "missing script" that followed was this, not a filesystem problem. Write scripts with the file tool, restart servers in their own command.
- **Roads changed caravan timings and the Great Drought vanished again.** Any change to trade speed shifts the ending table; the band check caught it; the real fix was the deep-drought floor, not the roads.
- **Seed-pinned expectations drifted a third time** (migration test). The pattern that held: assert the invariant (tallies agree with events), not the number.

## Hit during 545 DAYS M9 (2026-10-23)

- **The phone never had a map.** Every milestone's device check was a desktop viewport; at 390 px the HUD and the panel left the stage 56 px tall. Emulate a phone in the headless run from the first milestone, and assert the stage's height.
- **A flex HUD that wraps is a layout shift waiting for a long name.** The stats wrapped to a second row when a treasury got wide; CLS 0.46. Fixed grids with `minmax(0, 1fr)` and ellipsis; no wrapping in a HUD.
- **Auto-switching the panel to the Oracle tab was the second largest shift** and a UX smell: the player's view moved without the player. Light the button and the tab; leave the panel.
- **`font-display: swap` is a measured 0.145 shift** at the moment the font lands. `optional` plus a preload, or nothing.
- **`reportAllChanges` or no vitals.** A single-page app that never hides never reports LCP or CLS through `web-vitals`' defaults; the panel said "measuring…" forever.
- **`role="listbox"` with buttons inside is a nested-interactive violation on every item** (434 of them). A list of `aria-pressed` buttons says the same thing legally.
- **A heredoc after `pkill` never runs** (exit 144) — hit again; restart servers in their own command, write scripts with the file tool.

## Hit during 545 DAYS M10 (2026-10-23)

- **An ending written before it was measured.** The Digital Exodus was fully written with an epilogue before the harness showed no player could reach it. Run the scripted players first, write the prose second.
- **"Births stopped" was the generation ageing out.** The Silent Generation fired in 15 % of calm worlds because every Day-0 couple passes 45 by day 545. An ending about a cause must check that the cause, not the calendar, is responsible.
- **A combined-disaster ending ate both singles.** The Famine Fever on "deaths ≥ 10 % of either" took the Red Plague's and the Great Drought's worlds; requiring both killers gave them back.
- **Setting `width` on a canvas clears it.** The gallery drew nineteen scenes and then wiped them by setting the attribute after drawing.
