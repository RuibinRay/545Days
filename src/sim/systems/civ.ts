/** Phase 5 — civilization (docs/03 §4): unrest, legitimacy, riots, the fiscal rule. The ruler agent is ruler.ts, war is war.ts. */
import { BASKET, ECON } from "../data/economy";
import { clampPct } from "../math";
import { nextInt } from "../rng";
import { GOODS } from "../types";
import type { WorldState } from "../types";

import { emit } from "./context";
import type { StepContext } from "./context";

export function civPhase(ctx: StepContext): void {
  const { s } = ctx;
  for (const st of s.settlements) {
    if (!st.alive) continue;
    const civ = s.civs[st.civ];
    const people = s.citizens.filter((c) => c.alive && c.settlement === st.id);
    st.population = people.length;
    if (people.length === 0) {
      st.unrest = 0;
      continue;
    }
    const adults = people.filter((c) => c.occupation !== "child" && c.occupation !== "retired");
    const unemployment = adults.length ? (100 * adults.filter((c) => c.occupation === "unemployed").length) / adults.length : 0;
    const hunger = people.reduce((a, c) => a + (100 - c.needs.food), 0) / people.length;
    const m = s.markets[st.id];
    let idx = 0;
    let baseIdx = 0;
    for (const g of GOODS) {
      idx += m.price[g] * BASKET[g];
      baseIdx += ECON.basePrice[g] * BASKET[g];
    }
    const priceIndex = Math.round((1000 * idx) / baseIdx);
    const raw = 0.4 * unemployment + 0.3 * hunger + 0.3 * Math.max(0, (priceIndex - 1000) / 20) + st.fear / 4 - civ.legitimacy / 4;
    st.unrest = clampPct(raw);
    st.housingShortage = people.filter((c) => c.home < 0).length;

    // riots after 20 days above 70
    st.unrestStreak = st.unrest > 70 ? st.unrestStreak + 1 : 0;
    const streak = st.unrestStreak;
    if (streak >= 20 && streak % 20 === 0) {
      const targets = s.businesses.filter((b) => b.alive && b.settlement === st.id);
      if (targets.length > 0) {
        const b = targets[nextInt(s.rng.civ, 0, targets.length - 1)];
        const bld = s.buildings[b.building];
        bld.condition = clampPct(bld.condition - 30);
        civ.legitimacy = clampPct(civ.legitimacy - 10);
        emit(ctx, { type: "civ.riot", importance: 7, settlement: st.id, civ: civ.id, businesses: [b.id], data: { unrest: st.unrest, condition: bld.condition }, causes: ["settlement.unrest"] });
      }
    }
  }
  for (const civ of s.civs) {
    if (!civ.alive) continue;
    fiscalRule(ctx, civ);
    if (civ.treasury < 0) civ.legitimacy = clampPct(civ.legitimacy - 2);
    else if (s.day % 30 === 0 && civ.legitimacy < 70) civ.legitimacy = clampPct(civ.legitimacy + 1);
  }
}

/**
 * Minimal treasury discipline until the ruler agent (M7): with under 15 days of spending in hand,
 * every budget is cut 10 % (never below 60 % of its Day-0 value) every 10 days and legitimacy
 * drops a point; with over 120 days in hand, cuts are reversed at the same pace.
 */
function fiscalRule(ctx: StepContext, civ: WorldState["civs"][number]): void {
  const { s } = ctx;
  if (s.day % 10 !== 0) return;
  const p = civ.policies;
  const base = civ.basePolicies;
  const dailySpend = p.researchBudget + p.healthBudget + p.officialWage * 3 + p.pension * 8 + p.welfare * 10 + p.militaryBudget;
  const daysInHand = dailySpend > 0 ? civ.treasury / dailySpend : 999;
  const keys: (keyof typeof p)[] = ["researchBudget", "healthBudget", "welfare", "pension", "officialWage", "militaryBudget"];
  if (daysInHand < 15) {
    let cut = false;
    const floorPct = daysInHand < 5 ? 0.3 : 0.6;
    for (const k of keys) {
      const floor = Math.floor(base[k] * floorPct);
      const next = Math.max(floor, Math.floor(p[k] * 0.9));
      if (next < p[k]) { p[k] = next; cut = true; }
    }
    if (cut) {
      civ.legitimacy = clampPct(civ.legitimacy - 1);
      emit(ctx, { type: "civ.budget_cut", importance: 4, civ: civ.id, data: { research: p.researchBudget, health: p.healthBudget, welfare: p.welfare }, causes: ["civ.treasury"] });
    }
  } else if (daysInHand > 120) {
    for (const k of keys) p[k] = Math.min(base[k], Math.floor(p[k] * 1.1) + 1);
  }
}
