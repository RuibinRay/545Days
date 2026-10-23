/**
 * Snapshots, replay and serialisation (docs/02 "Snapshots and saves").
 * A snapshot is a full structuredClone of WorldState. Replay = snapshot + the interventions
 * recorded after it; it must reach the same hash as the original run (tests/engine.test.ts).
 */
import { step } from "./engine";
import type { DailyMetrics, Intervention, Snapshot, WorldEvent, WorldState } from "./types";

export const SNAPSHOT_EVERY = 30;

export function cloneState(s: WorldState): WorldState {
  return structuredClone(s);
}

export function takeSnapshot(s: WorldState): Snapshot {
  return { day: s.day, state: cloneState(s) };
}

/** The latest snapshot at or before `day`, or null. */
export function snapshotBefore(snapshots: Snapshot[], day: number): Snapshot | null {
  let best: Snapshot | null = null;
  for (const sn of snapshots) if (sn.day <= day && (!best || sn.day > best.day)) best = sn;
  return best;
}

/**
 * Re-runs the world from a snapshot to `toDay`, applying the recorded interventions on their days.
 * Returns a fresh state (the snapshot is not mutated) plus the events and metrics regenerated on the way.
 */
export function replay(
  from: Snapshot,
  interventions: Intervention[],
  toDay: number,
): { state: WorldState; events: WorldEvent[]; metrics: DailyMetrics[] } {
  const state = cloneState(from.state);
  const events: WorldEvent[] = [];
  const metrics: DailyMetrics[] = [];
  const byDay = new Map<number, Intervention[]>();
  for (const iv of interventions) if (iv.day > from.day && iv.day <= toDay) byDay.set(iv.day, [...(byDay.get(iv.day) ?? []), iv]);
  while (state.day < toDay) {
    const r = step(state, byDay.get(state.day + 1) ?? []);
    events.push(...r.events);
    metrics.push(r.metrics);
  }
  return { state, events, metrics };
}

// ───────────────────────── JSON export / import ─────────────────────────

const TYPED: (keyof WorldState["terrain"])[] = ["biome", "elevation", "moisture", "baseMoisture", "resource", "river", "riverNear", "owner"];

/** JSON-safe form: typed arrays become plain number arrays tagged with their kind. */
export function toPortable(s: WorldState): unknown {
  const terrain: Record<string, unknown> = { width: s.terrain.width, height: s.terrain.height };
  for (const k of TYPED) {
    const arr = s.terrain[k] as Uint8Array | Uint16Array;
    terrain[k] = { kind: arr.BYTES_PER_ELEMENT === 2 ? "u16" : "u8", data: Array.from(arr) };
  }
  return { ...s, terrain };
}

export function fromPortable(p: unknown): WorldState {
  const o = p as Record<string, unknown>;
  const t = o.terrain as Record<string, { kind: string; data: number[] } | number>;
  const terrain: Record<string, unknown> = { width: t.width, height: t.height };
  for (const k of TYPED) {
    const v = t[k] as { kind: string; data: number[] };
    terrain[k] = v.kind === "u16" ? Uint16Array.from(v.data) : Uint8Array.from(v.data);
  }
  return { ...(o as object), terrain } as unknown as WorldState;
}
