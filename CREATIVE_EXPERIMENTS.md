# CREATIVE_EXPERIMENTS — hypotheses to test, not lessons

Each entry: the idea, what success looks like, how it will be measured. Promote to DESIGN_MEMORY only with evidence.

## 545 DAYS — open hypotheses (M0, 2026-10-21)

1. **Visions drawn from the engine's own map, palette-shifted, instead of illustrated art.** Success: ≥ 2 of 3 playtesters recognise the location of a vision on the live map by Day 100. Measure at M5 playtest.
2. **Citizen walks rendered from a 4-stop itinerary with no pathfinding.** Success: viewers describe the town as "alive" unprompted in ≥ 2 of 3 M2 reviews; no one calls the straight-line walks wrong.
3. **Building growth by tier (0–3) as the only "civilization develops" signal.** Success: a viewer can say which town is richer from the map alone at 1× zoom.
4. **"The future shifted" indicator without detail.** Hypothesis: a yes/no divergence signal creates more tension than a baseline-vs-actual chart. Measure: time-on-Future-panel and self-reported tension in M5 playtest; if players find it opaque, show the chart.
5. **Evidence board reveals chain shape only after ≥ 2 evidence clues.** Risk: players never reach 2 and feel nothing connects. Measure: fraction of M5 runs where the board shows a chain by Day 300.
6. **Night as a hue-shifted ramp of the day palette, not a black multiply.** Success: night remains readable at 1× on a phone outdoors (subjective, 3 devices). *M1 note: implemented as a 0x6b74b8 multiply (blue-shifted, ~45 % darkening); readable in the headless screenshot; device check pending.*
7. **Top-down rather than isometric** for a god game that wants terrain painting. Success: painting feels direct on touch; no depth-sort bugs at M1. *M1 note: rendered and inspected; no depth-sort code needed. Painting is not built yet, so still open.*
8. **HUD typography: a pixel bitmap font for in-world labels only, a humanist sans for panels.** Hypothesis: mixing the two reads as "game + instrument", not as inconsistency. Measure at M1 review.

## Parked (good ideas, wrong time)

- "Ask the World" natural-language questions over the event log (needs BYOK narration; M8+).
- Incarnate mode (an RPG inside the sim).
- Accelerated Evolution calendar for era progression.

## Proposed after M4 (2026-10-22)

- **Mission blowback as a chain.** An assassination spawns a `martyr` event with probability by legitimacy: the lab rebinds with a bigger grant, or the deposed king's heir declares a vendetta. Untested; the mission harness would measure it.
- **Vision fragments from the forecast.** The Oracle's two branches already contain notable events; render three of the "ignore" branch as cryptic cards (place, silhouette, a line) before showing numbers — the M4b cutscene, with no new simulation.
- **Soldiers on roads.** Itineraries are straight lines; a cheap BFS on land tiles between town halls, cached per pair, would make marches read as campaigns.
- **Conquest changes the town.** Repaint roofs to the conqueror's colour over ten days rather than at once; the renderer already keys textures by civ colour.
- **Household tiers from furniture, not money.** Tie house tier to materials bought (a visible, earned upgrade) instead of a wealth threshold.

## Proposed after M7 (2026-10-22)

- **Roads as a cached land path.** A BFS between every pair of towns over land tiles, cached per pair and redrawn when a colony is founded; carts and soldiers follow it, and the trade overlay draws the real road. Untested; the straight line is what ships.
- **A second wave to the colony.** Colonies freeze at twelve: let a civ send a second household wave when the colony has beds and its own market has stock, and let partners who were split by the move follow after 20 days. Hypothesis: "A town of its own" fires in ≥ 20 % of worlds with colonies.
- **Festival on founding day.** A one-day gathering sprite ring at the colony's market when it is founded and on each anniversary; cheap, and the map would show the town's birthday.
- **Overlay patterns, not only colour.** Hatching for export bans and dots for shut borders so the trade overlay works without colour; needed for WCAG anyway.
- **Headline by consequence, not score.** When two endings are eligible, prefer the one the player's interventions caused (count causes tagged `player.*` in the chain that led there), so a Chosen City the player opened a gate for is not outscored by a plague they could not stop.
- **Hiring reach.** Jobs are local now; a neighbouring colony within a day's walk could hire its parent's jobless at a commute cost, which would also give the fever a slow road back without restoring cross-civ commuting.

## Proposed after M8 (2026-10-23)

- **Bridges and fords.** Where a road crosses a river, bake a plank bridge sprite and slow carts on it; a flood story event could wash one out and reroute the road for a season.
- **Roads that wear.** Count caravans per road tile and widen the track art at thresholds (path → road → paved), so a trade map writes itself into the terrain.
- **Ambience by biome and hour.** A wind bed over mountains, water over the coast, market murmur in town, swapped by camera position and day phase — synthesized noise with filters, no files.
- **A guide that watches.** Skip a tip when the player has already done the thing (clicked a building, opened the Oracle tab) rather than when they clicked "Got it".
- **Scene split by layer.** `scene/terrain.ts`, `scene/citizens.ts`, `scene/overlays.ts`, `scene/caravans.ts` behind one `WorldRenderer` façade; the overlays' nearest-town pass could then move to a worker.
- **RUM for a static site.** `web-vitals` in the page posting to a free form endpoint, or a copy-to-clipboard "report my vitals" button for players to paste into an issue — field numbers without a server.

## Proposed after M9 (2026-10-23)

- **Epilogue art per family.** A full-width procedural scene behind each ending's first paragraph — dry fields for the drought, a lit road for the Merchant Road — drawn with the same tile functions at a larger scale.
- **The record with pictures.** Embed a still of the map at the ending into the Markdown export as a data URI, and one per intervention day.
- **A phone HUD in one row.** Day, speed and the Oracle button only; stats on tap. The empty row beside "Hide panel" says the current compromise is not the design.
- **A vitals endpoint.** A GitHub Issue template pre-filled from the report (`issues/new?body=…`) so a tap on a phone files the field numbers.
- **Ford vs bridge.** A shallow river tile could stay a ford (carts slow, no sprite) and only deep rivers get a bridge; floods wash bridges out.

## Proposed after M10 (2026-10-23)

- **Scenes from the actual world.** Draw the epilogue from the real ending state: the player's own towns, the roads laid, the buildings standing or ruined, the people tinted by their infection — a still of the map composed for the family rather than a stock vignette.
- **Alt text written by the resolver.** Each ending returns one sentence describing its scene for screen readers and the record.
- **The Loop.** Pass the baseline's fired set into the resolver; fire when the player's interventions changed nothing on the record.
- **Displacement.** Let automation lay off a share of staff on upgrade and let the jobless migrate for work (cheapest-unemployment town), which would make The Digital Exodus reachable and give the technophile player a second ending.
