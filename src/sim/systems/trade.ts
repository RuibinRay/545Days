/**
 * Phase 4c — trade between towns (M7). RNG stream: market.
 *
 * Real goods move. Each day, for every pair of towns that may trade (same civilization, or two
 * civilizations whose relations are `trade`; neither quarantined; not at war) and every good, the
 * importing town's market business compares prices: when the good costs `tradeMargin` more at home
 * than in the other town, its merchants buy up to a fifth of the exporter's producer stock there,
 * at the exporter's price, from the market's own cash, and a caravan sets out. It arrives after
 * distance / caravanSpeed days; the goods go into the market's inventory and are sold at the home
 * market like any producer's (economy.ts lists market businesses with stock as sellers). Goods
 * from another civilization pay a tariff to the destination's treasury on arrival.
 *
 * So trade is self-limiting: it narrows the price gap that created it, the importer only buys
 * what it can pay for, and the exporter keeps most of its stock. A caravan from a town where the
 * fever is among the merchants can bring it along (health.ts does the rest).
 */
import { SOCIETY } from "../data/economy";
import { business as bizRef, treasury as trRef } from "../ledger";
import { nextFloat } from "../rng";
import type { Business, Caravan, Civilization, Good, Settlement, WorldState } from "../types";
import { GOODS } from "../types";
import { emit } from "./context";
import type { StepContext } from "./context";
import { infect } from "./health";
import { roadBetween } from "../worldgen/roads";

/** The settlement's market business, if it has one. */
export function marketOf(s: WorldState, settlement: number): Business | null {
  for (const b of s.businesses) if (b.alive && b.kind === "market" && b.settlement === settlement) return b;
  return null;
}

/** Whether goods may move between two towns today. */
export function canTrade(s: WorldState, from: Settlement, to: Settlement, good?: Good): boolean {
  if (!from.alive || !to.alive || from.id === to.id) return false;
  const ca: Civilization = s.civs[from.civ];
  const cb: Civilization = s.civs[to.civ];
  if (!ca.alive || !cb.alive) return false;
  if (ca.policies.quarantine >= 100 || cb.policies.quarantine >= 100) return false;
  if (ca.id === cb.id) return true;
  if (cb.id in ca.wars) return false;
  if (good === "food" && ca.policies.exportBan >= 100) return false;
  return ca.relations[cb.id] === "trade" && cb.relations[ca.id] === "trade";
}

export function distance(a: Settlement, b: Settlement): number {
  return Math.sqrt((a.cx - b.cx) * (a.cx - b.cx) + (a.cy - b.cy) * (a.cy - b.cy));
}

/** Tiles a caravan travels: the road when there is one, else the straight line (by boat). */
export function tripLength(s: WorldState, a: Settlement, b: Settlement): number {
  const r = roadBetween(s.roads, a.id, b.id);
  return r ? r.tiles.length - 1 : distance(a, b);
}

export function tradePhase(ctx: StepContext): void {
  const { s, ledger } = ctx;
  // arrivals
  const arrived: Caravan[] = [];
  const still: Caravan[] = [];
  for (const cv of s.caravans) (cv.arriveDay <= s.day ? arrived : still).push(cv);
  s.caravans = still;
  for (const cv of arrived) {
    const to = s.settlements[cv.to];
    const merchant = s.businesses[cv.merchant];
    const toCiv = s.civs[to.civ];
    const fromCiv = s.civs[s.settlements[cv.from].civ];
    if (!to.alive || !merchant.alive) {
      // nobody to receive it: the goods go to the town's public reserve (a conquered or closed market)
      if (to.alive) s.markets[cv.to].reserve[cv.good] += cv.qty;
      continue;
    }
    merchant.inventory[cv.good] += cv.qty;
    ctx.tradeArrived += cv.qty;
    toCiv.tradeIn += cv.qty;
    fromCiv.tradeOut += cv.qty;
    if (toCiv.id !== fromCiv.id) {
      const value = cv.qty * s.markets[cv.to].price[cv.good];
      ledger.transfer(bizRef(merchant.id), trRef(toCiv.id), Math.min(merchant.cash, Math.floor((value * SOCIETY.tariffPct) / 100)), "tariff");
    }
    // the merchants learn the road
    for (const id of merchant.employees) { const c = s.citizens[id]; if (c.alive && (s.day + c.id) % 3 === 0) c.skills.trade = Math.min(100, c.skills.trade + 1); }
    emit(ctx, { type: "trade.arrived", importance: 2, settlement: cv.to, civ: toCiv.id, businesses: [merchant.id], data: { good: cv.good, qty: cv.qty, from: s.settlements[cv.from].name, to: to.name, paid: cv.paid }, causes: ["market.price", "trade.route"] });
  }

  // departures
  const alive = s.settlements.filter((st) => st.alive && st.population > 0);
  for (const to of alive) {
    const merchant = marketOf(s, to.id);
    if (!merchant) continue;
    const working = merchant.employees.some((id) => s.citizens[id].alive && s.citizens[id].action === "work");
    if (!working) continue;
    const mTo = s.markets[to.id];
    for (const from of alive) {
      if (!canTrade(s, from, to)) continue;
      const mFrom = s.markets[from.id];
      const days = Math.max(1, Math.ceil(tripLength(s, from, to) / SOCIETY.caravanSpeed));
      for (const good of GOODS) {
        if (mTo.price[good] < mFrom.price[good] * SOCIETY.tradeMargin) continue;
        if (!canTrade(s, from, to, good)) continue; // a grain ban stops food, not cloth or coal
        // one caravan per route and good every few days
        if (s.caravans.some((cv) => cv.from === from.id && cv.to === to.id && cv.good === good && s.day - cv.departDay < SOCIETY.tradeEveryDays)) continue;
        // what the exporter's producers can spare
        const producers = s.businesses.filter((b) => b.alive && b.settlement === from.id && b.produces === good && b.inventory[good] > 0);
        let available = 0;
        for (const b of producers) available += Math.floor(b.inventory[good] * SOCIETY.tradeShare);
        if (available <= 0) continue;
        // what the importer wants: a day of its town's demand, and what it can pay for
        const want = Math.max(1, mTo.demanded[good] || Math.ceil(to.population / 2));
        const budget = Math.max(0, merchant.cash - merchant.wage * Math.max(1, merchant.employees.length) * 10);
        let qty = Math.min(available, want, Math.floor(budget / mFrom.price[good]));
        if (qty <= 0) continue;
        // buy from each producer in proportion, in id order
        let paid = 0;
        let bought = 0;
        for (const b of producers) {
          if (bought >= qty) break;
          const take = Math.min(Math.floor(b.inventory[good] * SOCIETY.tradeShare), qty - bought);
          if (take <= 0) continue;
          const due = take * mFrom.price[good];
          const got = ledger.transfer(bizRef(merchant.id), bizRef(b.id), due, `export ${good}`);
          const units = Math.floor(got / mFrom.price[good]);
          if (units <= 0) continue;
          b.inventory[good] -= units;
          bought += units;
          paid += got;
        }
        if (bought <= 0) continue;
        qty = bought;
        const cv: Caravan = { id: s.nextCaravanId++, from: from.id, to: to.id, good, qty, departDay: s.day, arriveDay: s.day + days, merchant: merchant.id, paid };
        s.caravans.push(cv);
        const first = !s.story.fired.some((f) => f.id === `trade.route@${Math.min(from.id, to.id)}-${Math.max(from.id, to.id)}`);
        if (first) {
          s.story.fired.push({ id: `trade.route@${Math.min(from.id, to.id)}-${Math.max(from.id, to.id)}`, day: s.day });
          emit(ctx, { type: "trade.route_opened", importance: 5, settlement: to.id, civ: to.civ, data: { from: from.name, to: to.name, good, qty, days }, causes: ["market.price", "civ.relations"] });
        }
        emit(ctx, { type: "trade.caravan", importance: 2, settlement: from.id, civ: to.civ, businesses: [merchant.id], data: { good, qty, from: from.name, to: to.name, days, paid }, causes: ["market.price"] });
        // the fever travels with the cargo (stream: market, so the weather and the citizens are untouched)
        const sickMerchants = s.businesses.filter((b) => b.alive && b.kind === "market" && b.settlement === from.id).flatMap((b) => b.employees).filter((id) => s.citizens[id].alive && (s.citizens[id].infection === "sick" || s.citizens[id].infection === "incubating")).length;
        if (sickMerchants > 0 && nextFloat(s.rng.market) < SOCIETY.caravanInfectRate * sickMerchants) {
          const victim = merchant.employees.map((id) => s.citizens[id]).find((c) => c.alive && c.infection === "none");
          if (victim && infect(s, victim)) emit(ctx, { type: "health.carried", importance: 4, settlement: to.id, civ: to.civ, citizens: [victim.id], data: { from: from.name }, causes: ["trade.caravan", "health.outbreak"] });
        }
      }
    }
  }
}
