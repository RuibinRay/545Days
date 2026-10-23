/**
 * Market clearing (M2, split out in M8): one good in one town per call — sellers are producers and
 * the market's own stock, buyers are households and businesses with inputs to buy; the granary
 * buys and sells by the civ's reserve rule. See docs/03 §3.
 */
import { BUILDING_BUSINESS, BUILDING_SIZE, BUSINESS_DEFAULTS, PUBLIC_BUSINESSES, STARTING_INVENTORY, zeroInventory } from "../../data/buildings";
import { ECON } from "../../data/economy";
import { business as bizRef, citizen as citRef, treasury as trRef } from "../../ledger";
import { clamp, clampPct, pct } from "../../math";
import type { Building, BuildingKind, Business, BusinessKind, Citizen, Good, MarketState, Occupation, WorldState } from "../../types";
import { GOODS } from "../../types";
import { buildable, findFootprint } from "../../worldgen/settlement";
import { remember, skillFor } from "../citizens";
import { emit } from "../context";
import type { StepContext } from "../context";
import { addCost, addRev } from "./books";

interface Buyer {
  kind: "citizen" | "business" | "treasury";
  id: number;
  want: number;
  got: number;
  /** who pays (a child's food is paid by an adult at home; the treasury for the public reserve) */
  payer: ReturnType<typeof citRef> | ReturnType<typeof bizRef> | ReturnType<typeof trRef>;
}
interface Seller {
  /** business id, or -1 for the public reserve (proceeds go to the treasury) */
  id: number;
  offer: number;
  sold: number;
}

function adultsByHome(s: WorldState): Map<number, Citizen> {
  const best = new Map<number, Citizen>();
  for (const c of s.citizens) {
    if (!c.alive || c.home < 0 || c.occupation === "child") continue;
    const cur = best.get(c.home);
    if (!cur || c.wealth > cur.wealth) best.set(c.home, c);
  }
  return best;
}

export function clear(ctx: StepContext, m: MarketState, good: Good): void {
  const { s, ledger } = ctx;
  const price = m.price[good];
  const base = ECON.basePrice[good];
  const buyers: Buyer[] = [];
  const sellers: Seller[] = [];

  // sellers: producers offer their product; when the price is weak they hold stock back and
  // sell only enough to cover payroll (a supply response, so a glut does not bankrupt them)
  const producers = s.businesses.filter((b) => b.alive && b.settlement === m.settlement && b.produces === good && b.inventory[good] > 0);
  // imports: the town's market sells what its caravans brought (trade.ts), at today's price, without holding back
  for (const b of s.businesses) if (b.alive && b.kind === "market" && b.settlement === m.settlement && b.inventory[good] > 0) sellers.push({ id: b.id, offer: b.inventory[good], sold: 0 });
  for (const b of producers) {
    let offer = b.inventory[good];
    if (price < pct(base, 90)) {
      // glut: each producer offers only its share of what buyers wanted yesterday (never less than
      // 95 % of it, so a weak price thins the market without starving it)
      const share = Math.ceil((Math.max(m.demanded[good], m.supplied[good]) * 0.95) / producers.length);
      offer = Math.min(offer, Math.max(1, share));
    }
    sellers.push({ id: b.id, offer, sold: 0 });
  }
  // the public food reserve: the treasury buys toward `foodReserveDays` of consumption and sells
  // when the stock is above target or food is dear (≥ 150 % of base) — the relief valve.
  // Other goods in the reserve (liquidated stock) are sold whenever there is any.
  const civId = s.settlements[m.settlement].civ;
  const civ = s.civs[civId];
  const pop = s.settlements[m.settlement].population || 1;
  // a warehouse doubles what the granary can hold and how fast it fills
  const warehouse = s.buildings.some((b) => b.alive && b.kind === "warehouse" && b.settlement === m.settlement);
  const reserveTarget = good === "food" ? civ.policies.foodReserveDays * pop * ECON.foodPerDay * (warehouse ? 2 : 1) : 0;
  // food: the granary sells into dear markets (≥ 150 % of base), or trickles out a surplus above
  // target (2 % a day) while the price is at least base — it never dumps on the farmers.
  if (m.reserve[good] > 0) {
    if (good !== "food") sellers.push({ id: -1, offer: m.reserve[good], sold: 0 });
    else if (price >= pct(base, 150)) sellers.push({ id: -1, offer: m.reserve[good], sold: 0 });
    else if (m.reserve[good] > reserveTarget && price >= base) sellers.push({ id: -1, offer: Math.max(1, Math.ceil((m.reserve[good] - reserveTarget) * 0.02)), sold: 0 });
  }

  // household demand
  const adults = adultsByHome(s);
  for (const c of s.citizens) {
    if (!c.alive || c.settlement !== m.settlement) continue;
    const payerC = c.occupation === "child" && c.wealth < price ? adults.get(c.home) ?? c : c;
    const budget = payerC.wealth;
    let want = 0;
    if (good === "food") {
      const scarce = (c.beliefs.find((b) => b.key === "food_is_scarce")?.strength ?? 50) > 65 ? 2 : 0;
      const cheap = price < pct(base, 70) ? 3 : 0; // stock up when food is cheap
      const dear = price > pct(base, 150) ? -2 : 0; // stretch the pantry when food is dear
      want = Math.min(3, Math.max(0, ECON.foodStockTarget + scarce + cheap + dear - c.foodStock));
      if (want > 0 && budget < price) {
        remember(c, { day: s.day, tag: "econ.food_unavailable", valence: -20 });
        want = 0;
      }
    } else if (good === "energy") {
      // comfort, not survival: households go without when energy is dear (shelter need suffers)
      want = price <= base * 2 && budget > price + m.price.food * 2 ? ECON.energyPerDay : 0;
      if (want > 0 && budget > m.price.food * 60) want += 1; // a comfortable household runs more appliances
      if (want > 0 && budget > m.price.food * 200) want += 1; // a rich one lights the whole house
    } else if (good === "materials") {
      want = (s.day + c.id) % ECON.materialsEveryDays === 0 && budget > price + m.price.food * 5 ? 1 : 0;
      // discretionary goods: households with savings buy a unit a day while goods are not dear; the rich buy two
      if (price <= base * 2 && budget > m.price.food * 30) want += 1;
      if (price <= base * 2 && budget > m.price.food * 200) want += 1;
    }
    want = Math.min(want, Math.floor(budget / price));
    if (want > 0) buyers.push({ kind: "citizen", id: c.id, want, got: 0, payer: citRef(payerC.id) });
  }

  // public reserve purchases: up to 2 % of target a day while below target and food is not dear
  const dailySpend = civ.policies.researchBudget + civ.policies.healthBudget + civ.policies.militaryBudget + civ.policies.officialWage * 3 + civ.policies.pension * 8 + civ.policies.welfare * 10;
  if (good === "food" && m.reserve.food < reserveTarget && price < pct(base, 130) && civ.treasury > dailySpend * 30) {
    const want = Math.min(Math.max(1, Math.ceil(reserveTarget * (warehouse ? 0.05 : 0.02))), reserveTarget - m.reserve.food, Math.floor(civ.treasury / price / 4));
    if (want > 0) buyers.push({ kind: "treasury", id: civId, want, got: 0, payer: trRef(civId) });
  }

  // business input demand: hold `inputReserveDays` of inputs at target output;
  // plus repairs — one unit of materials restores 10 condition once a building has worn below 90
  for (const b of s.businesses) {
    if (!b.alive || b.settlement !== m.settlement) continue;
    if (good === "materials") {
      const bld = s.buildings[b.building];
      if (bld.condition < 90 && b.cash > price * 3) buyers.push({ kind: "business", id: b.id, want: 1, got: 0, payer: bizRef(b.id) });
    }
    const per = b.inputs[good] ?? 0;
    if (per <= 0) continue;
    const dailyNeed = b.produces === "service" ? per : per * b.baseOutput * b.staffTarget;
    const target = dailyNeed * ECON.inputReserveDays;
    let want = Math.max(0, target - b.inventory[good]);
    want = Math.min(want, Math.floor(b.cash / price));
    if (want > 0) buyers.push({ kind: "business", id: b.id, want, got: 0, payer: bizRef(b.id) });
  }

  const demand = buyers.reduce((a, b) => a + b.want, 0);
  const supply = sellers.reduce((a, b) => a + b.offer, 0);
  const cleared = Math.min(demand, supply);

  if (cleared > 0) {
    // allocate to buyers: floor share, then leftovers in id order
    let left = cleared;
    if (demand > supply) {
      for (const b of buyers) { b.got = Math.floor((b.want * cleared) / demand); left -= b.got; }
      for (const b of buyers) { if (left <= 0) break; if (b.got < b.want) { b.got++; left--; } }
    } else for (const b of buyers) { b.got = b.want; }
    // allocate to sellers
    let toSell = buyers.reduce((a, b) => a + b.got, 0);
    if (supply > toSell) {
      let acc = 0;
      for (const sl of sellers) { sl.sold = Math.floor((sl.offer * toSell) / supply); acc += sl.sold; }
      let rem = toSell - acc;
      for (const sl of sellers) { if (rem <= 0) break; if (sl.sold < sl.offer) { sl.sold++; rem--; } }
    } else for (const sl of sellers) sl.sold = sl.offer;
    toSell = sellers.reduce((a, b) => a + b.sold, 0);

    // escrow: the settlement's market business (or the treasury when it has none)
    const marketBiz = s.businesses.find((b) => b.alive && b.settlement === m.settlement && b.kind === "market");
    const escrow = marketBiz ? bizRef(marketBiz.id) : trRef(civId);
    const fee = marketBiz ? ECON.marketFeePct : 0;

    let pool = 0;
    for (const b of buyers) {
      if (b.got === 0) continue;
      const due = b.got * price;
      const paid = ledger.transfer(b.payer, escrow, due, `buy ${good}`);
      if (paid < due) {
        // payer could not cover it after all (should be rare): scale the goods down
        b.got = Math.floor(paid / price);
      }
      pool += paid;
      if (b.kind === "citizen") {
        const c = s.citizens[b.id];
        if (good === "food") c.foodStock += b.got;
        else if (good === "energy") c.needs.shelter = clampPct(c.needs.shelter + 2);
        else if (good === "materials") c.needs.shelter = clampPct(c.needs.shelter + 10);
        ctx.visitedMarket.add(b.id);
      } else if (b.kind === "treasury") {
        m.reserve[good] += b.got;
      } else {
        const biz = s.businesses[b.id];
        const bld = s.buildings[biz.building];
        if (good === "materials" && bld.condition < 90 && b.want === 1 && !(biz.inputs.materials ?? 0)) {
          bld.condition = clampPct(bld.condition + 10 * b.got); // repair
        } else biz.inventory[good] += b.got;
        addCost(b.id, b.got * price);
      }
    }
    const delivered = buyers.reduce((a, b) => a + b.got, 0);
    // sellers hand over what was actually bought (re-allocate if a payer fell short)
    let shipped = 0;
    for (const sl of sellers) {
      const q = Math.min(sl.sold, delivered - shipped);
      sl.sold = q;
      shipped += q;
      if (sl.id >= 0) s.businesses[sl.id].inventory[good] -= q;
      else m.reserve[good] -= q;
    }
    let paidOut = 0;
    const salesTax = ledger.transfer(escrow, trRef(civId), pct(pool, ECON.salesTaxPct), "sales tax");
    paidOut += salesTax;
    for (const sl of sellers) {
      if (sl.sold === 0) continue;
      const gross = sl.sold * price;
      const net = gross - pct(gross, fee + ECON.salesTaxPct);
      const to = sl.id >= 0 ? bizRef(sl.id) : trRef(civId);
      const got = ledger.transfer(escrow, to, Math.min(net, pool - paidOut), `sell ${good}`);
      paidOut += got;
      if (sl.id >= 0) addRev(sl.id, got);
    }
    if (marketBiz) addRev(marketBiz.id, pool - paidOut); // fee + rounding stays with the market
    m.supplied[good] = shipped;
    m.demanded[good] = demand;
  } else {
    m.supplied[good] = 0;
    m.demanded[good] = demand;
  }

  // households that wanted energy and got none feel it
  if (good === "energy") {
    for (const b of buyers) if (b.kind === "citizen" && b.got === 0) s.citizens[b.id].needs.shelter = clampPct(s.citizens[b.id].needs.shelter - 2);
  }

  // price update
  let next = price;
  if (demand === 0 && supply === 0) next = price + Math.sign(base - price) * Math.max(1, pct(price, ECON.priceIdleDriftPct));
  else {
    const move = clamp(ECON.priceK * ((demand - supply) / Math.max(supply, 1)), -ECON.priceMaxDailyMovePct / 100, ECON.priceMaxDailyMovePct / 100);
    next = Math.round(price * (1 + move));
  }
  const floor = Math.max(1, pct(base, ECON.priceFloorPct));
  const ceil = pct(base, ECON.priceCeilPct);
  next = clamp(next, floor, ceil);
  if (next >= base * 2 && s.day - m.spikeDay[good] >= 30) {
    m.spikeDay[good] = s.day;
    emit(ctx, { type: "econ.price_spike", importance: 5, settlement: m.settlement, data: { good, price: next, base }, causes: ["market.demand", "market.supply"] });
    for (const c of s.citizens) if (c.alive && c.settlement === m.settlement && good === "food") remember(c, { day: s.day, tag: "econ.price_spike", valence: -15 });
  }
  m.price[good] = next;
}

// ───────────────────────── lifecycle: close, upgrade, hire, found ─────────────────────────

