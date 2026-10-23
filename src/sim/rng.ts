/**
 * Seeded RNG with named streams (xoshiro128** over uint32, seeded via splitmix32).
 *
 * Why streams: a player intervention that consumes "citizens" randomness must not
 * change what the "weather" stream produces tomorrow. Each subsystem draws only
 * from its own stream (common random numbers). See docs/01 §5 and docs/06 §3.
 *
 * All functions mutate the passed RngState in place and are pure otherwise.
 */
import type { RngState, RngStream, RngStreams } from "./types";
import { RNG_STREAMS } from "./types";

/** FNV-1a 32-bit hash of a string; used to derive stream seeds from the world seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function splitmix32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

export function createRngState(seed: number, stream: string): RngState {
  const sm = splitmix32((seed ^ hashString(stream)) >>> 0);
  const s: RngState = [sm(), sm(), sm(), sm()];
  // xoshiro must not start all-zero; splitmix makes that astronomically unlikely, guard anyway.
  if ((s[0] | s[1] | s[2] | s[3]) === 0) s[0] = 1;
  return s;
}

export function createRngStreams(seed: number): RngStreams {
  const out = {} as RngStreams;
  for (const name of RNG_STREAMS) out[name] = createRngState(seed, name);
  return out;
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/** Next uint32 from a stream state. */
export function nextU32(s: RngState): number {
  const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0;
  const t = (s[1] << 9) >>> 0;
  s[2] = (s[2] ^ s[0]) >>> 0;
  s[3] = (s[3] ^ s[1]) >>> 0;
  s[1] = (s[1] ^ s[2]) >>> 0;
  s[0] = (s[0] ^ s[3]) >>> 0;
  s[2] = (s[2] ^ t) >>> 0;
  s[3] = rotl(s[3], 11);
  return result;
}

/** Uniform float in [0, 1). 24 bits of precision is plenty for game decisions. */
export function nextFloat(s: RngState): number {
  return (nextU32(s) >>> 8) / 16777216;
}

/** Uniform integer in [min, max] inclusive. */
export function nextInt(s: RngState, min: number, max: number): number {
  const span = max - min + 1;
  return min + (nextU32(s) % span);
}

/** True with probability p (0..1). */
export function chance(s: RngState, p: number): boolean {
  return nextFloat(s) < p;
}

export function pick<T>(s: RngState, arr: readonly T[]): T {
  return arr[nextInt(s, 0, arr.length - 1)];
}

/** Fisher–Yates in place. */
export function shuffle<T>(s: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = nextInt(s, 0, i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Approximately normal sample via sum of 4 uniforms (Irwin–Hall), scaled.
 * Deterministic and transcendental-free, which Box–Muller is not.
 */
export function nextGaussian(s: RngState, mean: number, sd: number): number {
  const u = nextFloat(s) + nextFloat(s) + nextFloat(s) + nextFloat(s); // mean 2, var 1/3
  return mean + (u - 2) * sd * 1.7320508; // sqrt(3) scales var to 1
}

export function streamOf(streams: RngStreams, name: RngStream): RngState {
  return streams[name];
}
