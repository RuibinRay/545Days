# 09 — Release checklist (M9, 2026-10-23)

What a release of 545 DAYS needs, what this build does for each item, and what only a real deploy can do.

## Build and deploy
- [x] `npm run typecheck`, `npm test` (208), `npm run build` pass; `.github/workflows/pages.yml` runs all three and deploys `dist/` to GitHub Pages on a push to `main`.
- [x] Base path `/545Days/` in `vite.config.ts`, the font preloads in `index.html` and the `@font-face` URLs in `styles.css`. **Change all three together if the repository is renamed.**
- [x] Hash router: deep links (`#/world?seed=…`) work without a 404 rewrite.
- [ ] Push to a repository with Pages enabled (Settings → Pages → Source: GitHub Actions). Not done from this build: nothing is pushed on the owner's behalf.
- [ ] After the first deploy, open the site on a phone and a laptop and use World tab → "Copy performance report" on each; paste the reports into `PROJECT_REVIEWS.md`. These are the field numbers the design asked for.

## Quality gates met in the lab (headless Chromium, SwiftShader, 2 cores)
- axe-core (WCAG 2.0 A/AA, 2.2 AA, best practices): **0 violations** on the home page, the world page at day 0, the world page after 100 days with the World tab open, and the world page at a phone viewport.
- Lighthouse 12, mobile preset, 4× CPU throttle: home **93 / 100 / 100**, world **61 / 100 / 100** (performance / accessibility / best practices); **CLS 0 on both**. The world page's performance score is the software-GL terrain bake under throttle (TBT 4.7 s); unthrottled the bake is 0.4–0.6 s and the first frame 0.66 s.
- In-page `web-vitals` over a 40-second session with offers, declines and tab changes: CLS **0.007** desktop, **0.016** phone (was 0.46 / 0.76 before the HUD became a fixed grid and the Oracle stopped yanking the panel).
- Phone (iPhone 12 viewport): no horizontal overflow; the map keeps ≥ 42 vh; one target under 24 px (the timeline thumb — a range input, native).
- No console errors in any headless run.

## Known limits to state in release notes
- Field Core Web Vitals and real-GPU fps are not measured yet (no device here); the page measures itself and can copy a report.
- Screen readers: structure audited by axe; not tested with a real reader.
- All art is procedural pixel art; sound is five synthesized cues.
- Saves live in the browser's IndexedDB; an export file is the only way to move a world between browsers.
- Three civilizations of 100 is the balanced size; larger worlds run but were not tuned.

## Licences
- Instrument Sans — SIL Open Font License 1.1 (`public/fonts/LICENSE-InstrumentSans.txt`).
- PixiJS, React, Recharts, web-vitals — MIT (see `package.json`).
- Game code and art: the owner's; add a `LICENSE` file before publishing the repository.
