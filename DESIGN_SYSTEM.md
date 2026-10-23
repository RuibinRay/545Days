# DESIGN_SYSTEM — 545 DAYS

Status: tokens are **proposed** at M0; they become binding once M1 ships and is reviewed. Everything here is subject to the one-painting rule: the palette is sampled from one concept image ("dusk over a river valley") that gets painted at M1, not picked from a list.

## Tokens (CSS variables; Tailwind reads these, never hard-codes colors)

```css
:root {
  /* world palette (also the sprite palette; 16 colours max per biome family) */
  --c-abyss:  #0b1437;   /* night sky, deepest water, panel background */
  --c-slate:  #223052;   /* shadows, panel border */
  --c-river:  #3b6ea5;   /* water, links */
  --c-moss:   #5e7a3a;   /* grass */
  --c-field:  #a7a24a;   /* dry grass, farmland */
  --c-ash:    #8c8378;   /* roads, ruins */
  --c-sand:   #d9c18a;   /* coast, desert */
  --c-ivory:  #f3eadb;   /* text on dark, paper */
  --c-ember:  #f2c14e;   /* lamps, selection, warnings */
  --c-rust:   #c0512f;   /* danger, infection, fire */
  /* semantic */
  --bg: var(--c-abyss); --fg: var(--c-ivory); --accent: var(--c-ember); --danger: var(--c-rust);
  /* type scale, fluid 360→1440 px (same clamp() method as the portfolio) */
  --t-xs: clamp(.72rem,.68rem+.2vw,.8rem); --t-sm: clamp(.85rem,.8rem+.25vw,.95rem);
  --t-md: clamp(1rem,.95rem+.3vw,1.125rem); --t-lg: clamp(1.25rem,1.1rem+.7vw,1.6rem);
  --t-xl: clamp(1.75rem,1.4rem+1.6vw,2.6rem);
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px;
  --radius: 2px;            /* pixel UI: near-square corners */
  --dur: 160ms; --ease: cubic-bezier(.2,.7,.2,1);
}
@media (prefers-reduced-motion: reduce) { :root { --dur: 0ms; } }
```

Contrast: `--c-ivory` on `--c-abyss` ≈ 14:1; `--c-ember` on `--c-abyss` ≈ 9:1; `--c-rust` on `--c-abyss` ≈ 4.6:1 (text ok at ≥ 14 px bold; prefer as fill). Verify with a contrast tool at M1.

## Typography

- **Panels / HUD:** a humanist sans with tabular figures (self-hosted; candidate: *Instrument Sans*, already licensed and shipped on the portfolio). Numbers in the HUD use `font-variant-numeric: tabular-nums`.
- **In-world labels, day counter, vision captions:** a pixel bitmap font rendered by Pixi `BitmapText` at integer scale. Must be an original or OFL font; checked before M1.
- **Headings:** same sans, weight 600, letter-spacing −0.01em. No display serif here — the portfolio's Fraunces belongs to the portfolio.

## Components (conventions)

- **Panel:** `--c-abyss` at 92 % over the map, 1 px `--c-slate` border, `--radius`, `--space-4` padding, header row with title + close (Esc). Max width 420 px on desktop; full-width sheet on phones.
- **Stat:** label `--t-xs` uppercase 0.08em tracking in `--c-ash`; value `--t-lg` tabular.
- **Button:** 36 px min height (44 px on touch), 2 px focus ring in `--c-ember` offset 2 px, never color-only state.
- **Timeline:** horizontal, 545 ticks, events as 4 px marks; importance ≥ 7 as 8 px ember marks; keyboard ← → moves between events.
- **Overlay legend:** always rendered with a hatching toggle (colour-blind path).

## Motion principles

- Motion communicates state (a day passing, a selection, a vision) — never ambient on the HUD.
- World animation is driven by frames from the Worker; the HUD animates with CSS only (`--dur`).
- Reduced motion: sprites snap, no particles, instant panel transitions, vision palette swap instant.

## Accessibility rules (binding)

- WCAG 2.2 AA; pause control always visible (2.2.2); no keyboard trap in the canvas; DOM twin list for selectable map objects; visible focus everywhere; min 44 px touch targets; no information by colour alone.

## Engineering standards (binding)

- `src/sim/` imports nothing outside itself (lint rule).
- Integer money and goods; no transcendental `Math` in the engine.
- Every state shape in `types.ts`; version bump + migration for any persisted change.
- Tests: invariants, determinism (two runs, Worker vs main), replay, ending harness.
- Hash router; Vite `base` matches repo name; deploy via GitHub Actions to Pages.
- No trackers; the only outbound request is optional BYOK narration.

## M8 additions (2026-10-23)

- **Type:** Instrument Sans 400/600 self-hosted from `@fontsource/instrument-sans` (SIL Open Font License 1.1), `font-display: swap`; monospace stays the system stack.
- **Terrain:** four variants per land tile chosen by `hash2(x, y, 5) % 4`; decoration colours — flowers ivory/ember and `#d49bd6`, stones `PAL.stone`/`PAL.stoneDark`, cactus `#5e7a3a`, road earth `#b08a58`, road edge `#8a6a40`, rut `#9a7a4a`, foam `#bfd8e8` with spray `#e8f2f8`.
- **People:** three clothing cuts per occupation (plain / belted / dark coat with a lighter collar); hats are the occupation's colour family (farmer thatch `#c9a24a`, merchant timber `#5a3a28`, official slate `#2a2f3a`, doctor ivory with a rust mark, engineer ember).
- **Headings:** page h1 and panel h2 are visually hidden (`.sr-only`); section labels are `h3.h4` with the small-caps style; never skip a level.
- **Motion and sound:** carts move by arc length along roads; sound is opt-in, five cues, each with a text equivalent in the ticker.
- **Layout:** on ≤ 900 px the side panel is `height: 45vh` (fixed, not max) so the map never shifts; the ticker line is always present.

## M9 additions (2026-10-23)

- **HUD layout:** a CSS grid at every width — desktop `"back world day speeds stats" / "ticker…"`, tablet two rows plus the toggle, phone four rows with the stats as five equal columns. The world name is `minmax(0, 1fr)` with ellipsis; nothing wraps. Ticker row fixed at 30 px (26 on phones).
- **Reserved space:** `.tab__mark` 1 em; `.mission--empty` 220 px; HUD stats `min-width: 5.5em` on desktop with tabular figures.
- **Type loading:** `@font-face … font-display: optional` from `/public/fonts`, preloaded in `index.html`; never `swap`.
- **Lists of selectable things:** plain `ul` of `button[aria-pressed]`, never `listbox/option` around buttons.
- **Landmarks:** `header[role=banner]`, `main.stage`, `aside#inspector`; one `main` per page.
- **Phone:** stage `minmax(42vh, 1fr)`, side panel `height: 36vh`; no element wider than the viewport (checked with `scrollWidth`).
