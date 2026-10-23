import { totalMoney } from "./ledger";
import type { WorldState } from "./types";
import { GOODS } from "./types";

/** Returns a list of violations (empty = healthy). Used by tests and dev builds (docs/03 §6). */
export function checkInvariants(s: WorldState): string[] {
  const out: string[] = [];
  const expected = s.initialMoney + s.moneyMinted - s.moneyBurned;
  const actual = totalMoney(s);
  if (actual !== expected) out.push(`money not conserved: ${actual} !== ${expected} (day ${s.day})`);
  for (const c of s.citizens) {
    if (!Number.isInteger(c.wealth) || c.wealth < 0) out.push(`citizen ${c.id} wealth ${c.wealth}`);
    if (c.foodStock < 0) out.push(`citizen ${c.id} foodStock ${c.foodStock}`);
    for (const k of ["food", "shelter", "safety", "belonging"] as const)
      if (c.needs[k] < 0 || c.needs[k] > 100) out.push(`citizen ${c.id} need ${k} ${c.needs[k]}`);
    if (c.health < 0 || c.health > 100) out.push(`citizen ${c.id} health ${c.health}`);
    if (c.alive && c.workplace >= 0) {
      const b = s.businesses[c.workplace];
      if (!b || !b.alive) out.push(`citizen ${c.id} works at dead business ${c.workplace}`);
      else if (!b.employees.includes(c.id)) out.push(`citizen ${c.id} not in employees of ${b.id}`);
    }
    if (c.memories.length > 24) out.push(`citizen ${c.id} memories ${c.memories.length}`);
  }
  for (const b of s.businesses) {
    if (!Number.isInteger(b.cash) || b.cash < 0) out.push(`business ${b.id} cash ${b.cash}`);
    for (const g of GOODS) if (b.inventory[g] < 0 || !Number.isInteger(b.inventory[g])) out.push(`business ${b.id} inventory ${g} ${b.inventory[g]}`);
    if (b.alive) for (const id of b.employees) if (!s.citizens[id]?.alive || s.citizens[id].workplace !== b.id) out.push(`business ${b.id} lists ${id} who does not work there`);
  }
  for (const c of s.civs) if (!Number.isInteger(c.treasury)) out.push(`civ ${c.id} treasury ${c.treasury}`);
  for (const m of s.markets) for (const g of GOODS) if (m.price[g] <= 0 || !Number.isInteger(m.price[g])) out.push(`market ${m.settlement} price ${g} ${m.price[g]}`);
  return out;
}
