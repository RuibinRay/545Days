/**
 * World palette (DESIGN_SYSTEM.md). Placeholder procedural art uses only these ramps so the
 * real pixel-art pass at M8 can swap sheets without touching the renderer.
 */
export const PAL = {
  abyss: 0x0b1437,
  slate: 0x223052,
  river: 0x3b6ea5,
  riverLight: 0x6fa0d4,
  moss: 0x5e7a3a,
  mossDark: 0x3f5a2a,
  forest: 0x34542a,
  forestDark: 0x223d1c,
  field: 0xa7a24a,
  ash: 0x8c8378,
  ashDark: 0x6a635a,
  sand: 0xd9c18a,
  sandDark: 0xc4a96c,
  ivory: 0xf3eadb,
  ember: 0xf2c14e,
  rust: 0xc0512f,
  stone: 0x9a9aa0,
  stoneDark: 0x6c6c74,
  snow: 0xe8ecf2,
  desert: 0xd4b06e,
  desertDark: 0xb8944f,
} as const;

export const hex = (n: number): string => `#${n.toString(16).padStart(6, "0")}`;

/** Settlement territory colours for the political overlay (cycled by settlement id). */
export const TERRITORY = [0xf2c14e, 0x6fa0d4, 0xc0512f, 0x8fd18a, 0xd49bd6, 0xf0a060];
