import type { Building, Business, BusinessKind, Citizen, Disposition, Occupation, RngState, Trait } from "../types";
import { PUBLIC_BUSINESSES } from "../data/buildings";
import { chance, nextGaussian, nextInt, pick, shuffle } from "../rng";
import { personName } from "./names";

const TRAITS: Trait[] = ["ambitious", "cautious", "generous", "greedy", "curious", "secretive", "loyal", "rebellious", "frugal", "social"];

export const OCC_FOR_BUSINESS: Record<BusinessKind, Occupation> = {
  farm: "farmer",
  workshop: "worker",
  factory: "worker",
  market: "merchant",
  clinic: "doctor",
  lab: "scientist",
  power_plant: "engineer",
  barracks: "soldier",
};

const SKILL_FOR_OCC: Record<Occupation, keyof Citizen["skills"] | null> = {
  farmer: "farming",
  worker: "craft",
  merchant: "trade",
  engineer: "craft",
  scientist: "science",
  doctor: "care",
  official: "trade",
  soldier: "combat",
  ruler: "trade",
  unemployed: null,
  retired: null,
  child: null,
};

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/**
 * Creates `count` citizens with ids from `idStart`, fills business headcounts first, then assigns
 * the rest as ruler / officials / children / retired / unemployed. Everyone gets a home while
 * capacity lasts. The ruler is the first non-job role so every civ has one.
 */
export function generatePeople(
  count: number,
  rng: RngState,
  settlementId: number,
  buildings: Building[],
  businesses: Business[],
  used: Set<string>,
  idStart = 0,
  disposition: Disposition = "agrarian",
): Citizen[] {
  const citizens: Citizen[] = [];
  const houses = buildings.filter((b) => b.kind === "house");
  const townHall = buildings.find((b) => b.kind === "town_hall");
  const market = buildings.find((b) => b.kind === "market");
  const occupancy = new Map<number, number>();

  // job slots in deterministic order; leave room for the civic roles
  const children = Math.round(count * 0.15);
  const retired = Math.round(count * 0.08);
  const civic = 1 + Math.max(1, Math.round(count / 50)); // ruler + officials
  const jobsMax = Math.max(0, count - children - retired - civic - Math.round(count * 0.05)); // a few start unemployed
  const slots: { business: Business; occ: Occupation }[] = [];
  for (const biz of businesses) {
    for (let i = 0; i < biz.staffTarget; i++) if (slots.length < jobsMax) slots.push({ business: biz, occ: OCC_FOR_BUSINESS[biz.kind] });
  }
  const roles: { business: Business | null; occ: Occupation }[] = [];
  roles.push({ business: null, occ: "ruler" });
  for (let i = 1; i < civic; i++) roles.push({ business: null, occ: "official" });
  for (const s of slots) roles.push(s);
  for (let i = 0; i < children; i++) roles.push({ business: null, occ: "child" });
  for (let i = 0; i < retired; i++) roles.push({ business: null, occ: "retired" });
  while (roles.length < count) roles.push({ business: null, occ: "unemployed" });
  roles.length = count;
  // shuffle everyone except the ruler so the ruler is always id idStart (stable for the UI and tests)
  const rest = roles.slice(1);
  shuffle(rng, rest);
  roles.splice(1, roles.length - 1, ...rest);

  for (let i = 0; i < count; i++) {
    const role = roles[i];
    const occ = role.occ;
    const age =
      occ === "child" ? nextInt(rng, 6, 15) : occ === "retired" ? nextInt(rng, 66, 82) : occ === "ruler" ? nextInt(rng, 38, 64) : nextInt(rng, 19, 62);

    // home: first house with free capacity
    let home = -1;
    for (const h of houses) {
      const n = occupancy.get(h.id) ?? 0;
      if (n < h.capacity) {
        occupancy.set(h.id, n + 1);
        home = h.id;
        break;
      }
    }

    const traits: Trait[] = [];
    const pool = [...TRAITS];
    shuffle(rng, pool);
    traits.push(pool[0]);
    if (chance(rng, 0.5)) traits.push(pool[1]);
    if (occ === "ruler" && disposition === "martial" && !traits.includes("ambitious")) traits[0] = "ambitious";

    const skills = {
      farming: clampPct(nextGaussian(rng, 20, 10)),
      craft: clampPct(nextGaussian(rng, 20, 10)),
      science: clampPct(nextGaussian(rng, 15, 10)),
      trade: clampPct(nextGaussian(rng, 20, 10)),
      care: clampPct(nextGaussian(rng, 15, 10)),
      combat: clampPct(nextGaussian(rng, disposition === "martial" ? 25 : 12, 10)),
    };
    const primary = SKILL_FOR_OCC[occ];
    if (primary) skills[primary] = clampPct(nextGaussian(rng, occ === "soldier" && disposition === "martial" ? 72 : 65, 12));

    const workplaceBuilding =
      role.business ? role.business.building : (occ === "official" || occ === "ruler") && townHall ? townHall.id : -1;
    const marketBuilding = market ? market.id : -1;
    const id = idStart + i;

    const citizen: Citizen = {
      id,
      alive: true,
      name: personName(rng, used),
      age,
      traits,
      settlement: settlementId,
      home,
      workplace: role.business ? role.business.id : -1,
      occupation: occ,
      skills,
      wealth: Math.max(2000, Math.round(nextGaussian(rng, occ === "unemployed" || occ === "child" ? 15000 : occ === "ruler" ? 150000 : 50000, 18000))),
      foodStock: nextInt(rng, 3, 10),
      health: clampPct(nextGaussian(rng, occ === "retired" ? 65 : 85, 8)),
      infection: "none",
      infectionDay: -1,
      origin: settlementId,
      partner: -1,
      born: -1,
      needs: { food: nextInt(rng, 60, 95), shelter: home >= 0 ? 90 : 40, safety: 80, belonging: nextInt(rng, 50, 90) },
      weights: {
        income: clampPct(nextGaussian(rng, 50, 15)),
        needs: clampPct(nextGaussian(rng, 60, 10)),
        social: clampPct(nextGaussian(rng, 40, 15)),
        risk: clampPct(nextGaussian(rng, traits.includes("cautious") ? 70 : 45, 15)),
        cost: clampPct(nextGaussian(rng, 50, 10)),
      },
      goal: occ === "ruler" ? "lead" : pick(rng, ["survive", "save", "save", "start_business", "get_promoted", "research", "lead"] as const),
      memories: [],
      beliefs: [],
      relationships: [],
      // home → work (or town hall) → market → home. -1 legs are skipped by the renderer.
      itinerary: [home, workplaceBuilding, marketBuilding, home],
      action: "none",
      hungryDays: 0,
      hiredDay: role.business ? 0 : -1,
    };
    if (role.business) role.business.employees.push(id);
    citizens.push(citizen);
  }
  // private businesses belong to their first employee; clinic, lab, barracks and the power plant stay public
  for (const biz of businesses) {
    if (PUBLIC_BUSINESSES.includes(biz.kind)) continue;
    if (biz.employees.length > 0) biz.owner = biz.employees[0];
  }
  // households: the first two adults under a roof are partners; the children there are family to both
  const byHome = new Map<number, Citizen[]>();
  for (const c of citizens) if (c.home >= 0) byHome.set(c.home, [...(byHome.get(c.home) ?? []), c]);
  for (const house of byHome.values()) {
    const adults = house.filter((c) => c.occupation !== "child" && c.occupation !== "retired" && c.age >= 18 && c.age <= 60);
    if (adults.length >= 2 && chance(rng, 0.7)) {
      const [a, b] = adults;
      a.partner = b.id;
      b.partner = a.id;
      a.relationships.push({ other: b.id, affinity: nextInt(rng, 40, 80), kind: "partner" });
      b.relationships.push({ other: a.id, affinity: nextInt(rng, 40, 80), kind: "partner" });
    }
    for (const kid of house.filter((c) => c.occupation === "child"))
      for (const adult of adults.slice(0, 2)) {
        kid.relationships.push({ other: adult.id, affinity: 60, kind: "family" });
        adult.relationships.push({ other: kid.id, affinity: 70, kind: "family" });
      }
  }
  // a few starting friendships so "socialize" has somewhere to go
  for (const c of citizens) {
    for (let k = 0; k < 2; k++) {
      const other = citizens[nextInt(rng, 0, citizens.length - 1)];
      if (other.id === c.id || c.relationships.some((r) => r.other === other.id)) continue;
      c.relationships.push({ other: other.id, affinity: nextInt(rng, 10, 40), kind: "friend" });
      other.relationships.push({ other: c.id, affinity: nextInt(rng, 10, 40), kind: "friend" });
    }
  }
  return citizens;
}
