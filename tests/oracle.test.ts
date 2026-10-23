/** M4b — the Oracle: the baseline is the untouched world, visions come from it, divergence measures the difference. */
import { describe, expect, it } from "vitest";
import { generateWorld } from "../src/sim/worldgen";
import { step } from "../src/sim/engine";
import { hashHex } from "../src/sim/hash";
import { computeBaseline, divergence, visionFragments } from "../src/sim/story/oracle";
import type { DailyMetrics, Intervention, WorldEvent } from "../src/sim/types";

const BIG = { civs: 3 as const, population: 100, size: "medium" as const };

describe("M4b — the Oracle's baseline", () => {
  const w0 = generateWorld(31337, BIG);
  const baseline = computeBaseline(w0);

  it("costs under 5 s cold (≈ 0.6 s warm in Node; measured in the browser in PROJECT_REVIEWS) and leaves the live state untouched", () => {
    expect(baseline.ms).toBeLessThan(5000);
    expect(w0.day).toBe(0);
    expect(baseline.endingTitle.length).toBeGreaterThan(3);
    expect(baseline.hashes.length).toBeGreaterThanOrEqual(18);
    expect(baseline.metrics.length).toBe(baseline.endingDay);
  });

  it("hash-matches a no-intervention live run at every 30-day mark", () => {
    const live = generateWorld(31337, BIG);
    for (const h of baseline.hashes) {
      while (live.day < h.day) step(live);
      expect(hashHex(live), `day ${h.day}`).toBe(h.hash);
    }
  });

  it("one intervention diverges only after its day", () => {
    const live = generateWorld(31337, BIG);
    const ruler = live.civs.find((c) => c.disposition === "martial")!.ruler;
    const iv: Intervention = { day: 91, type: "remove_citizen", citizen: ruler };
    const events: WorldEvent[] = [];
    const metrics: DailyMetrics[] = [];
    for (let d = 1; d <= 180; d++) {
      const r = step(live, d === 91 ? [iv] : []);
      events.push(...r.events);
      metrics.push(r.metrics);
      const mark = baseline.hashes.find((h) => h.day === d);
      if (mark) {
        if (d < 91) expect(hashHex(live), `day ${d}`).toBe(mark.hash);
        else expect(hashHex(live), `day ${d}`).not.toBe(mark.hash);
      }
    }
    const before = divergence(baseline, metrics, events, 60);
    const after = divergence(baseline, metrics, events, 180);
    expect(before.score).toBe(0);
    expect(before.missing).toEqual([]);
    expect(before.unforeseen).toEqual([]);
    expect(after.score).toBeGreaterThan(0);
  });

  it("writes visions from the baseline: one per dramatic event, the ending last, cryptic by default", () => {
    const visions = visionFragments(baseline, w0, "cryptic");
    expect(visions.length).toBeGreaterThanOrEqual(1);
    expect(visions.length).toBeLessThanOrEqual(4);
    const last = visions[visions.length - 1];
    expect(last.source.type).toBe("ending");
    for (const v of visions) {
      expect(v.cryptic.length).toBeGreaterThan(20);
      expect(v.clear.length).toBeGreaterThan(10);
      if (v.source.type !== "ending") {
        const src = v.source as { type: string; day: number };
        expect(baseline.events.some((e) => e.type === src.type && e.day === src.day)).toBe(true);
        expect(v.cryptic).not.toContain(`Day ${src.day}`); // the cryptic line never gives the day away
      }
    }
    expect(visionFragments(baseline, w0, "off")).toEqual([]);
    const clear = visionFragments(baseline, w0, "clear");
    expect(clear[clear.length - 1].cryptic).toBe(clear[clear.length - 1].clear);
  });

  it("is a pure function of the state: same world → same baseline", () => {
    const again = computeBaseline(generateWorld(31337, BIG));
    expect(again.endingId).toBe(baseline.endingId);
    expect(again.hashes).toEqual(baseline.hashes);
    expect(again.events.length).toBe(baseline.events.length);
  });
});
