# 545 DAYS

A free, browser-based civilization god simulator. Every world is born with a possible future 545 simulated days away. The engine simulates it, shows you fragments, and resets to Day 0. You investigate, intervene, and find out what your world actually becomes.

**Status: M9 — release-ready in the lab.** Up to three civilizations of 100 with rulers, labs, barracks, diplomacy, war and conquest; families, births and households that move together; caravans on real roads with bridges over the rivers; grain bans, border gates and colonies; the Oracle's missions with a two-branch forecast and Day-0 visions; Influence and Knowledge; six story chains; a fever and droughts; eighteen designed endings, each with a drawn scene, plus the written-from-numbers epilogue; four tile variants per biome, foam, hats and coats; live overlays; achievements; sound cues (opt-in); a first-session guide. The page measures its own Core Web Vitals (World tab → Copy performance report), exports a world as a tiny replayable file or the chronicle as a Markdown record, passes axe-core with no violations on every screen tested, and keeps the map on screen on a phone. `docs/09-release.md` is the checklist for the deploy. Read `docs/01-architecture.md` first, then `PROJECT_REVIEWS.md` for what is verified and what is not.

## Layout

```
docs/            design package (01 architecture … 08 milestones)
src/sim/         pure simulation: types, rng, hash, ledger, metrics, invariants, engine, snapshot, worldgen/, systems/ (environment, citizens, economy, research, civ, ruler, war, missions), story/endings (resolver, three designed endings, fallback)
src/workers/     protocol + sim Worker (run, snapshots, peek, fork, save/load, export/import, mission forecasts)
src/render/      PixiJS renderer + still-tier canvas fallback + procedural placeholder art
src/app/         React UI: hash router, Home (create / continue / import), Game HUD, panels/ (Inspector, Civs, Missions, Chronicle + why, Analytics, Timeline, EndingScreen)
src/storage/     IndexedDB saves (worlds + summaries)
tests/           vitest
DESIGN_*.md, PROJECT_REVIEWS.md, CREATIVE_EXPERIMENTS.md   learning files (read at the start of every session)
```

## Commands

```
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run dev         # vite dev server; add ?why to the URL for the diagnostics panel
npm run build       # typecheck + production build to dist/
npx tsx tools/harness.ts 50 545 continent 3 100 -v   # tuning harness: seeds × days, terrain, civs, population
npx tsx tools/missions-harness.ts 24                  # scripted players: ignore / accept-all / peaceful
```

## Deploy

GitHub Pages via Actions at https://ruibinray.github.io/545Days/. `vite.config.ts` has `base: "/545Days/"` (also the font preloads in `index.html` and the `@font-face` URLs in `styles.css`) — change all three if the repo is renamed. The app uses a hash router so deep links work without a 404 rewrite.

## Rules that do not bend

1. `src/sim/` is pure: no DOM, no Pixi, no `Date.now()`, no `Math.random()`, no transcendental `Math.*`.
2. Money and goods are integers; money is conserved and every transfer is a ledger entry.
3. Nothing on screen that is not in state. The renderer reads frames, never computes.
4. AI narration (optional, bring-your-own-key) reads the event log and can never write state.
5. No placeholder controls. If a button exists, it changes state.
