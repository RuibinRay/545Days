/// <reference lib="webworker" />
/**
 * The sim Worker: owns the live WorldState, its history (snapshots, events, metrics, interventions),
 * persistence (IndexedDB), and the ending. The main thread only ever sees frames and summaries.
 */
import type { DailyMetrics, EndingResult, Intervention, SavedWorld, Snapshot, WorldEvent, WorldExport, WorldSettings, WorldState } from "../sim/types";
import { DEFAULT_SETTINGS, generateWorld } from "../sim/worldgen";
import { DAYS, isTerminal, step } from "../sim/engine";
import { hashHex } from "../sim/hash";
import { computeMetrics } from "../sim/metrics";
import { SNAPSHOT_EVERY, cloneState, replay, snapshotBefore, takeSnapshot } from "../sim/snapshot";
import { resolveEnding } from "../sim/story/endings";
import { computeBaseline, visionFragments } from "../sim/story/oracle";
import type { Baseline } from "../sim/story/oracle";
import { deleteWorld, getWorld, listWorlds, newId, putWorld } from "../storage/db";
import { MS_PER_DAY } from "./protocol";
import type { BranchSummary, Forecast, MainToWorker, RenderFrame, Speed, WorkerToMain } from "./protocol";
import { buildFrame, knownOf, worldInfo } from "./frame";
import type { Known } from "./frame";

/** Days a mission forecast looks ahead. */
const FORECAST_DAYS = 90;

interface Run {
  id: string;
  name: string;
  createdAt: number;
  settings: WorldSettings;
  state: WorldState;
  snapshots: Snapshot[];
  events: WorldEvent[];
  metrics: DailyMetrics[];
  interventions: Intervention[];
  ending: EndingResult | null;
  forkedFrom: SavedWorld["forkedFrom"];
  lastMetrics: DailyMetrics | null;
  baseline: Baseline | null;
  /** How much of the world the main thread has been told about (WorldInfo is static; frames carry deltas). */
  known: Known;
}

let run: Run | null = null;
let speed: Speed = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let queued: Intervention[] = [];
let peeking = false;

function post(msg: WorkerToMain, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

// ───────────────────────── frames ─────────────────────────

function sendFrame(f: RenderFrame): void {
  const buffers: Transferable[] = [f.citizens.buffer, f.buildings.buffer, f.businesses.buffer];
  if (f.delta?.owner) buffers.push(f.delta.owner.buffer);
  post({ type: "frame", frame: f }, buffers);
}

function announce(r: Run, fresh = false): void {
  const info = worldInfo(r);
  post(
    { type: "world", info, history: { events: r.events.filter((e) => e.importance >= 2), metrics: r.metrics, interventions: r.interventions, ending: r.ending, snapshotDays: r.snapshots.map((sn) => sn.day) } },
    [info.biome.buffer, info.elevation.buffer, info.moisture.buffer, info.resource.buffer, info.river.buffer, info.owner.buffer],
  );
  sendFrame(buildFrame(r.state, { stepMs: 0, events: [], metrics: r.lastMetrics, snapshotDays: r.snapshots.map((sn) => sn.day), known: r.known }));
  speed = 0;
  post({ type: "speed", speed });
  // the Oracle: run the untouched world to Day 545 once, after the map is on screen
  setTimeout(() => {
    if (run !== r) return;
    if (!r.baseline) r.baseline = computeBaseline(r.snapshots[0].state);
    post({ type: "oracle", baseline: r.baseline, visions: visionFragments(r.baseline, r.snapshots[0].state, r.settings.endingPreview), fresh });
  }, 0);
}

// ───────────────────────── run control ─────────────────────────

function newRun(seed: number, settings: WorldSettings, name: string, forkedFrom: SavedWorld["forkedFrom"] = null): Run {
  const state = generateWorld(seed, settings);
  return { id: newId(), name, createdAt: Date.now(), settings, state, snapshots: [takeSnapshot(state)], events: [], metrics: [], interventions: [], ending: null, forkedFrom, lastMetrics: null, baseline: null, known: knownOf(state) };
}

function advance(): void {
  if (!run || peeking) return;
  if (run.ending && run.state.day >= DAYS && run.ending.id === "fallback.empty") return; // nobody left to simulate
  const r = run;
  const t0 = performance.now();
  const iv = queued;
  queued = [];
  if (iv.length) {
    // snapshot before an intervention so a fork can start exactly where the player acted
    if (!r.snapshots.some((sn) => sn.day === r.state.day)) r.snapshots.push(takeSnapshot(r.state));
    for (const x of iv) r.interventions.push({ ...x, day: r.state.day + 1 });
  }
  const res = step(r.state, iv.map((x) => ({ ...x, day: r.state.day + 1 })));
  r.events.push(...res.events);
  r.metrics.push(res.metrics);
  r.lastMetrics = res.metrics;
  if (r.state.day % SNAPSHOT_EVERY === 0 && !r.snapshots.some((sn) => sn.day === r.state.day)) r.snapshots.push(takeSnapshot(r.state));
  sendFrame(buildFrame(r.state, { stepMs: performance.now() - t0, events: res.events, metrics: res.metrics, snapshotDays: r.snapshots.map((sn) => sn.day), applied: iv.map((x) => ({ ...x, day: r.state.day })), known: r.known }));
  const offered = res.events.find((e) => e.type === "story.mission_offered");
  if (offered) {
    // the world waits for an answer: pause, and show what either answer leads to
    speed = 0;
    post({ type: "speed", speed });
    forecast(Number(offered.data?.mission));
  }
  if (res.events.some(isTerminal) && (!r.ending || r.state.day <= DAYS)) {
    r.ending = resolveEnding(r.state, r.events, r.metrics);
    post({ type: "ending", ending: r.ending });
    speed = 0;
    post({ type: "speed", speed });
    void save(true);
  } else if (r.state.day % SNAPSHOT_EVERY === 0) void save(true);
}

// ───────────────────────── forecasts ─────────────────────────

function summarize(label: string, fromDay: number, state: WorldState, events: WorldEvent[], metrics: DailyMetrics[], ending: string | null): BranchSummary {
  const after = events.filter((e) => e.day > fromDay);
  const count = (t: string) => after.filter((e) => e.type === t).length;
  const deaths = (cause: string) => after.filter((e) => e.type === "life.death" && e.data?.cause === cause).length;
  const foodPeak: Record<number, number> = {};
  const population: Record<number, number> = {};
  for (const c of state.civs) {
    let peak = 0;
    for (const stId of c.settlements) peak = Math.max(peak, state.markets[stId]?.price.food ?? 0);
    foodPeak[c.id] = peak;
    population[c.id] = state.citizens.reduce((a, z) => a + (z.alive && c.settlements.includes(z.settlement) ? 1 : 0), 0);
  }
  // peak food price over the horizon from the daily metrics is global; per-civ peaks come from end state and spike events
  for (const e of after) if (e.type === "econ.price_spike" && e.data?.good === "food" && e.settlement !== undefined) {
    const civ = state.settlements[e.settlement]?.civ;
    if (civ !== undefined) foodPeak[civ] = Math.max(foodPeak[civ] ?? 0, Number(e.data.price));
  }
  void metrics;
  return {
    label,
    days: state.day - fromDay,
    deaths: count("life.death"),
    battleDeaths: deaths("battle"),
    starved: deaths("starvation"),
    raids: count("war.raid"),
    wars: count("war.declared"),
    conquests: count("war.conquest"),
    successions: count("civ.succession") + count("civ.coup"),
    maxRisk: Math.max(...state.civs.map((c) => c.tech.machineAutonomyRisk)),
    foodPeak,
    population,
    ending,
    notable: after.filter((e) => e.importance >= 7 && e.type !== "story.mission_offered" && e.type !== "story.mission_expired").slice(0, 12),
  };
}

/** Replays both answers to an open mission FORECAST_DAYS ahead and posts the comparison. Never touches the live run. */
function forecast(missionId: number): void {
  if (!run) return;
  const r = run;
  const m = r.state.story.missions[missionId];
  if (!m || m.status !== "offered") return;
  const t0 = performance.now();
  const from = takeSnapshot(r.state);
  const toDay = Math.min(DAYS, r.state.day + FORECAST_DAYS);
  const branch = (accept: boolean, label: string): BranchSummary => {
    const iv: Intervention = { day: r.state.day + 1, type: "mission", mission: missionId, accept };
    const re = replay(from, [...r.interventions.filter((x) => x.day > r.state.day), iv], toDay);
    const terminal = re.events.some(isTerminal);
    const ending = terminal ? resolveEnding(re.state, r.events.concat(re.events), r.metrics.concat(re.metrics)).title : null;
    return summarize(label, r.state.day, re.state, re.events, re.metrics, ending);
  };
  const act = branch(true, "If you act");
  const ignore = branch(false, "If you do nothing");
  const f: Forecast = { mission: missionId, fromDay: r.state.day, horizon: toDay - r.state.day, act, ignore, ms: Math.round(performance.now() - t0) };
  post({ type: "forecast", forecast: f });
}

function tick(): void {
  if (!run || speed === 0) return;
  advance();
  schedule();
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (speed === 0 || !run) return;
  timer = setTimeout(tick, MS_PER_DAY[speed]);
}

// ───────────────────────── persistence ─────────────────────────

function toSaved(r: Run): SavedWorld {
  return {
    version: 3,
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    updatedAt: Date.now(),
    seed: r.state.seed,
    mode: r.state.mode,
    settings: r.settings,
    latest: r.state,
    snapshots: r.snapshots,
    events: r.events.filter((e) => e.importance >= 2),
    metrics: r.metrics,
    interventions: r.interventions,
    ending: r.ending,
    forkedFrom: r.forkedFrom,
    baseline: r.baseline,
  };
}

async function save(auto: boolean): Promise<void> {
  if (!run) return;
  const r = run;
  try {
    const rec = toSaved(r);
    await putWorld(rec);
    post({ type: "saved", id: r.id, name: r.name, day: r.state.day, updatedAt: rec.updatedAt, auto });
  } catch (e) {
    post({ type: "error", message: `Could not save: ${e instanceof Error ? e.message : String(e)}` });
  }
}

async function load(id: string): Promise<void> {
  const rec = await getWorld(id);
  if (!rec) {
    post({ type: "error", message: "That saved world no longer exists." });
    return;
  }
  if ((rec.version as number) !== 3 || (rec.latest.version as number) !== 3) {
    post({ type: "error", message: `"${rec.name}" was saved by an older build and cannot be opened. Delete it from the home page.` });
    return;
  }
  run = {
    id: rec.id,
    name: rec.name,
    createdAt: rec.createdAt,
    settings: rec.settings,
    state: rec.latest,
    snapshots: rec.snapshots,
    events: rec.events,
    metrics: rec.metrics,
    interventions: rec.interventions,
    ending: rec.ending,
    forkedFrom: rec.forkedFrom,
    lastMetrics: rec.metrics[rec.metrics.length - 1] ?? null,
    known: knownOf(rec.latest),
    baseline: (rec.baseline as Baseline | null) ?? null,
  };
  queued = [];
  peeking = false;
  announce(run);
}

function fork(day: number, name?: string): void {
  if (!run) return;
  const r = run;
  const from = snapshotBefore(r.snapshots, day);
  if (!from) return;
  const re = replay(from, r.interventions, day);
  const kept = r.events.filter((e) => e.day <= from.day).concat(re.events);
  const metrics = r.metrics.filter((m) => m.day <= from.day).concat(re.metrics);
  run = {
    id: newId(),
    name: name ?? `${r.name} · fork from day ${day}`,
    createdAt: Date.now(),
    settings: r.settings,
    state: re.state,
    snapshots: r.snapshots.filter((sn) => sn.day <= day).map((sn) => ({ day: sn.day, state: cloneState(sn.state) })),
    events: kept,
    metrics,
    interventions: r.interventions.filter((x) => x.day <= day),
    ending: null,
    forkedFrom: { id: r.id, name: r.name, day },
    lastMetrics: metrics[metrics.length - 1] ?? null,
    baseline: r.baseline, // the vision was shown at Day 0; a branch keeps it
    known: knownOf(re.state),
  };
  if (!run.snapshots.some((sn) => sn.day === day)) run.snapshots.push(takeSnapshot(run.state));
  queued = [];
  peeking = false;
  announce(run);
  void save(true);
}

function peek(day: number | null): void {
  if (!run) return;
  if (day === null || day >= run.state.day) {
    peeking = false;
    post({ type: "peek", frame: null });
    sendFrame(buildFrame(run.state, { stepMs: 0, events: [], metrics: run.lastMetrics, snapshotDays: run.snapshots.map((sn) => sn.day), known: run.known })); // redraw the present
    return;
  }
  const from = snapshotBefore(run.snapshots, day);
  if (!from) return;
  peeking = true;
  const re = replay(from, run.interventions, day);
  const m = run.metrics.find((x) => x.day === day) ?? null;
  const f = buildFrame(re.state, { stepMs: 0, events: [], metrics: m, snapshotDays: run.snapshots.map((sn) => sn.day) });
  post({ type: "peek", frame: f }, [f.citizens.buffer, f.buildings.buffer, f.businesses.buffer]);
}

function exportWorld(): void {
  if (!run) return;
  const data: WorldExport = {
    format: "545days-world",
    version: 1,
    name: run.name,
    seed: run.state.seed,
    settings: run.settings,
    day: run.state.day,
    interventions: run.interventions,
    latestHash: hashHex(run.state),
    ending: run.ending,
    exportedAt: Date.now(),
  };
  post({ type: "exported", data, filename: `${run.name.replace(/[^\w-]+/g, "_")}-day${run.state.day}.545days.json` });
}

function importWorld(data: WorldExport): void {
  if (data.format !== "545days-world") {
    post({ type: "imported", verified: false, message: "Not a 545 DAYS world file." });
    return;
  }
  const r = newRun(data.seed, { ...DEFAULT_SETTINGS, ...data.settings }, data.name);
  const re = replay(r.snapshots[0], data.interventions, data.day);
  r.state = re.state;
  r.events = re.events;
  r.metrics = re.metrics;
  r.interventions = data.interventions;
  r.lastMetrics = re.metrics[re.metrics.length - 1] ?? null;
  for (let d = SNAPSHOT_EVERY; d <= data.day; d += SNAPSHOT_EVERY) {
    const sn = replay(r.snapshots[0], data.interventions, d);
    r.snapshots.push({ day: d, state: sn.state });
  }
  if (re.events.some(isTerminal)) r.ending = resolveEnding(r.state, r.events, r.metrics);
  const verified = hashHex(r.state) === data.latestHash;
  run = r;
  queued = [];
  peeking = false;
  announce(run);
  void save(true);
  post({ type: "imported", verified, message: verified ? `Replayed ${data.day} days from seed ${data.seed}; the world matches the file exactly.` : `Replayed ${data.day} days from seed ${data.seed}, but the result differs from the file (the engine has changed since it was exported).` });
}

// ───────────────────────── messages ─────────────────────────

self.onmessage = async (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case "init": {
        const settings = { ...DEFAULT_SETTINGS, ...msg.settings };
        run = newRun(msg.seed, settings, msg.name ?? "");
        if (!run.name) run.name = run.state.settlements[0]?.name ?? `World ${msg.seed}`;
        queued = [];
        peeking = false;
        announce(run, true);
        break;
      }
      case "load": await load(msg.id); break;
      case "setSpeed":
        speed = msg.speed;
        post({ type: "speed", speed });
        schedule();
        break;
      case "stepOnce": advance(); break;
      case "intervene":
        queued.push(msg.intervention);
        if (speed === 0) advance();
        break;
      case "inspect": {
        const c = run?.state.citizens[msg.citizen];
        if (!c) break;
        const children = c.relationships.filter((r) => r.kind === "family" && run!.state.citizens[r.other]?.alive && run!.state.citizens[r.other].occupation === "child" && run!.state.citizens[r.other].home === c.home).map((r) => r.other);
        post({ type: "inspect", detail: { id: c.id, partner: c.partner, born: c.born, origin: c.origin, children, memories: c.memories.slice(-12).reverse(), beliefs: c.beliefs.map((b) => ({ ...b })), relationships: c.relationships.map((x) => ({ ...x })), skills: { ...c.skills }, hiredDay: c.hiredDay, hungryDays: c.hungryDays } });
        break;
      }
      case "save": await save(false); break;
      case "rename": if (run) { run.name = msg.name; await save(false); } break;
      case "fork": fork(msg.day, msg.name); break;
      case "restart": if (run) { const r = newRun(run.state.seed, run.settings, `${run.name} · restart`); r.baseline = run.baseline; queued = []; peeking = false; run = r; announce(run, true); } break;
      case "peek": peek(msg.day); break;
      case "export": exportWorld(); break;
      case "import": importWorld(msg.data); break;
      case "listSaves": post({ type: "saves", list: await listWorlds() }); break;
      case "deleteSave": await deleteWorld(msg.id); post({ type: "saves", list: await listWorlds() }); break;
      case "forecast": forecast(msg.mission); break;
    }
  } catch (e) {
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
