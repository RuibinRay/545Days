import type { CitizenDetail, Forecast, MainToWorker, RenderFrame, Speed, WorkerToMain, WorldInfo } from "../workers/protocol";
import type { Baseline, Vision } from "../sim/story/oracle";
import type { DailyMetrics, EndingResult, Intervention, SavedSummary, WorldEvent, WorldExport, WorldSettings } from "../sim/types";

type Listener = {
  world?: (info: WorldInfo) => void;
  frame?: (frame: RenderFrame) => void;
  peek?: (frame: RenderFrame | null) => void;
  speed?: (speed: Speed) => void;
  inspect?: (detail: CitizenDetail) => void;
  ending?: (ending: EndingResult) => void;
  forecast?: (forecast: Forecast) => void;
  oracle?: (baseline: Baseline, visions: Vision[], fresh: boolean) => void;
  saved?: (info: { id: string; name: string; day: number; updatedAt: number; auto: boolean }) => void;
  saves?: (list: SavedSummary[]) => void;
  exported?: (data: WorldExport, filename: string) => void;
  imported?: (verified: boolean, message: string) => void;
  error?: (message: string) => void;
};

/** Thin main-thread wrapper over the sim Worker. Keeps the histories the panels read. */
export class SimClient {
  private worker: Worker;
  private listeners: Listener = {};
  info: WorldInfo | null = null;
  frame: RenderFrame | null = null;
  speed: Speed = 0;
  metrics: DailyMetrics[] = [];
  events: WorldEvent[] = [];
  interventions: Intervention[] = [];
  ending: EndingResult | null = null;
  snapshotDays: number[] = [];
  foodPrices: { day: number; price: number }[] = [];
  /** The forecast for the currently open mission, if any. */
  forecast: Forecast | null = null;
  baseline: Baseline | null = null;
  visions: Vision[] = [];

  constructor() {
    this.worker = new Worker(new URL("../workers/sim.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const m = ev.data;
      switch (m.type) {
        case "world":
          this.info = m.info;
          this.events = m.history.events;
          this.metrics = m.history.metrics;
          this.interventions = m.history.interventions;
          this.ending = m.history.ending;
          this.snapshotDays = m.history.snapshotDays;
          this.foodPrices = [];
          this.baseline = null;
          this.visions = [];
          this.listeners.world?.(m.info);
          break;
        case "frame": {
          this.frame = m.frame;
          const f = m.frame;
          // the world grew: people born, towns founded, land claimed
          if (f.delta && this.info) {
            for (const c of f.delta.citizens) this.info.citizens[c.id] = c;
            for (const st of f.delta.settlements) this.info.settlements[st.id] = st;
            if (f.delta.owner) this.info.owner = f.delta.owner;
            if (f.delta.roads) this.info.roads = f.delta.roads;
          }
          this.snapshotDays = f.snapshotDays;
          if (this.metrics.length === 0 || f.day > this.metrics[this.metrics.length - 1].day) this.metrics.push(f.metrics);
          else if (f.day === 0 && this.metrics.length === 0) this.metrics.push(f.metrics);
          const lastP = this.foodPrices[this.foodPrices.length - 1];
          if (!lastP || f.day > lastP.day) this.foodPrices.push({ day: f.day, price: f.markets[0]?.price.food ?? 0 });
          this.events.push(...f.events);
          if (f.applied.length) this.interventions.push(...f.applied);
          this.listeners.frame?.(f);
          break;
        }
        case "peek": this.listeners.peek?.(m.frame); break;
        case "inspect": this.listeners.inspect?.(m.detail); break;
        case "speed": this.speed = m.speed; this.listeners.speed?.(m.speed); break;
        case "ending": this.ending = m.ending; this.listeners.ending?.(m.ending); break;
        case "forecast": this.forecast = m.forecast; this.listeners.forecast?.(m.forecast); break;
        case "oracle": this.baseline = m.baseline; this.visions = m.visions; this.listeners.oracle?.(m.baseline, m.visions, m.fresh); break;
        case "saved": this.listeners.saved?.(m); break;
        case "saves": this.listeners.saves?.(m.list); break;
        case "exported": this.listeners.exported?.(m.data, m.filename); break;
        case "imported": this.listeners.imported?.(m.verified, m.message); break;
        case "error": this.listeners.error?.(m.message); break;
      }
    };
    this.worker.onerror = (e) => this.listeners.error?.(e.message);
  }

  on(l: Listener): void {
    this.listeners = { ...this.listeners, ...l };
  }

  private send(msg: MainToWorker): void {
    this.worker.postMessage(msg);
  }

  init(seed: number, settings: Partial<WorldSettings>, name?: string): void { this.send({ type: "init", seed, settings, name }); }
  load(id: string): void { this.send({ type: "load", id }); }
  setSpeed(speed: Speed): void { this.send({ type: "setSpeed", speed }); }
  stepOnce(): void { this.send({ type: "stepOnce" }); }
  intervene(intervention: Intervention): void { this.send({ type: "intervene", intervention }); }
  inspect(citizen: number): void { this.send({ type: "inspect", citizen }); }
  save(): void { this.send({ type: "save" }); }
  rename(name: string): void { this.send({ type: "rename", name }); }
  fork(day: number, name?: string): void { this.send({ type: "fork", day, name }); }
  restart(): void { this.send({ type: "restart" }); }
  peek(day: number | null): void { this.send({ type: "peek", day }); }
  export(): void { this.send({ type: "export" }); }
  import(data: WorldExport): void { this.send({ type: "import", data }); }
  listSaves(): void { this.send({ type: "listSaves" }); }
  deleteSave(id: string): void { this.send({ type: "deleteSave", id }); }
  requestForecast(mission: number): void { this.send({ type: "forecast", mission }); }
  answerMission(mission: number, accept: boolean): void { this.forecast = null; this.intervene({ day: 0, type: "mission", mission, accept }); }

  destroy(): void {
    this.worker.terminate();
  }
}
