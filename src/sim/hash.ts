import type { WorldState } from "./types";

/** FNV-1a over a string, continuing from `h`. */
function fnvString(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fnvBytes(h: number, a: Uint8Array | Uint16Array): number {
  for (let i = 0; i < a.length; i++) {
    h ^= a[i] & 0xff;
    h = Math.imul(h, 0x01000193);
    if (a.BYTES_PER_ELEMENT === 2) {
      h ^= a[i] >>> 8;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/**
 * Deterministic 32-bit hash of the whole world state. Typed arrays are hashed
 * bytewise; everything else via JSON (key order is construction order, which is
 * itself deterministic). Used by determinism, replay and Worker-vs-main tests.
 */
export function hashState(s: WorldState): number {
  let h = 0x811c9dc5;
  const t = s.terrain;
  for (const layer of [t.biome, t.elevation, t.moisture, t.resource, t.river, t.owner]) h = fnvBytes(h, layer);
  const json = JSON.stringify(s, (key, value) => (key === "terrain" ? undefined : value));
  return fnvString(h, json);
}

export function hashHex(s: WorldState): string {
  return hashState(s).toString(16).padStart(8, "0");
}
