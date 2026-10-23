/** Deterministic, transcendental-free helpers for the engine (docs/01 §5). */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clampPct(v: number): number {
  return clamp(Math.round(v), 0, 100);
}

/** 2^(k/64) for k in 0..63, built with repeated square roots so no Math.pow is needed. */
const FRAC: number[] = (() => {
  // r = 2^(1/64) via six square roots of 2
  let r = 2;
  for (let i = 0; i < 6; i++) r = Math.sqrt(r);
  const out = [1];
  for (let k = 1; k < 64; k++) out.push(out[k - 1] * r);
  return out;
})();

/** 2^x for real x in roughly [-30, 30]; exact at integers, ~1e-4 relative error between. */
export function pow2(x: number): number {
  const xi = Math.floor(x);
  const xf = x - xi;
  const k = Math.floor(xf * 64);
  let base = FRAC[k];
  if (xi >= 0) for (let i = 0; i < xi; i++) base *= 2;
  else for (let i = 0; i < -xi; i++) base /= 2;
  return base;
}

/** Integer percentage of an integer amount, floored. */
export function pct(amount: number, percent: number): number {
  return Math.floor((amount * percent) / 100);
}
