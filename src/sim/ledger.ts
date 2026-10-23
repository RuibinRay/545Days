/**
 * The only way money moves. Every transfer is integer cents, checked for sufficiency
 * at the source, and returned as a LedgerEntry so tests and the inspector can audit it.
 * Money is conserved: Σ balances === initialMoney + minted − burned (invariants.ts).
 */
import type { AccountRef, LedgerEntry, Money, WorldState } from "./types";

export class Ledger {
  entries: LedgerEntry[] = [];
  constructor(private readonly state: WorldState, private readonly day: number) {}

  balance(ref: AccountRef): Money {
    const s = this.state;
    switch (ref.kind) {
      case "citizen": return s.citizens[ref.id].wealth;
      case "business": return s.businesses[ref.id].cash;
      case "treasury": return s.civs[ref.id].treasury;
      default: return Number.MAX_SAFE_INTEGER;
    }
  }

  private add(ref: AccountRef, delta: Money): void {
    const s = this.state;
    switch (ref.kind) {
      case "citizen": s.citizens[ref.id].wealth += delta; break;
      case "business": s.businesses[ref.id].cash += delta; break;
      case "treasury": s.civs[ref.id].treasury += delta; break;
      case "mint": s.moneyMinted += -delta; break;   // taking from the mint creates money
      case "burn": s.moneyBurned += delta; break;    // paying the burn destroys money
    }
  }

  /** Moves up to `amount`; returns what actually moved (capped by the source balance). */
  transfer(from: AccountRef, to: AccountRef, amount: Money, reason: string): Money {
    if (!Number.isInteger(amount)) throw new Error(`non-integer transfer ${amount} (${reason})`);
    if (amount <= 0) return 0;
    const available = this.balance(from);
    const moved = Math.min(amount, Math.max(0, available));
    if (moved === 0) return 0;
    this.add(from, -moved);
    this.add(to, moved);
    this.entries.push({ day: this.day, from, to, amount: moved, reason });
    return moved;
  }
}

export const citizen = (id: number): AccountRef => ({ kind: "citizen", id });
export const business = (id: number): AccountRef => ({ kind: "business", id });
export const treasury = (id: number): AccountRef => ({ kind: "treasury", id });

export function totalMoney(s: WorldState): Money {
  let t = 0;
  for (const c of s.citizens) t += c.wealth;
  for (const b of s.businesses) t += b.cash;
  for (const c of s.civs) t += c.treasury;
  return t;
}
