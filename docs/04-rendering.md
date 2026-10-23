# 04 — Map rendering architecture

## Position

The renderer is a **read-only consumer of `RenderFrame`s**. It never imports from `src/sim/` except `types.ts` for shape definitions, never computes game logic, and can be deleted without changing any simulation result. Nothing appears on screen that is not present in a frame.

## Projection: top-down, not isometric

The source conversation leans isometric. Decision: **top-down 16 px tiles** (WorldBox's projection).
- Isometric needs depth sorting, diamond tile masks, and 2–4× the tile art per biome edge. Top-down needs one 16×16 tile per biome plus a 47-tile autotile set for coasts/rivers.
- Top-down reads better at the world scale (96×96 tiles = whole screen at 1×) and is what the "painting the world" sandbox interaction wants.
- Pixel art is 2× or 3× integer-scaled; no fractional zoom (`roundPixels: true`, nearest-neighbour).

## The frame protocol (`src/workers/protocol.ts`)

```ts
interface RenderFrame {
  day: number;
  terrainVersion: number;       // bump → renderer rebuilds chunks; otherwise untouched
  terrainPatch?: { x: number; y: number; w: number; h: number; biome: Uint8Array; owner: Uint16Array };
  moisture?: Uint8Array;        // only when an overlay is active
  buildings: Int16Array;        // [id, kind, x, y, tier, condition>>2, settlement] × n
  citizens: Int16Array;         // [id, homeBuilding, itinerary0..3, occupation, flags] × n
  fx: Int16Array;               // [kind, x, y, intensity] × n  (fire, rain, riot, explosion)
  settlements: { id: number; name: string; cx: number; cy: number }[];
  hud: { population: number; dayPhase: 0|1|2|3; season: 0|1|2|3; remaining: number };
}
```

Typed arrays transfer by ownership (zero-copy). A frame at 150 citizens / 40 buildings is ~3 KB.

## Scene graph (PixiJS v8, WebGL renderer)

```
Stage
├─ world (Container, camera transform)
│  ├─ terrain      ChunkedTilemap: 16×16-tile chunks, each a cached RenderTexture; rebuilt only on terrainPatch
│  ├─ water        animated tiles via a 4-frame texture swap at 2 fps (not a shader; cheap and pixel-faithful)
│  ├─ overlay      a Sprite over a 96×96 texture (one texel per tile) tinted per overlay mode; nearest filter
│  ├─ buildings    sprite pool keyed by id; texture = atlas[kind][tier]; condition < 50 swaps to "damaged" frame
│  ├─ citizens     sprite pool keyed by id; 16×24, 4-dir walk cycle; position interpolated along itinerary
│  ├─ fx           particle sprites from a 64-sprite pool
│  └─ labels       BitmapText settlement names (pixel font), hidden below 2× zoom
└─ ui              nothing — HUD is React, overlaid in DOM
```

## Citizen animation without lying

A citizen's frame entry is `itinerary: [home, workplace, market, home]` for the day. The renderer splits the real-time day (4 s at 1×) into those legs and moves the sprite along a straight line with a tiny perpendicular wobble; buildings have a door tile so sprites converge on it. At 4× the walk still happens, faster; at 16× sprites teleport to their last itinerary stop (no walk) and the frame rate target is 1 frame/day. This is honest (every stop is in state) and costs nothing in the Worker.

## Camera

- Pan: drag / WASD / arrow keys / two-finger. Zoom: wheel / pinch / `+ −` keys, integer steps 1×–4×. `focusOn(x, y, zoom)` with a 400 ms ease (CSS-style `ease-out`, implemented as a 2-term polynomial — no `Math.pow`).
- Selection: a hit-test over buildings/citizens in screen space; a 2 px gold outline sprite follows the selection. Keyboard: Tab cycles settlements → buildings in the viewport; Enter opens the panel. Escape closes.
- Story Mode "vision" cutscenes: the renderer applies a palette-swap filter (one small fragment shader, the only one in v1) and letterboxes; the React layer draws the caption. Reduce Motion: no letterbox animation, instant palette swap.

## Day/night and seasons

A full-screen multiply layer tinted by `dayPhase` (dawn `#f2c14e` at 10 %, night `#0b1437` at 55 %) and `season` (winter desaturates grass tiles by swapping the atlas region, not by filter). Reduced-FX tier: night tint only, no dawn/dusk blend.

## Performance tiers (the ladder exists before the effects)

| Tier | Trigger | What changes |
|---|---|---|
| full | default | everything above |
| lite | `fps < 40` for 3 s or `navigator.hardwareConcurrency ≤ 2` | no particles, water at 1 fps, no palette shader, citizens capped at 60 visible |
| still | WebGL unavailable or context lost twice | terrain drawn once to a `<canvas>`, buildings as DOM-free sprites in one static draw per day, citizens hidden |
| text | user setting | map hidden; HUD + panels + timeline only (also the screen-reader path) |

`?why` renders the active tier, its reason, fps, and worker step time — identical in spirit to the portfolio's diagnostic that solved the "it's frozen" reports.

## Overlays (every one maps to a state field)

political (`terrain.owner`), moisture (`terrain.moisture`), food security (settlement `foodDaysReserve`), wealth (mean wealth of residents per tile cluster), unrest, infection, pollution, **machine autonomy** (hidden until discovered in Story Mode). The overlay texture is written in the Worker from state and shipped in the frame on request; the renderer only tints.

## Art direction summary (details in DESIGN_SYSTEM.md)

- 16-colour master palette per biome family, derived from one concept painting ("dusk over a river valley"): cold shadow blues, warm lamp ambers, desaturated greens. Night = hue-shifted ramp of the same palette, not a black overlay.
- Sprite sizes fixed: tiles 16, citizens 16×24, small buildings 32×32, large 48×48, lab/town hall 48×64.
- Buildings grow by **tier** (0–3): shed → house → house with chimney → two-storey; it is the visible "civilizations develop" signal and it maps 1:1 to `building.tier`.
- No sprite is a trace of WorldBox or any other game. Reference is period photography of small towns plus the project's own concept sheet.

## Accessibility

- Every selectable thing has a DOM twin in a visually-hidden list (`role="listbox"`) so screen readers and keyboard users can select without the canvas.
- Focus is never trapped in the canvas; `Tab` from the last map item goes to the HUD.
- Pause control always visible; motion respects `prefers-reduced-motion` and an in-app toggle that persists.
- Colour overlays carry a pattern alternative (hatching) toggle, since red/green political borders fail for ~8 % of men.

## M7 as built (2026-10-22) — live overlays, caravans, deltas

- **WorldInfo is static; frames carry deltas.** Births and colonies add citizens and settlements after the world was announced, and a colony claims land. `RenderFrame.delta` (new citizens, new settlements, and the owner map when it changed) is sent once per change; `SimClient` merges it into `info`, the scene adds a label for the new town and redraws the territory overlay.
- **Live overlays** (`food`, `wealth`, `sickness`, `trade`) are computed from the frame on the main thread, redrawn every five days or when the mode changes. The first three paint every land tile within 16 tiles of a town with that town's value, fading with distance, so they read at any zoom (the territory circle is five tiles and hides under the buildings). `trade` draws every road a caravan has ever used (`frame.routes`) in gold, wider and brighter with today's cargo, and rings towns whose civ bans exports (red), shuts its borders (grey) or is quarantined (green). A legend line under the select says what the colours mean.
- **Byte-buffer textures.** Overlays are uploaded as `BufferImageSource` RGBA rather than canvas-backed textures: in headless Chromium (SwiftShader) a 128×128 canvas source uploaded only a strip of itself; raw bytes upload whole everywhere. Found by extracting the sprite's GPU pixels and comparing with the canvas.
- **Caravans** are a 24×16 cart-and-ox sprite (load coloured by good) placed on the straight line between the two towns by `(day − departDay) / (arriveDay − departDay)`, in the citizen layer so they sort with the people. They do not follow roads (there are none); see CREATIVE_EXPERIMENTS.
- **`applied` interventions** ride in the frame so the timeline's count and the achievements see the player's direct powers without a reload (they were only loaded with the world before).

## M8 as built (2026-10-23) — roads, the art pass, progressive baking

- **Roads** are state (`WorldState.roads`, `worldgen/roads.ts`): Dijkstra over the terrain with a cost per tile (open 1, forest 2, hills 3, mountain 9, ford +4; sea impassable), N/E/S/W in a fixed order so the path is the same on every machine. Laid between every pair of Day-0 towns and, when a colony is founded, to its parent and the nearest other town. The renderer bakes them as a 16-mask dirt-track autotile (`makeRoad`) under the buildings; carts and marching soldiers are placed along the polyline by arc length (`pointAlong`); caravan journey time is the road's tile count ÷ 10. Towns on different islands get no road and sail the straight line.
- **Tiles** come in four variants per biome chosen by `hash2(x, y, 5)`: tufts, flower pairs and stones on grass; two or three trees (sapling, old tree) in forest; ridges with a lit slope on hills; a shadowed peak that moves per variant on mountains; shells, pebbles and tide lines on coast; dune lines and a cactus in desert. Ocean tiles next to land get a foam line per touching side (`makeFoam`, 4 shimmer frames). Citizens have three clothing cuts (plain, belted, dark coat with collar), a beard-or-scarf for a third of them, and a hat or tool per trade (straw hat, cap, tall hat, spectacles, doctor's cap, engineer's hard hat); 24 looks per occupation are cached.
- **Progressive bake.** `buildChunks` sorts the 64 chunks by distance from the first town, bakes nine synchronously (the default viewport) and the rest within 6 ms per tick (10 ms in lite); the three extra water frames are queued last and only in the full tier with motion on. `?why` shows chunks pending and the finished bake time. Measured in headless 2-core Chromium: first frame 0.66 s, bake done at 2.7 s (1×); 1.45 s / 5.0 s at 4× throttle.
- **Overlays** unchanged from M7 except that the texture source is a byte buffer; **Analytics** is lazy-loaded (the charts chunk is 98 kB gzip and only that tab needs it); vendor chunks `react`, `pixi`, `charts` cache separately; Instrument Sans is self-hosted from `@fontsource` (SIL OFL) with `font-display: swap`.
- **CLS fixes:** the side panel has a fixed 45 vh height on narrow screens (its content changes every day), the ticker line is always in the layout, the HUD stats always render with placeholders. Lighthouse CLS 0.155 → 0.001.
- **Not done:** real-device fps and field Core Web Vitals (no device here); hand-drawn sheets — every sprite is still procedural; carts still cross a river at a ford without a bridge sprite.

## M9 as built (2026-10-23) — the renderer in four files, bridges, no layout shift

- **Split.** `scene.ts` (630 lines) keeps the camera, input, buildings, citizens, labels, tiers and the day tint; `terrain.ts` owns tile/river/road/bridge/foam textures, the chunk bake queue and the water frames; `overlays.ts` owns the static and live overlays; `caravans.ts` owns the cart sprites and the cached road polylines that soldiers' marches share. The renderer is a façade over the three.
- **Bridges.** A road tile that is also a river tile bakes `makeBridge(mask)` — planks across the water along the road's N/S or E/W arms, rails and posts — instead of the dirt track; the still renderer does the same.
- **Layout stability.** The HUD is a CSS grid with fixed areas at every width (desktop: back · world · day · speeds · stats / ticker; tablet: two rows; phone: four rows with the stats as five equal columns). The world name ellipsises instead of wrapping. The ticker is one 30 px row that also hosts the Oracle's button. The Oracle tab's mark is a reserved 1 em. The mission slot keeps 220 px when empty. An offer no longer switches the panel to the Oracle tab. Measured in-page CLS: 0.007 desktop / 0.016 phone over a 40 s session; Lighthouse CLS 0.
- **Type.** Instrument Sans is served from `public/fonts` with `font-display: optional` and `<link rel=preload>`, so it never swaps in late (the swap was a 0.145 shift at ~0.9 s).
- **Phone.** ≤ 600 px: the stage is at least 42 vh, the side panel 36 vh, stats in a five-column grid with ellipsis; no horizontal overflow at 390 px.
