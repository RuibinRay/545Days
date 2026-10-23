import type { RngState } from "../types";
import { pick } from "../rng";

// Invented syllable tables. Nothing here is a real place or a real person's name by design.
const FIRST = [
  "Ada", "Bram", "Cora", "Dael", "Elin", "Fenn", "Greta", "Hal", "Ilse", "Joss", "Kenji", "Lior",
  "Mara", "Nils", "Orla", "Pavel", "Quin", "Rosa", "Sten", "Tova", "Ulric", "Vera", "Wren", "Yusuf",
  "Zara", "Amos", "Beck", "Dilan", "Esme", "Faro", "Gwen", "Hugo", "Ines", "Kato", "Lena", "Milo",
  "Noor", "Otis", "Pia", "Rafe", "Sade", "Teo", "Una", "Vik", "Wilma", "Zed",
];
const LAST_A = ["Ash", "Bell", "Cald", "Dun", "Fair", "Grim", "Hol", "Kess", "Lind", "Mor", "Nor", "Oak", "Pell", "Ros", "Stan", "Thorn", "Vale", "Wick"];
const LAST_B = ["wood", "er", "well", "more", "by", "ridge", "ford", "ley", "stone", "mark", "fell", "wick"];
const TOWN_A = ["Ash", "Brae", "Cold", "Dun", "Elm", "Fal", "Glen", "Har", "Kel", "Lan", "Mere", "Nor", "Oss", "Pen", "Ren", "Stol", "Tarn", "Vey"];
const TOWN_B = ["ford", "mouth", "wick", "haven", "bridge", "hollow", "stead", "mere", "cross", "gate", "ley", "burn"];

export function personName(rng: RngState, used: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    const name = `${pick(rng, FIRST)} ${pick(rng, LAST_A)}${pick(rng, LAST_B)}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = `${pick(rng, FIRST)} ${pick(rng, LAST_A)}${pick(rng, LAST_B)} ${used.size}`;
  used.add(fallback);
  return fallback;
}

export function townName(rng: RngState): string {
  return `${pick(rng, TOWN_A)}${pick(rng, TOWN_B)}`;
}

import type { Disposition } from "../types";

export function civName(rng: RngState, town: string, disposition: Disposition = "agrarian"): string {
  switch (disposition) {
    case "martial": return pick(rng, [`Kingdom of ${town}`, `The ${town} Crown`, `${town} Dominion`]);
    case "scholarly": return pick(rng, [`${town} Academy`, `The ${town} Institute`, `Republic of ${town}`]);
    default: return pick(rng, [`Council of ${town}`, `${town} Assembly`, `The ${town} Compact`]);
  }
}

/** What the civ calls its ruler. */
export function rulerTitle(disposition: Disposition): string {
  return disposition === "martial" ? "King" : disposition === "scholarly" ? "Chancellor" : "Elder";
}
