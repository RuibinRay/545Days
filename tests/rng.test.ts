import { describe, expect, it } from "vitest";
import {
  createRngState,
  createRngStreams,
  nextFloat,
  nextGaussian,
  nextInt,
  nextU32,
  shuffle,
} from "../src/sim/rng";
import { RNG_STREAMS } from "../src/sim/types";

describe("rng determinism", () => {
  it("same seed and stream → identical sequence", () => {
    const a = createRngState(12345, "citizens");
    const b = createRngState(12345, "citizens");
    for (let i = 0; i < 10_000; i++) expect(nextU32(a)).toBe(nextU32(b));
  });

  it("different streams from one seed are independent", () => {
    const s = createRngStreams(777);
    const first = RNG_STREAMS.map((name) => nextU32(s[name]));
    expect(new Set(first).size).toBe(RNG_STREAMS.length);
  });

  it("consuming one stream does not change another (common random numbers)", () => {
    const base = createRngStreams(42);
    const touched = createRngStreams(42);
    for (let i = 0; i < 500; i++) nextU32(touched.citizens); // an "intervention" burns citizen randomness
    for (let i = 0; i < 100; i++) expect(nextU32(touched.weather)).toBe(nextU32(base.weather));
  });

  it("state is plain data and survives structuredClone + JSON", () => {
    const s = createRngState(9, "story");
    for (let i = 0; i < 7; i++) nextU32(s);
    const viaJson = JSON.parse(JSON.stringify(s));
    const viaClone = structuredClone(s);
    for (let i = 0; i < 50; i++) {
      const v = nextU32(s);
      expect(nextU32(viaJson)).toBe(v);
      expect(nextU32(viaClone)).toBe(v);
    }
  });

  it("nextInt stays in bounds; nextFloat in [0,1); gaussian centred", () => {
    const s = createRngState(1, "market");
    let sum = 0;
    for (let i = 0; i < 20_000; i++) {
      const n = nextInt(s, -3, 5);
      expect(n).toBeGreaterThanOrEqual(-3);
      expect(n).toBeLessThanOrEqual(5);
      const f = nextFloat(s);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      sum += nextGaussian(s, 50, 10);
    }
    expect(Math.abs(sum / 20_000 - 50)).toBeLessThan(0.5);
  });

  it("shuffle is deterministic for a seed", () => {
    const a = shuffle(createRngState(5, "worldgen"), [1, 2, 3, 4, 5, 6, 7, 8]);
    const b = shuffle(createRngState(5, "worldgen"), [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a).toEqual(b);
  });

  it("pins the first outputs so a future refactor cannot silently change every world", () => {
    const s = createRngState(545, "worldgen");
    const got = [nextU32(s), nextU32(s), nextU32(s)];
    expect(got).toMatchSnapshot();
  });
});
