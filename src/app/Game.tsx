import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Speed, RenderFrame, WorldInfo } from "../workers/protocol";
import { WorldRenderer } from "../render/scene";
import type { OverlayMode, RenderStatus, Selection, Tier } from "../render/scene";
import { StillRenderer } from "../render/still";
import { SimClient } from "./simClient";
import { navigate } from "./router";
import { DAYS } from "../sim/engine";
import type { EndingResult, WorldExport } from "../sim/types";
import { decodeFrame, label, money } from "./frameView";
import type { WorldView } from "./frameView";
import { Inspector } from "./panels/Inspector";
import { Chronicle } from "./panels/Chronicle";
// the charts library is a third of the bundle and only the Analytics tab needs it (M8)
const Analytics = lazy(() => import("./panels/Analytics").then((m) => ({ default: m.Analytics })));
import { Timeline } from "./panels/Timeline";
import { EndingScreen } from "./panels/EndingScreen";
import { Civs, CIV_COLORS, DISPOSITION_GLYPH } from "./panels/Civs";
import { Missions } from "./panels/Missions";
import { Powers } from "./panels/Powers";
import { Guide } from "./panels/Guide";
import { cue } from "./sound";
import { chronicleMarkdown, downloadText } from "./chronicleExport";
import { WorldTab } from "./panels/WorldTab";
import type { TierSetting } from "./panels/WorldTab";
import { VisionScreen } from "./panels/VisionScreen";
import { divergence as computeDivergence } from "../sim/story/oracle";
import { interventionCost } from "../sim/engine";
import type { Baseline, Vision } from "../sim/story/oracle";
import { eventText, notable } from "./events";
import { ACHIEVEMENTS, checkAchievements, loadEarned } from "./achievements";
import type { AchievementDef } from "./achievements";
import type { Forecast } from "../workers/protocol";

type Props = { seed: number; terrain: string; climate: string; size: string; civs: number; population: number; load: string | null };
type Tab = "inspect" | "civs" | "missions" | "chronicle" | "analytics" | "powers" | "world";
const TAB_LABEL: Record<Tab, string> = { inspect: "Inspect", civs: "Civs", missions: "Oracle", chronicle: "Chronicle", analytics: "Analytics", powers: "Powers", world: "World" };

const SPEEDS: { v: Speed; label: string; key: string }[] = [
  { v: 0, label: "Pause", key: "space" },
  { v: 1, label: "1×", key: "1" },
  { v: 4, label: "4×", key: "2" },
  { v: 16, label: "16×", key: "3" },
];

function readPref<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T | null) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* a preference is a convenience, not state */ }
}

function download(data: WorldExport, filename: string): void {
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Game({ seed, terrain, climate, size, civs: civCount, population, load }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<SimClient | null>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const stillRef = useRef<StillRenderer | null>(null);

  const [info, setInfo] = useState<WorldInfo | null>(null);
  const [frame, setFrame] = useState<RenderFrame | null>(null);
  const [peekFrame, setPeekFrame] = useState<RenderFrame | null>(null);
  const [speed, setSpeed] = useState<Speed>(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [overlay, setOverlay] = useState<OverlayMode>("none");
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("inspect");
  const [tierSetting, setTierSetting] = useState<TierSetting>(() => readPref<TierSetting>("545.tier", "auto"));
  const [activeTier, setActiveTier] = useState<Tier>("full");
  const [tierReason, setTierReason] = useState("default");
  const [droughtIntensity, setDroughtIntensity] = useState(60);
  const [ending, setEnding] = useState<EndingResult | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [visions, setVisions] = useState<Vision[]>([]);
  const [showVision, setShowVision] = useState(false);
  const [missionFlash, setMissionFlash] = useState(false);
  const [showEnding, setShowEnding] = useState(false);
  const [savedAt, setSavedAt] = useState<{ day: number; auto: boolean } | null>(null);
  const [worldName, setWorldName] = useState("");
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    const stored = readPref<"on" | "off" | "">("545.reducedMotion", "");
    if (stored === "on") return true;
    if (stored === "off") return false;
    return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  const showWhy = useMemo(() => new URLSearchParams(location.search).has("why"), []);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tick, setTick] = useState(0);
  const earnedRef = useRef<Set<string> | null>(null);
  const [unlocked, setUnlocked] = useState<AchievementDef | null>(null);
  const [powerCiv, setPowerCiv] = useState(0);

  const shownFrame = peekFrame ?? frame;
  const view: WorldView | null = useMemo(() => (shownFrame && info ? decodeFrame(shownFrame, info) : null), [shownFrame, info]);

  // ── worker lifecycle
  useEffect(() => {
    const client = new SimClient();
    clientRef.current = client;
    client.on({
      world: (i) => {
        setInfo(i);
        setWorldName(i.name);
        setEnding(client.ending);
        setShowEnding(false);
        setBaseline(null);
        setVisions([]);
        setShowVision(false);
        setPeekFrame(null);
        setSelection(null);
        setTick((t) => t + 1);
      },
      frame: (f) => {
        setFrame(f);
        setTick((t) => t + 1);
        rendererRef.current?.applyFrame(f);
        stillRef.current?.applyFrame(f);
        // achievements: checked every ten days and at the end, against what the panels already hold
        if (f.day % 10 === 0 || client.ending) {
          const earned = earnedRef.current;
          if (earned) void checkAchievements({ frame: f, events: client.events, interventions: client.interventions, ending: client.ending }, client.info?.name ?? "", earned).then((fresh) => { if (fresh.length) { setUnlocked(fresh[0]); cue("achievement"); } });
        }
        if (f.events.some((e) => e.type === "civ.colony_founded")) {
          for (const e of f.events) if (e.type === "civ.colony_founded" && e.settlement !== undefined) {
            const st = f.settlements.find((x) => x.id === e.settlement);
            if (st) rendererRef.current?.flashAt(st.cx, st.cy, 0x8fd18a);
          }
        }
        // an offer pauses the world and lights the Oracle button and tab; it no longer yanks the panel to the Oracle tab (that was a layout shift the player did not ask for)
        if (f.events.some((e) => e.type === "story.mission_offered")) { setMissionFlash(true); setForecast(null); cue("mission"); }
        else if (f.events.some((e) => e.type === "war.declared" || e.type === "story.rp.index" || e.type === "env.drought_begins")) cue("warning");
        else if (f.events.some((e) => e.type === "trade.route_opened")) cue("caravan");
        if (f.events.some((e) => e.type === "war.raid" || e.type === "war.conquest")) {
          for (const e of f.events) if ((e.type === "war.raid" || e.type === "war.conquest") && e.settlement !== undefined) {
            const st = f.settlements.find((x) => x.id === e.settlement);
            if (st) rendererRef.current?.flashAt(st.cx, st.cy, e.type === "war.conquest" ? 0xf2c14e : 0xc0512f);
          }
        }
      },
      peek: (f) => {
        setPeekFrame(f);
        if (f) { rendererRef.current?.applyFrame(f); stillRef.current?.applyFrame(f); }
      },
      speed: (s) => { setSpeed(s); rendererRef.current?.setSpeed(s); },
      ending: (e) => {
        setEnding(e);
        setShowEnding(true);
        cue("ending");
        const earned = earnedRef.current;
        if (earned && client.frame) void checkAchievements({ frame: client.frame, events: client.events, interventions: client.interventions, ending: e }, client.info?.name ?? "", earned).then((fresh) => { if (fresh.length) setUnlocked(fresh[0]); });
      },
      forecast: (fc) => setForecast(fc),
      oracle: (b, v, fresh) => { setBaseline(b); setVisions(v); if (fresh && v.length > 0) setShowVision(true); },
      saved: (s) => setSavedAt({ day: s.day, auto: s.auto }),
      exported: (data, filename) => download(data, filename),
      imported: (_ok, message) => setNotice(message),
      error: (m) => setError(m),
    });
    if (load) client.load(load);
    else client.init(seed, { terrain: terrain as never, climate: climate as never, size: size as never, civs: civCount as 1 | 2 | 3, population });
    return () => { client.destroy(); clientRef.current = null; };
  }, [seed, terrain, climate, size, civCount, population, load]);

  useEffect(() => {
    if (!missionFlash) return;
    const t = setTimeout(() => setMissionFlash(false), 4000);
    return () => clearTimeout(t);
  }, [missionFlash]);

  // ── renderer lifecycle
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !info) return;
    let cancelled = false;
    host.innerHTML = "";
    rendererRef.current = null;
    stillRef.current = null;
    if (tierSetting === "text") { setActiveTier("text"); setTierReason("chosen in settings"); return; }
    if (tierSetting === "still") {
      const s = new StillRenderer(host, info);
      stillRef.current = s;
      if (clientRef.current?.frame) s.applyFrame(clientRef.current.frame);
      setActiveTier("still");
      setTierReason("chosen in settings");
      return;
    }
    WorldRenderer.create(host, info, { reducedMotion, forceLite: tierSetting === "lite" })
      .then((r) => {
        if (cancelled) { r.destroy(); return; }
        rendererRef.current = r;
        if (showWhy) (globalThis as unknown as { __545?: unknown }).__545 = r; // ?why: a console handle for diagnostics
        r.onSelect = (sel) => { setSelection(sel); if (sel) setTab("inspect"); };
        r.onTierChange = (t, reason) => { setActiveTier(t); setTierReason(reason); if (t === "still") setTierSetting("still"); };
        r.setOverlay(overlay);
        r.setSpeed(clientRef.current?.speed ?? 0);
        if (clientRef.current?.frame) r.applyFrame(clientRef.current.frame);
        const st = r.getStatus();
        setActiveTier(st.tier);
        setTierReason(st.reason);
      })
      .catch((e: unknown) => { setTierReason(`WebGL init failed: ${e instanceof Error ? e.message : String(e)}`); setTierSetting("still"); });
    return () => { cancelled = true; rendererRef.current?.destroy(); rendererRef.current = null; stillRef.current?.destroy(); stillRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, tierSetting]);

  useEffect(() => { rendererRef.current?.setOverlay(overlay); }, [overlay]);
  useEffect(() => { rendererRef.current?.setReducedMotion(reducedMotion); writePref("545.reducedMotion", reducedMotion ? "on" : "off"); }, [reducedMotion]);
  useEffect(() => { writePref("545.tier", tierSetting); }, [tierSetting]);
  useEffect(() => { rendererRef.current?.select(selection); }, [selection]);
  useEffect(() => {
    if (!showWhy) return;
    const id = setInterval(() => setStatus(rendererRef.current ? rendererRef.current.getStatus() : null), 1000);
    return () => clearInterval(id);
  }, [showWhy]);
  useEffect(() => { void loadEarned().then((set) => { earnedRef.current = set; }); }, []);
  useEffect(() => {
    if (!unlocked) return;
    const t = setTimeout(() => setUnlocked(null), 7000);
    return () => clearTimeout(t);
  }, [unlocked]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── keyboard
  const setSpeedCmd = useCallback((s: Speed) => clientRef.current?.setSpeed(s), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if (showEnding || showVision) return;
      const r = rendererRef.current;
      const s = stillRef.current;
      const step = 48;
      switch (e.key) {
        case "ArrowLeft": case "a": r?.pan(step, 0); s?.pan(step, 0); break;
        case "ArrowRight": case "d": r?.pan(-step, 0); s?.pan(-step, 0); break;
        case "ArrowUp": case "w": r?.pan(0, step); s?.pan(0, step); break;
        case "ArrowDown": case "s": r?.pan(0, -step); s?.pan(0, -step); break;
        case "+": case "=": r?.zoomBy(1); s?.zoomBy(1); break;
        case "-": case "_": r?.zoomBy(-1); s?.zoomBy(-1); break;
        case " ": e.preventDefault(); setSpeedCmd(speed === 0 ? 1 : 0); break;
        case "1": setSpeedCmd(1); break;
        case "2": setSpeedCmd(4); break;
        case "3": setSpeedCmd(16); break;
        case "Escape": setSelection(null); break;
        default: return;
      }
      if (e.key.startsWith("Arrow")) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speed, setSpeedCmd, showEnding, showVision]);

  const focusSelection = useCallback(
    (sel: Selection) => {
      const r = rendererRef.current;
      if (r && view) {
        if (sel.kind === "building") {
          const b = view.buildings.find((x) => x.id === sel.id);
          if (b) r.focusOn(b.x, b.y, 3);
        } else if (sel.kind === "citizen") {
          const c = view.citizens.find((x) => x.id === sel.id);
          const b = c ? view.buildings.find((x) => x.id === (c.action === "work" && c.workplaceBuilding >= 0 ? c.workplaceBuilding : c.home)) : undefined;
          if (b) r.focusOn(b.x, b.y, 3);
        } else r.focusOn(sel.x, sel.y, 3);
      }
      setSelection(sel);
      setTab("inspect");
    },
    [view],
  );

  const scrub = useCallback((day: number | null) => {
    clientRef.current?.peek(day);
    if (day === null) setPeekFrame(null);
  }, []);

  const client = clientRef.current;
  const liveDay = frame?.day ?? 0;
  const day = shownFrame?.day ?? 0;
  const settlement = info?.settlements[0];
  const market = shownFrame?.markets[0];
  const treasuryTotal = shownFrame ? shownFrame.civs.reduce((a, c) => a + (c.alive ? c.treasury : 0), 0) : 0;
  const openMission = frame?.missions.find((m) => m.status === "offered") ?? null;
  const divergence = useMemo(() => (baseline && frame && client ? computeDivergence(baseline, client.metrics, client.events, frame.day) : null), [baseline, frame, client]);
  const warsNow = shownFrame ? shownFrame.civs.reduce((a, c) => a + c.wars.length, 0) / 2 : 0;
  const events = client?.events ?? [];
  const metrics = client?.metrics ?? [];
  const foodPrices = client?.foodPrices ?? [];
  void tick;
  const latestNotable = [...events].reverse().find(notable);
  const kindOf = (bizId: number) => view?.businesses.find((x) => x.id === bizId)?.kind ?? "business";
  const peeking = peekFrame !== null;

  return (
    <div className={`game game--${activeTier} ${peeking ? "game--peeking" : ""}`}>
      <a className="skip" href="#inspector">Skip to panels</a>
      <header className="hud" role="banner">
        <h1 className="sr-only">545 DAYS — {worldName || "a world"}</h1>
        <button className="btn btn--ghost hud__back" onClick={() => navigate({ name: "home" })} aria-label="545 DAYS — back to Create World">◀ 545 DAYS</button>
        <div className="hud__world">
          <strong>{info ? (info.civs.length > 1 ? info.civs.map((c) => `${DISPOSITION_GLYPH[c.disposition]} ${info.settlements.find((s) => s.civ === c.id)?.name ?? c.name}`).join("  ") : settlement?.name) : "Generating…"}</strong>
          <span className="hud__dim">{worldName}{info?.forkedFrom ? ` · branched from ${info.forkedFrom.name} at day ${info.forkedFrom.day}` : ` · seed ${seed}`}{shownFrame?.climate.droughtDays ? ` · drought, ${shownFrame.climate.droughtDays} days left` : ""}{warsNow > 0 ? ` · ${warsNow} war${warsNow === 1 ? "" : "s"}` : ""}</span>
        </div>
        <div className="hud__day" aria-live="polite" aria-atomic="true">
          <span className="hud__label">{peeking ? "Viewing" : "Day"}</span>
          <span className="hud__value">{day}</span>
          <span className="hud__dim">/ {DAYS}{liveDay >= DAYS ? " · beyond the countdown" : ""}</span>
        </div>
        <div className="hud__speeds" role="group" aria-label="Simulation speed">
          {SPEEDS.map((s) => (
            <button key={s.v} className={`btn ${speed === s.v ? "btn--active" : ""}`} aria-pressed={speed === s.v} onClick={() => { if (peeking) scrub(null); setSpeedCmd(s.v); }} title={`Shortcut: ${s.key}`}>{s.label}</button>
          ))}
          <button className="btn btn--ghost" onClick={() => { if (peeking) scrub(null); client?.stepOnce(); }} title="Advance one day">Step</button>
        </div>
        <div className="hud__stats">
          <span><span className="hud__label">People</span> <span className="hud__value">{shownFrame?.metrics.population ?? "–"}</span></span>
          <span><span className="hud__label">Food</span> <span className="hud__value">{shownFrame && shownFrame.markets.length ? `$${(shownFrame.markets.reduce((a, m) => a + m.price.food, 0) / shownFrame.markets.length / 100).toFixed(2)}` : "–"}</span></span>
          <span><span className="hud__label">Jobless</span> <span className="hud__value">{shownFrame ? `${shownFrame.metrics.unemployment}%` : "–"}</span></span>
          <span><span className="hud__label">Treasuries</span> <span className="hud__value">{shownFrame ? money(treasuryTotal) : "–"}</span></span>
          <span title="Influence / Knowledge"><span className="hud__label">◆ / ◇</span> <span className="hud__value">{shownFrame ? `${shownFrame.story.influence}/${shownFrame.story.knowledge}` : "–"}</span></span>
        </div>
        <button className="btn btn--ghost hud__toggle" onClick={() => setPanelOpen((v) => !v)} aria-expanded={panelOpen} aria-controls="inspector">{panelOpen ? "Hide panel" : "Show panel"}</button>
        {/* the ticker line is always in the layout — one row, fixed height — so the map below it never shifts;
            the Oracle's offer takes the row's left end when there is one */}
        <div className={`hud__ticker ${unlocked ? "hud__ticker--achievement" : ""}`} role="status" aria-live="polite">
          {openMission && (
            <button className={`btn btn--oracle ${missionFlash ? "btn--oracle-flash" : ""}`} onClick={() => { setTab("missions"); setPanelOpen(true); }} aria-label={`Open mission: ${openMission.title}`}>
              ◈ The Oracle: {openMission.title} <span className="hud__dim">({openMission.expiresDay - liveDay} d)</span>
            </button>
          )}
          <span className="hud__ticker-text">{unlocked ? `◆ Achievement — ${unlocked.title}: ${unlocked.text}` : notice ?? (latestNotable ? `Day ${latestNotable.day}: ${eventText(latestNotable, info, kindOf)}` : "")}</span>
        </div>
      </header>

      <main className="stage" aria-label="The map">
        <Guide frame={shownFrame} speed={speed} />
        <div ref={hostRef} className="stage__canvas" aria-hidden={activeTier === "text"} />
        {!info && !error && <div className="stage__loading" role="status">{load ? "Loading world…" : "Generating world…"}</div>}
        {error && <div className="stage__error" role="alert">{error}</div>}
        {activeTier === "text" && info && view && (
          <div className="stage__text">
            <h2>{settlement?.name}</h2>
            <p>{info.settlements[0]?.civName}. {view.buildings.filter((b) => b.alive).length} buildings, {view.citizens.filter((c) => c.alive).length} citizens. Map {info.width}×{info.height}.</p>
            <p>The map is hidden in text mode. Use the lists in the panel to inspect buildings and citizens; the chronicle and charts work as usual.</p>
          </div>
        )}
        {ending && !showEnding && (
          <button className="btn btn--ghost stage__endingbtn" onClick={() => setShowEnding(true)}>Ending: {ending.title}</button>
        )}
        {showVision && !showEnding && (
          <VisionScreen visions={visions} worldName={worldName} ms={baseline?.ms ?? 0} reducedMotion={reducedMotion} onBegin={() => setShowVision(false)} />
        )}
        {ending && showEnding && (
          <EndingScreen
            ending={ending}
            worldName={worldName}
            baseline={baseline}
            divergence={divergence}
            interventions={client?.interventions ?? []}
            snapshotDays={client?.snapshotDays ?? []}
            onContinue={() => setShowEnding(false)}
            onRestart={() => client?.restart()}
            onFork={(d) => client?.fork(d)}
            onNewWorld={() => navigate({ name: "home" })}
            onExport={() => client?.export()}
          />
        )}
        <Timeline day={liveDay} viewDay={peekFrame ? peekFrame.day : null} events={events} interventions={client?.interventions ?? []} onScrub={scrub} />
      </main>

      <aside id="inspector" className={`panel side ${panelOpen ? "" : "side--closed"}`} aria-label="Inspector, chronicle, analytics and settings">
        <nav className="tabs" role="tablist" aria-label="Panel sections">
          {(["inspect", "civs", "missions", "chronicle", "analytics", "powers", "world"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? "tab--active" : ""} ${t === "missions" && openMission ? "tab--alert" : ""}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}{t === "missions" && <span className="tab__mark" aria-hidden={!openMission}>{openMission ? "◈" : ""}</span>}</button>
          ))}
        </nav>
        <h2 className="sr-only">{TAB_LABEL[tab]}</h2>

        {tab === "inspect" && (
          <section role="tabpanel">
            {peeking && <p className="dim">Showing day {day}. Details below are from that day; memories and beliefs are only available for today.</p>}
            {!selection && <p className="dim">Click or tap a building, a citizen, or a tile — or pick one from the lists.</p>}
            {selection && info && view && (
              <Inspector
                sel={selection} info={info} view={view} client={peeking ? null : client} day={day} onClear={() => setSelection(null)} onFocus={focusSelection}
                onRemoveCitizen={peeking ? undefined : (id) => client?.intervene({ day: liveDay + 1, type: "remove_citizen", citizen: id })}
                onDestroyBuilding={peeking ? undefined : (id) => { client?.intervene({ day: liveDay + 1, type: "destroy_building", building: id }); setSelection(null); }}
                onInvestigate={peeking ? undefined : (target, id) => { client?.intervene({ day: liveDay + 1, type: "reveal", target, id }); setNotice("Investigating — the finding appears in the Oracle tab under “What you have learned”."); }}
                influence={frame?.story.influence ?? 0}
                revealLog={frame?.story.revealLog ?? {}}
              />
            )}
            <h3 className="h4">Buildings ({view?.buildings.filter((b) => b.alive).length ?? 0})</h3>
            <ul className="list" aria-label="Buildings">
              {view?.buildings.filter((b) => b.alive).map((b) => (
                <li key={b.id}>
                  <button className="list__item" aria-pressed={selection?.kind === "building" && selection.id === b.id} onClick={() => focusSelection({ kind: "building", id: b.id })}>{label(b.kind)} #{b.id} <span className="dim">tier {b.tier}{b.business < 0 && b.kind !== "house" && b.kind !== "town_hall" ? " · empty" : ""}</span></button>
                </li>
              ))}
            </ul>
            <h3 className="h4">Citizens ({view?.citizens.filter((c) => c.alive).length ?? 0})</h3>
            <ul className="list" aria-label="Citizens">
              {view?.citizens.filter((c) => c.alive).map((c) => (
                <li key={c.id}>
                  <button className="list__item" aria-pressed={selection?.kind === "citizen" && selection.id === c.id} onClick={() => focusSelection({ kind: "citizen", id: c.id })}>{c.name} <span className="dim">{c.occupation} · {money(c.wealth)}</span></button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "civs" && info && shownFrame && (
          <section role="tabpanel">
            <Civs civs={shownFrame.civs} settlements={shownFrame.settlements} info={info} day={day} onFocus={focusSelection} onCenter={(id) => { const st = shownFrame.settlements.find((s) => s.id === id); if (st) rendererRef.current?.focusOn(st.cx, st.cy, 1); }} />
          </section>
        )}

        {tab === "missions" && info && frame && (
          <section role="tabpanel">
            <Missions
              missions={frame.missions}
              forecast={forecast}
              baseline={baseline}
              visions={visions}
              divergence={divergence}
              ended={ending !== null}
              day={liveDay}
              info={info}
              live={!peeking}
              kindOf={kindOf}
              onAnswer={(id, accept) => { client?.answerMission(id, accept); setForecast(null); }}
              onRefresh={(id) => client?.requestForecast(id)}
              onFocus={focusSelection}
              story={frame.story}
              missionCost={(m) => interventionCost({ type: "mission", mission: m.id, accept: true }, frame.missions)}
              onRevealVision={(i) => client?.intervene({ day: liveDay + 1, type: "reveal_vision", vision: i })}
            />
          </section>
        )}

        {tab === "chronicle" && (
          <section role="tabpanel">
            <Chronicle events={events} metrics={metrics} foodPrices={foodPrices} info={info} view={view} onFocus={focusSelection} onGoToDay={(d) => scrub(d >= liveDay ? null : d)} highlightDay={peekFrame?.day ?? null} />
          </section>
        )}

        {tab === "analytics" && (
          <section role="tabpanel">
            <Suspense fallback={<p className="dim">Loading charts…</p>}>
              <Analytics metrics={metrics} foodPrice={foodPrices} baseline={baseline?.metrics ?? null} />
            </Suspense>
            {market && shownFrame && (
              <>
                <h3 className="h4">Markets on day {day}</h3>
                {shownFrame.markets.map((mk) => {
                  const st = shownFrame.settlements.find((s) => s.id === mk.settlement);
                  const civ = shownFrame.civs.find((c) => c.id === st?.civ);
                  return (
                    <dl key={mk.settlement}>
                      <div className="dl__row"><dt><span className="civ__swatch civ__swatch--small" style={{ background: CIV_COLORS[(civ?.color ?? 0) % CIV_COLORS.length] }} aria-hidden="true" /> {st?.name}</dt><dd>food ${(mk.price.food / 100).toFixed(2)} · materials ${(mk.price.materials / 100).toFixed(2)} · energy ${(mk.price.energy / 100).toFixed(2)} · granary {mk.reserve.food}</dd></div>
                    </dl>
                  );
                })}
              </>
            )}
          </section>
        )}

        {tab === "powers" && (
          <Powers frame={frame} client={client} liveDay={liveDay} peeking={peeking} scrub={scrub} ending={ending} droughtIntensity={droughtIntensity} setDroughtIntensity={setDroughtIntensity} powerCiv={powerCiv} setPowerCiv={setPowerCiv} />
        )}

        {tab === "world" && (
          <WorldTab info={info} frame={frame} client={client} seed={seed} worldName={worldName} setWorldName={setWorldName} savedAt={savedAt} overlay={overlay} setOverlay={setOverlay} activeTier={activeTier} tierReason={tierReason} tierSetting={tierSetting} setTierSetting={setTierSetting} reducedMotion={reducedMotion} setReducedMotion={setReducedMotion} showWhy={showWhy} status={status} onExportChronicle={() => { if (info) downloadText(chronicleMarkdown(info, events, client?.interventions ?? [], ending, kindOf, liveDay), `${(info.name || "world").replace(/[^\w-]+/g, "-")}-day-${liveDay}.md`); }} />
        )}
      </aside>
    </div>
  );
}
