/**
 * Field vitals (M9). A static site has no server to report to, so the page measures its own Core
 * Web Vitals with `web-vitals` and keeps them in memory; the ?why panel shows them and a button
 * copies a plain-text report the player can paste into an issue. Nothing leaves the browser on its
 * own. These are the numbers the design asked to be measured "in the field, not estimated".
 */
import { onCLS, onINP, onLCP, onFCP, onTTFB } from "web-vitals";
import type { Metric } from "web-vitals";

export interface Vitals {
  LCP?: number;
  INP?: number;
  CLS?: number;
  FCP?: number;
  TTFB?: number;
  /** web-vitals' own rating for each metric. */
  rating: Partial<Record<"LCP" | "INP" | "CLS" | "FCP" | "TTFB", Metric["rating"]>>;
}

const vitals: Vitals = { rating: {} };
const listeners = new Set<(v: Vitals) => void>();
let started = false;

function take(m: Metric): void {
  const k = m.name as keyof Vitals["rating"];
  (vitals as unknown as Record<string, unknown>)[k] = m.value;
  vitals.rating[k] = m.rating;
  for (const l of listeners) l({ ...vitals, rating: { ...vitals.rating } });
}

/** Starts measuring once per page; later calls are no-ops. */
export function startVitals(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  try {
    // reportAllChanges: a single-page app that never hides would otherwise never hear LCP or CLS
    onLCP(take, { reportAllChanges: true });
    onINP(take, { reportAllChanges: true });
    onCLS(take, { reportAllChanges: true });
    onFCP(take, { reportAllChanges: true });
    onTTFB(take, { reportAllChanges: true });
  } catch { /* an environment without PerformanceObserver: nothing to measure */ }
}

export function currentVitals(): Vitals { return { ...vitals, rating: { ...vitals.rating } }; }

export function onVitals(l: (v: Vitals) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Thresholds Google publishes for "good" (p75): LCP 2.5 s, INP 200 ms, CLS 0.1. */
export const GOOD = { LCP: 2500, INP: 200, CLS: 0.1, FCP: 1800, TTFB: 800 } as const;

export function fmtVital(k: keyof typeof GOOD, v: number | undefined): string {
  if (v === undefined) return "–";
  return k === "CLS" ? v.toFixed(3) : `${Math.round(v)} ms`;
}

/** A plain-text report for a bug or a review: metrics, their ratings, and the device as the browser describes it. */
export function vitalsReport(extra: Record<string, string | number | undefined> = {}): string {
  const v = currentVitals();
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const lines = [
    `545 DAYS — performance report (${new Date().toISOString()})`,
    ...(["LCP", "INP", "CLS", "FCP", "TTFB"] as const).map((k) => `${k}: ${fmtVital(k, v[k])}${v.rating[k] ? ` (${v.rating[k]})` : ""}  good ≤ ${k === "CLS" ? GOOD[k] : `${GOOD[k]} ms`}`),
    `cores: ${nav?.hardwareConcurrency ?? "?"} · dpr: ${typeof window !== "undefined" ? window.devicePixelRatio : "?"} · viewport: ${typeof window !== "undefined" ? `${window.innerWidth}×${window.innerHeight}` : "?"}`,
    `ua: ${nav?.userAgent ?? "?"}`,
    ...Object.entries(extra).filter(([, val]) => val !== undefined).map(([k, val]) => `${k}: ${val}`),
  ];
  return lines.join("\n");
}
