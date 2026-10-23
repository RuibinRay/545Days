/**
 * Phase 2c — migration (M6, households since M7). RNG stream: citizens. A working-age adult who has
 * been hungry for three days in a town where food costs at least twice its base may leave for the
 * town with the cheapest food among those not at war with theirs and not closed to migrants
 * (quarantine or `borders`). The household goes together: partner and children under the same roof.
 * They arrive jobless and, if the houses are full, homeless — but alive.
 */
import { ECON } from "../data/economy";
import { nextFloat } from "../rng";
import { emit } from "./context";
import type { StepContext } from "./context";
import { relocateHousehold } from "./society";

export function migrationPhase(ctx: StepContext): void {
  const { s } = ctx;
  if (s.settlements.filter((st) => st.alive).length < 2) return;
  const rng = s.rng.citizens;
  const moved = new Set<number>();
  const turnedAway = new Map<number, number>();
  for (const c of s.citizens) {
    if (!c.alive || moved.has(c.id) || c.hungryDays < 3 || c.occupation === "child" || c.occupation === "retired" || c.occupation === "ruler" || c.occupation === "official" || c.occupation === "soldier") continue;
    const from = s.settlements[c.settlement];
    const fromCiv = s.civs[from.civ];
    const here = s.markets[from.id]?.price.food ?? ECON.basePrice.food;
    if (here < ECON.basePrice.food * 2) continue;
    if (nextFloat(rng) > 0.15) continue;
    let best: { id: number; price: number } | null = null;
    let closed = -1;
    for (const st of s.settlements) {
      if (!st.alive || st.id === from.id) continue;
      const civ = s.civs[st.civ];
      if (civ.id !== fromCiv.id && (civ.id in fromCiv.wars)) continue;
      if (civ.policies.quarantine >= 100) continue;
      const price = s.markets[st.id]?.price.food ?? ECON.basePrice.food;
      if (price >= here * 0.6) continue;
      if (civ.id !== fromCiv.id && civ.policies.borders >= 100) { closed = civ.id; continue; }
      if (!best || price < best.price) best = { id: st.id, price };
    }
    if (!best) {
      if (closed >= 0) turnedAway.set(closed, (turnedAway.get(closed) ?? 0) + 1);
      continue;
    }
    const to = s.settlements[best.id];
    for (const p of relocateHousehold(ctx, c, to, "needs.food")) moved.add(p.id);
  }
  // the turned-away are counted once a day per closed civ, so the chronicle can say who shut the gate on whom
  for (const [civId, n] of turnedAway) {
    if (s.day % 10 !== 0) break;
    emit(ctx, { type: "civ.turned_away", importance: 4, civ: civId, data: { people: n }, causes: ["civ.borders", "needs.food"] });
  }
}
