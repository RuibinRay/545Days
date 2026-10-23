/**
 * EndingResolver (docs/07). At Day 545 — or earlier when the world ends — evaluates every ending
 * definition against the actual state and picks the best fit; when none applies, writes the
 * fallback epilogue, "The Unfinished Age", from the world's own numbers and names.
 *
 * M3 shipped the resolver, the fallback variants and the extinction terminal. M4 registers the
 * first designed endings that the civ systems make reachable: The Scorched Border (conquest),
 * The Long Peace (several civs, no war) and Machine Dominion (automation risk ≥ 85). Red Plague
 * and Great Drought follow with their systems.
 */
import { ECON } from "../data/economy";
import type { DailyMetrics, EndingResult, WorldEvent, WorldState } from "../types";

export type { EndingResult };

export type EndingFamily = EndingResult["family"];

export interface EndingDefinition {
  id: string;
  title: string;
  family: EndingFamily;
  severity: 1 | 2 | 3 | 4 | 5;
  /** True when the ending's conditions hold. */
  eligible: (ctx: ResolveContext) => boolean;
  /** 0..100 — among eligible endings the highest wins. */
  score: (ctx: ResolveContext) => number;
  epilogue: (ctx: ResolveContext) => string[];
}

export interface ResolveContext {
  state: WorldState;
  events: WorldEvent[];
  metrics: DailyMetrics[];
  last: DailyMetrics;
  /** Mean of a metric over the final 90 days (or all, if fewer). */
  recent: (k: keyof DailyMetrics) => number;
  count: (type: string) => number;
}

export const ENDINGS: EndingDefinition[] = [];

/** Registers a designed ending. */
export function registerEnding(def: EndingDefinition): void {
  if (!ENDINGS.some((e) => e.id === def.id)) ENDINGS.push(def);
}

function money(c: number): string {
  return `$${Math.round(c / 100).toLocaleString()}`;
}

/** One paragraph on what the player did with the Oracle's offers; empty when there were none. */
function missionsParagraph(ctx: ResolveContext): string {
  const ms = ctx.state.story.missions;
  if (ms.length === 0) return "";
  const accepted = ms.filter((m) => m.status === "accepted");
  const ignored = ms.filter((m) => m.status === "declined" || m.status === "expired");
  const parts: string[] = [];
  parts.push(`The Oracle made ${ms.length} offer${ms.length === 1 ? "" : "s"}; ${accepted.length} ${accepted.length === 1 ? "was" : "were"} taken${ignored.length ? ` and ${ignored.length} let pass` : ""}.`);
  if (accepted.length) parts.push(`By your hand: ${accepted.map((m) => m.title.toLowerCase()).slice(0, 4).join("; ")}${accepted.length > 4 ? "; and more" : ""}.`);
  return parts.join(" ");
}

// ───────────────────────── designed endings (M4) ─────────────────────────

registerEnding({
  id: "war.scorched_border",
  title: "The Scorched Border",
  family: "politics",
  severity: 4,
  eligible: (ctx) => ctx.count("war.conquest") > 0,
  score: (ctx) => Math.min(100, 50 + 25 * ctx.count("war.conquest") + ctx.count("war.raid")),
  epilogue: (ctx) => {
    const { state } = ctx;
    const conquests = ctx.events.filter((e) => e.type === "war.conquest");
    const first = conquests[0];
    const conqueror = state.civs[first.civ ?? 0];
    const fallen = String(first.data?.fallen ?? "a neighbour");
    const townName = String(first.data?.town ?? "a town");
    const raids = ctx.count("war.raid");
    const battleDead = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "battle").length;
    const wars = ctx.count("war.declared");
    const soldiers = state.citizens.filter((c) => c.alive && c.occupation === "soldier").length;
    const ruins = state.buildings.filter((b) => b.alive && b.kind === "ruin").length;
    return [
      `On day ${first.day} the soldiers of ${conqueror.name} took ${townName}, and ${fallen} ${first.data?.civAlive ? "lost its first town" : "ceased to exist"}. ${conquests.length > 1 ? `${conquests.length - 1} more town${conquests.length > 2 ? "s" : ""} changed hands before the count ended.` : "It was the only conquest of the count, and it was enough."}`,
      `${wars} war${wars === 1 ? "" : "s"} were declared and ${raids} raid${raids === 1 ? "" : "s"} fought. ${battleDead} people died in battle. ${ruins} building${ruins === 1 ? " stands" : "s stand"} in ruins; ${soldiers} soldier${soldiers === 1 ? "" : "s"} still draw pay.`,
      `${conqueror.name} ends the count ${conqueror.form === "autocracy" ? "under its " + (conqueror.ruler >= 0 ? state.citizens[conqueror.ruler].name : "crown") : "as a " + conqueror.form} with ${money(conqueror.treasury)} in the treasury and legitimacy ${conqueror.legitimacy}. The border it drew is black with ash, and the people on the wrong side of it remember.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "politics.long_peace",
  title: "The Long Peace",
  family: "politics",
  severity: 1,
  eligible: (ctx) => {
    const civs = ctx.state.civs.filter((c) => c.alive);
    if (civs.length < 2 || ctx.count("war.declared") > 0 || ctx.count("civ.riot") > 0) return false;
    return civs.every((a) => civs.every((b) => a.id === b.id || (a.attitude[b.id] ?? 0) >= 20));
  },
  score: (ctx) => Math.min(100, 40 + Math.round(ctx.recent("avgWellbeing") / 2)),
  epilogue: (ctx) => {
    const { state } = ctx;
    const civs = state.civs.filter((c) => c.alive);
    const names = civs.map((c) => c.name);
    const trade = civs.flatMap((a) => civs.filter((b) => b.id !== a.id && a.relations[b.id] === "trade").map(() => 1)).length / 2;
    const research = civs.map((c) => `${c.name} (${c.researchFocus} ${c.tech[c.researchFocus]})`).join(", ");
    return [
      `Five hundred and forty-five days, ${civs.length} nations, and not one war. ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} kept their soldiers at home and their borders where they were.`,
      `${trade} pair${trade === 1 ? "" : "s"} of them trade openly. Their labs worked on: ${research}. ${state.citizens.filter((c) => c.alive).length} of the ${ctx.metrics[0]?.population ?? state.citizens.length} who began are still here.`,
      `Nothing in the record says the peace was planned. It held because nobody saw a profit in breaking it — and because, when someone might have, they did not.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

// ───────────── society (M7) ─────────────

function startPop(ctx: ResolveContext): number { return ctx.metrics[0]?.population ?? ctx.state.citizens.length; }
function civStart(ctx: ResolveContext, civId: number): number {
  const { state } = ctx;
  return state.civs[civId].settlements.reduce((a, id) => a + (state.story.startPopulation[id] ?? 0), 0) || 1;
}
function civPop(ctx: ResolveContext, civId: number): number {
  return ctx.state.citizens.filter((c) => c.alive && ctx.state.civs[civId].settlements.includes(c.settlement)).length;
}
function homelessOf(ctx: ResolveContext, civId: number): number {
  return ctx.state.citizens.filter((c) => c.alive && c.home < 0 && ctx.state.civs[civId].settlements.includes(c.settlement)).length;
}

registerEnding({
  id: "society.chosen_city",
  title: "The Chosen City",
  family: "society",
  severity: 1,
  eligible: (ctx) => ctx.state.civs.some((c) => c.alive && c.migrantsIn >= 8 && civPop(ctx, c.id) >= civStart(ctx, c.id) * 1.1 && homelessOf(ctx, c.id) <= 2 && c.policies.borders < 100),
  score: (ctx) => {
    const best = ctx.state.civs.filter((c) => c.alive).sort((a, b) => b.migrantsIn - a.migrantsIn)[0];
    return Math.min(100, 45 + best.migrantsIn + Math.round(ctx.recent("avgWellbeing") / 4));
  },
  epilogue: (ctx) => {
    const { state } = ctx;
    const civ = state.civs.filter((c) => c.alive).sort((a, b) => b.migrantsIn - a.migrantsIn)[0];
    const town = state.settlements[civ.settlements[0]];
    const from = state.civs.filter((c) => c.id !== civ.id && c.migrantsOut > 0).map((c) => c.name);
    const births = civ.births;
    return [
      `They came to ${town.name} on foot, ${civ.migrantsIn} of them over the ${state.day} days, from ${from.length ? from.join(" and ") : "the hungry towns"}. ${civ.name} kept its gate open when it would have been easier not to.`,
      `The town grew from ${civStart(ctx, civ.id)} to ${civPop(ctx, civ.id)} people; ${births} of them were born here. ${homelessOf(ctx, civ.id) === 0 ? "Nobody sleeps outside tonight." : `${homelessOf(ctx, civ.id)} still sleep outside.`} The newcomers work the farms and the market stalls, and their children will not remember the road.`,
      `Elsewhere the record is thinner. ${state.civs.filter((c) => c.alive && c.id !== civ.id).map((c) => `${c.name} ${c.policies.borders >= 100 ? "shut its gates" : "kept its own"} and has ${civPop(ctx, c.id)} people`).join("; ")}.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "society.great_exodus",
  title: "The Great Exodus",
  family: "society",
  severity: 4,
  eligible: (ctx) => ctx.state.civs.some((c) => c.migrantsOut >= civStart(ctx, c.id) * 0.3) || ctx.state.settlements.some((st) => st.alive && st.parent < 0 && st.population <= (ctx.state.story.startPopulation[st.id] ?? 1) * 0.5 && ctx.state.civs[st.civ].migrantsOut >= 10),
  score: (ctx) => {
    const worst = ctx.state.civs.slice().sort((a, b) => b.migrantsOut / civStart(ctx, b.id) - a.migrantsOut / civStart(ctx, a.id))[0];
    // an exodus the drought caused is the drought's story; one caused by war or a shut gate is its own
    const droughtDriven = ctx.state.story.fired.some((f) => f.id.startsWith("gd.second_drought@"));
    return Math.min(100, Math.round((150 * worst.migrantsOut) / civStart(ctx, worst.id)) + ctx.count("civ.turned_away") * 2 - (droughtDriven ? 35 : 0));
  },
  epilogue: (ctx) => {
    const { state } = ctx;
    const civ = state.civs.slice().sort((a, b) => b.migrantsOut / civStart(ctx, b.id) - a.migrantsOut / civStart(ctx, a.id))[0];
    const town = state.settlements[civ.settlements[0]];
    const hosts = state.civs.filter((c) => c.id !== civ.id && c.migrantsIn > 0).sort((a, b) => b.migrantsIn - a.migrantsIn);
    const turned = ctx.count("civ.turned_away");
    const starved = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "starvation").length;
    return [
      `${town.name} is ${civPop(ctx, civ.id) === 0 ? "empty" : "quiet"}. Of the ${civStart(ctx, civ.id)} people who began under ${civ.name}, ${civ.migrantsOut} walked away with what they could carry${starved ? ` and ${starved} died of hunger before they could` : ""}. ${civPop(ctx, civ.id)} remain.`,
      hosts.length ? `${hosts.map((h) => `${h.name} took in ${h.migrantsIn}`).join("; ")}.${turned ? ` ${turned} time${turned === 1 ? "" : "s"} a gate was shut on people who had nowhere else to go.` : ""}` : `No nation took them in; they scattered along the roads.`,
      `The farms of ${town.name} ${state.businesses.filter((b) => b.alive && b.kind === "farm" && civ.settlements.includes(b.settlement)).length ? "still stand" : "are gone"}; food there costs ${Math.round((100 * (state.markets[town.id]?.price.food ?? 0)) / ECON.basePrice.food)}% of its old price. Nobody decided the exodus. It was a thousand households deciding, one at a time, that the road was better than the morning.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "society.founders",
  title: "The Founders",
  family: "society",
  severity: 1,
  eligible: (ctx) => ctx.state.civs.some((c) => c.alive && c.settlements.filter((id) => ctx.state.settlements[id].alive && ctx.state.settlements[id].parent >= 0 && ctx.state.settlements[id].population >= 12).length >= 1 && civPop(ctx, c.id) >= civStart(ctx, c.id) && Object.keys(c.wars).length === 0),
  score: (ctx) => {
    const colonies = ctx.state.settlements.filter((st) => st.alive && st.parent >= 0);
    return Math.min(100, 35 + colonies.reduce((a, st) => a + st.population, 0) + ctx.state.civs.filter((c) => c.alive).reduce((a, c) => a + c.births, 0) / 2);
  },
  epilogue: (ctx) => {
    const { state } = ctx;
    const colonies = state.settlements.filter((st) => st.alive && st.parent >= 0);
    const byCiv = state.civs.filter((c) => c.alive && c.settlements.length > 1);
    return [
      `${colonies.length} new town${colonies.length === 1 ? "" : "s"} stand${colonies.length === 1 ? "s" : ""} where there was grass on Day 0: ${colonies.map((st) => `${st.name}, founded on day ${st.foundedDay} from ${state.settlements[st.parent].name}, ${st.population} people`).join("; ")}.`,
      `${byCiv.map((c) => `${c.name} grew from ${civStart(ctx, c.id)} to ${civPop(ctx, c.id)}, ${c.births} of them born on the way`).join("; ")}. ${state.caravans.length} caravan${state.caravans.length === 1 ? " is" : "s are"} on the roads tonight.`,
      `A town is founded by whoever has nowhere else to sleep. The first settlers were the homeless and the jobless of the old town; the record does not say they were grateful, only that they stayed.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "politics.iron_council",
  title: "The Iron Council",
  family: "politics",
  severity: 3,
  eligible: (ctx) => ctx.state.civs.some((c) => c.alive && c.closedDays >= 120 && c.policies.borders >= 100 && c.legitimacy >= 50 && civPop(ctx, c.id) >= civStart(ctx, c.id) * 0.9),
  score: (ctx) => {
    const c = ctx.state.civs.filter((c) => c.alive).sort((a, b) => b.closedDays - a.closedDays)[0];
    return Math.min(100, 30 + Math.round(c.closedDays / 5) + ctx.count("civ.turned_away") * 3);
  },
  epilogue: (ctx) => {
    const { state } = ctx;
    const c = state.civs.filter((c) => c.alive).sort((a, b) => b.closedDays - a.closedDays)[0];
    const town = state.settlements[c.settlements[0]];
    const turned = ctx.events.filter((e) => e.type === "civ.turned_away" && e.civ === c.id).reduce((a, e) => a + Number(e.data?.people ?? 0), 0);
    const ruler = c.ruler >= 0 ? state.citizens[c.ruler].name : "the council";
    return [
      `The gate of ${town.name} has been shut for ${c.closedDays} of the ${state.day} days. ${c.name} kept its ${civPop(ctx, c.id)} people fed (${Math.round((100 * (state.markets[town.id]?.price.food ?? 0)) / ECON.basePrice.food)}% of base for bread), its beds full and its wages up — and ${turned} people outside it.`,
      `Legitimacy ${c.legitimacy}; ${ruler} has never been more popular. ${c.policies.exportBan >= 100 ? "No grain leaves the town either." : `Its merchants still trade: ${c.tradeOut} units out, ${c.tradeIn} in.`}`,
      `The other nations: ${state.civs.filter((o) => o.alive && o.id !== c.id).map((o) => `${o.name} has ${civPop(ctx, o.id)} of its ${civStart(ctx, o.id)} and ${o.migrantsOut} of them left`).join("; ")}. The wall worked. The record does not say for whom.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "politics.merchant_road",
  title: "The Merchant Road",
  family: "politics",
  severity: 1,
  eligible: (ctx) => {
    const civs = ctx.state.civs.filter((c) => c.alive);
    if (civs.length < 2) return false;
    const lateWar = ctx.events.some((e) => e.type === "war.declared" && e.day >= 300);
    const pairs = civs.flatMap((a) => civs.filter((b) => b.id > a.id && a.relations[b.id] === "trade" && b.relations[a.id] === "trade")).length;
    const units = civs.reduce((a, c) => a + c.tradeIn, 0);
    return !lateWar && pairs >= 2 && units >= 1000;
  },
  score: (ctx) => Math.min(100, 45 + Math.round(ctx.state.civs.reduce((a, c) => a + c.tradeIn, 0) / 60) - ctx.count("war.declared") * 10),
  epilogue: (ctx) => {
    const { state } = ctx;
    const civs = state.civs.filter((c) => c.alive);
    const routes = state.story.fired.filter((f) => f.id.startsWith("trade.route@")).length;
    const units = civs.reduce((a, c) => a + c.tradeIn, 0);
    const wars = ctx.count("war.declared");
    const tariffs = civs.map((c) => `${c.name} (${c.tradeIn} in, ${c.tradeOut} out)`).join(", ");
    return [
      `${routes} road${routes === 1 ? "" : "s"} between the towns, and ${units} cartloads along them: ${tariffs}. ${wars ? `There ${wars === 1 ? "was one war" : `were ${wars} wars`} early on; none after day 300.` : "Not one war."}`,
      `Grain went where bread was dear and came back as cloth and coal. ${state.civs.filter((c) => c.alive && c.policies.exportBan >= 100).length ? `${state.civs.filter((c) => c.alive && c.policies.exportBan >= 100).map((c) => c.name).join(" and ")} still ban${state.civs.filter((c) => c.alive && c.policies.exportBan >= 100).length === 1 ? "s" : ""} exports tonight — old habits.` : "No council bans exports tonight."} ${state.citizens.filter((c) => c.alive).length} of the ${startPop(ctx)} who began are here, and ${civs.reduce((a, c) => a + c.births, 0)} more who were born.`,
      `Peace held because every council had a merchant at its ear. It is not the noblest reason. It is the one that lasts.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

// ───────────── M10: the remaining design-doc endings the systems reach ─────────────

function plagueDead(ctx: ResolveContext): number { return ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "plague").length; }
function starvedCount(ctx: ResolveContext): number { return ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "starvation").length; }
function fired(ctx: ResolveContext, prefix: string): boolean { return ctx.state.story.fired.some((f) => f.id.startsWith(prefix)); }
function recentMean(ctx: ResolveContext, k: "unemployment" | "births", days: number): number {
  const tail = ctx.metrics.slice(-days);
  return tail.length ? tail.reduce((a, m) => a + Number(m[k] ?? 0), 0) / tail.length : 0;
}

registerEnding({
  id: "tech.divided_humanity",
  title: "The Divided Humanity",
  family: "technology",
  severity: 2,
  // 06: one nation of machines, one of hands, and a cold border between them
  eligible: (ctx) => {
    const civs = ctx.state.civs.filter((c) => c.alive);
    return civs.some((a) => a.tech.automation >= 60 && civs.some((b) => b.id !== a.id && b.tech.automation <= 25 && (a.attitude[b.id] ?? 0) <= -40 && (b.attitude[a.id] ?? 0) <= -40 && !ctx.state.story.fired.some((f) => f.id === `trade.route@${Math.min(a.settlements[0], b.settlements[0])}-${Math.max(a.settlements[0], b.settlements[0])}`)));
  },
  score: (ctx) => {
    const civs = ctx.state.civs.filter((c) => c.alive);
    const hi = civs.sort((a, b) => b.tech.automation - a.tech.automation)[0];
    const lo = civs[civs.length - 1];
    return Math.min(100, 40 + (hi.tech.automation - lo.tech.automation) / 2 + Math.max(0, -(hi.attitude[lo.id] ?? 0)) / 4);
  },
  epilogue: (ctx) => {
    const { state } = ctx;
    const civs = state.civs.filter((c) => c.alive).sort((a, b) => b.tech.automation - a.tech.automation);
    const hi = civs[0];
    const lo = civs[civs.length - 1];
    const wars = ctx.events.filter((e) => e.type === "war.declared" && ((e.civ === hi.id && e.data?.otherCiv === lo.id) || (e.civ === lo.id && e.data?.otherCiv === hi.id))).length;
    return [
      `${hi.name} runs on machines (automation ${hi.tech.automation}, ${hi.tech.industry} industry); ${lo.name} on hands (automation ${lo.tech.automation}). Between them, attitude ${hi.attitude[lo.id] ?? 0} and ${lo.attitude[hi.id] ?? 0}, ${wars ? `${wars} war${wars === 1 ? "" : "s"}` : "no war"} — and not one caravan in ${state.day} days.`,
      `${state.settlements[hi.settlements[0]].name} has ${civPop(ctx, hi.id)} people, ${hi.policies.oversight} oversight and a machine risk of ${hi.tech.machineAutonomyRisk}. ${state.settlements[lo.settlements[0]].name} has ${civPop(ctx, lo.id)}, ${state.businesses.filter((b) => b.alive && b.kind === "farm" && lo.settlements.includes(b.settlement)).length} farms and a granary of ${state.markets[lo.settlements[0]]?.reserve.food ?? 0}.`,
      `Two ways of living, a day's walk apart, each certain the other is the warning.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "disease.quarantine_nations",
  title: "Quarantine Nations",
  family: "disease",
  severity: 3,
  // 09: the fever came, the gates shut, and stayed shut
  eligible: (ctx) => fired(ctx, "rp.index@") && ctx.state.civs.filter((c) => c.alive).every((c) => c.quarantineDays >= 60) && plagueDead(ctx) < startPop(ctx) * 0.08,
  score: (ctx) => Math.min(100, 45 + Math.round(ctx.state.civs.filter((c) => c.alive).reduce((a, c) => a + c.quarantineDays, 0) / 10)),
  epilogue: (ctx) => {
    const { state } = ctx;
    const civs = state.civs.filter((c) => c.alive);
    const dead = plagueDead(ctx);
    const units = civs.reduce((a, c) => a + c.tradeIn, 0);
    return [
      `The fever reached ${state.settlements.filter((st) => ctx.events.some((e) => e.type === "life.death" && e.data?.cause === "plague" && e.settlement === st.id)).map((st) => st.name).join(" and ") || "one town"} and killed ${dead}. Then every gate shut: ${civs.map((c) => `${c.name} for ${c.quarantineDays} days`).join(", ")}.`,
      `${units} units of goods moved by caravan in ${state.day} days — ${units < 300 ? "almost nothing" : "a trickle"}. Bread in ${civs.map((c) => `${state.settlements[c.settlements[0]].name} ${Math.round((100 * (state.markets[c.settlements[0]]?.price.food ?? 0)) / ECON.basePrice.food)} %`).join(", ")} of its old price. ${civs.filter((c) => c.policies.quarantine >= 100).length} of ${civs.length} nations are still closed tonight.`,
      `The sick were few because the roads were empty. So were the markets.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "disease.famine_fever",
  title: "The Famine Fever",
  family: "disease",
  severity: 5,
  // 12: the drought and the plague past their points of no return at once
  // both have to kill: a drought that only made people hungry while a fever passed is not this
  eligible: (ctx) => fired(ctx, "gd.second_drought@") && fired(ctx, "rp.cluster@") && plagueDead(ctx) >= startPop(ctx) * 0.04 && starvedCount(ctx) >= startPop(ctx) * 0.03,
  score: (ctx) => Math.min(100, 60 + Math.round((200 * (plagueDead(ctx) + starvedCount(ctx))) / startPop(ctx))),
  epilogue: (ctx) => {
    const { state } = ctx;
    const dead = plagueDead(ctx);
    const starved = starvedCount(ctx);
    const left = state.civs.reduce((a, c) => a + c.migrantsOut, 0);
    const worst = state.settlements.filter((st) => st.parent < 0).sort((a, b) => a.population / (state.story.startPopulation[a.id] || 1) - b.population / (state.story.startPopulation[b.id] || 1))[0];
    return [
      `The second drought and the fever arrived in the same season. ${starved} died of hunger and ${dead} of the fever; ${left} walked away. Rain stands at ${state.climate.rainfall}; ${state.citizens.filter((c) => c.alive && (c.infection === "sick" || c.infection === "incubating")).length} are still sick tonight.`,
      `${worst.name} is the emptiest: ${worst.population} of ${state.story.startPopulation[worst.id] ?? "?"}. The clinics had ${state.citizens.filter((c) => c.alive && c.occupation === "doctor").length} doctors between them and the granaries hold ${state.markets.reduce((a, m) => a + m.reserve.food, 0)} units of food.`,
      `A hungry body cannot fight a fever and a sick body cannot work a field. The world found this out one household at a time.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "politics.broken_crown",
  title: "The Broken Crown",
  family: "politics",
  severity: 3,
  // 20: a nation that cannot keep a ruler
  eligible: (ctx) => ctx.state.civs.some((c) => c.alive && (ctx.events.filter((e) => e.type === "civ.coup" && e.civ === c.id).length >= 2 || (ctx.events.filter((e) => (e.type === "civ.coup" || e.type === "civ.succession" || e.type === "civ.disappearance") && e.civ === c.id).length >= 3 && c.legitimacy <= 35))),
  score: (ctx) => {
    const c = ctx.state.civs.filter((x) => x.alive).sort((a, b) => a.legitimacy - b.legitimacy)[0];
    return Math.min(100, 40 + ctx.events.filter((e) => (e.type === "civ.coup" || e.type === "civ.succession") && e.civ === c.id).length * 12 + (60 - c.legitimacy) / 2);
  },
  epilogue: (ctx) => {
    const { state } = ctx;
    const c = state.civs.filter((x) => x.alive).sort((a, b) => ctx.events.filter((e) => (e.type === "civ.coup" || e.type === "civ.succession") && e.civ === b.id).length - ctx.events.filter((e) => (e.type === "civ.coup" || e.type === "civ.succession") && e.civ === a.id).length)[0];
    const changes = ctx.events.filter((e) => (e.type === "civ.coup" || e.type === "civ.succession") && e.civ === c.id);
    const coups = changes.filter((e) => e.type === "civ.coup").length;
    const removed = ctx.events.filter((e) => e.type === "civ.disappearance" && e.civ === c.id).length;
    const names = changes.map((e) => String(e.data?.next ?? "")).filter(Boolean);
    return [
      `${c.name} has had ${changes.length + 1} rulers in ${state.day} days${coups ? `, ${coups} of them by coup` : ""}${removed ? `, ${removed} removed by a hand nobody saw` : ""}: ${names.length ? names.join(", ") : "the record lost the names"}. Legitimacy stands at ${c.legitimacy}.`,
      `${c.ruler >= 0 ? `${state.citizens[c.ruler].name} holds the ${rulerWord(c)} tonight` : `Nobody holds the ${rulerWord(c)} tonight`}; it is ${c.form === "autocracy" ? "an autocracy" : `a ${c.form}`}. Taxes ${c.policies.taxRate} %, ${civPop(ctx, c.id)} people, unrest ${state.settlements[c.settlements[0]].unrest}.`,
      `A crown that changes hands this often is not a crown. It is a thing people pick up off the floor.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

function rulerWord(c: { disposition: string }): string { return c.disposition === "martial" ? "crown" : c.disposition === "scholarly" ? "chair" : "seat"; }

registerEnding({
  id: "disease.silent_generation",
  title: "The Silent Generation",
  family: "disease",
  severity: 3,
  // 10: a world that stopped having children
  eligible: (ctx) => {
    const early = ctx.metrics.slice(0, 180).reduce((a, m) => a + (m.births ?? 0), 0);
    const late = ctx.metrics.slice(-180).reduce((a, m) => a + (m.births ?? 0), 0);
    // the Day-0 couples age out of child-bearing on their own; this ending wants a cause — a famine or a fever on the record
    // and couples who could still have children: otherwise the Day-0 generation simply aged out
    const couples = ctx.state.citizens.filter((c) => c.alive && c.partner >= 0 && c.age <= 45 && c.age >= 18 && ctx.state.citizens[c.partner]?.alive && ctx.state.citizens[c.partner].age <= 45 && ctx.state.citizens[c.partner].home === c.home).length / 2;
    return ctx.metrics.length >= 360 && early >= 4 && late <= Math.max(0, Math.floor(early * 0.1)) && ctx.last.population >= startPop(ctx) * 0.5 && couples >= 5 && (fired(ctx, "gd.second_drought@") || fired(ctx, "rp.cluster@"));
  },
  score: (ctx) => Math.min(100, 50 + Math.round((100 * (startPop(ctx) - ctx.last.population)) / startPop(ctx))),
  epilogue: (ctx) => {
    const { state } = ctx;
    const early = ctx.metrics.slice(0, 180).reduce((a, m) => a + (m.births ?? 0), 0);
    const late = ctx.metrics.slice(-180).reduce((a, m) => a + (m.births ?? 0), 0);
    const hungry = state.citizens.filter((c) => c.alive && c.hungryDays > 0).length;
    const sick = state.citizens.filter((c) => c.alive && (c.infection === "sick" || c.infection === "incubating")).length;
    const couples = state.citizens.filter((c) => c.alive && c.partner >= 0).length / 2;
    return [
      `${early} children were born in the first half-year; ${late} in the last. ${Math.round(couples)} couples share a roof tonight, ${hungry} people are hungry and ${sick} are sick; bread costs ${Math.round((100 * (state.markets[0]?.price.food ?? 0)) / ECON.basePrice.food)} % of its old price.`,
      `Nobody plans a child in a famine or a fever, and the world gave them both. ${state.citizens.filter((c) => c.alive && c.occupation === "child").length} children are alive; the youngest is ${Math.min(...state.citizens.filter((c) => c.alive).map((c) => c.age))}.`,
      `The towns will stand for a generation. Then the record says nothing, because there is nobody to write it.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "disease.red_plague",
  title: "Red Plague",
  family: "disease",
  severity: 5,
  eligible: (ctx) => {
    const start = ctx.metrics[0]?.population ?? ctx.state.citizens.length;
    return ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "plague").length >= start * 0.08;
  },
  score: (ctx) => {
    const start = ctx.metrics[0]?.population ?? ctx.state.citizens.length;
    const dead = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "plague").length;
    return Math.min(100, Math.round((200 * dead) / start) + ctx.last.infected);
  },
  epilogue: (ctx) => {
    const { state } = ctx;
    const dead = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "plague");
    const first = ctx.events.find((e) => e.type === "health.outbreak");
    const byTown = new Map<number, number>();
    for (const e of dead) if (e.settlement !== undefined) byTown.set(e.settlement, (byTown.get(e.settlement) ?? 0) + 1);
    const worst = [...byTown.entries()].sort((a, b) => b[1] - a[1])[0];
    const cured = state.story.fired.filter((f) => f.id.startsWith("rp.cure@")).map((f) => state.civs[Number(f.id.split("@")[1])].name);
    const quarantined = ctx.events.filter((e) => e.type === "civ.quarantine" && e.data?.on === 1).length;
    return [
      `${first ? `On day ${first.day} ${first.data?.name}, a ${first.data?.occupation} of ${state.settlements[first.settlement ?? 0]?.name}, took to bed with a fever.` : "A fever came to the valley."} By day ${state.day} it had killed ${dead.length} of the ${ctx.metrics[0]?.population ?? state.citizens.length} who began the count${worst ? `, ${worst[1]} of them in ${state.settlements[worst[0]]?.name}` : ""}.`,
      `${quarantined ? `${quarantined} town${quarantined === 1 ? "" : "s"} closed ${quarantined === 1 ? "its" : "their"} gates.` : "No town closed its gates."} ${cured.length ? `${cured.join(" and ")} found a treatment — too late for most.` : "No one found a treatment."} ${state.citizens.filter((c) => c.alive && c.infection === "recovered").length} people carry the marks of it and will not catch it again.`,
      `The clinics saw whom they could. The fields were short-handed at harvest, and the markets remember the price of bread that autumn.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "disease.last_cure",
  title: "The Last Cure",
  family: "disease",
  severity: 2,
  eligible: (ctx) => {
    const start = ctx.metrics[0]?.population ?? ctx.state.citizens.length;
    const dead = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "plague").length;
    return ctx.state.story.fired.some((f) => f.id.startsWith("rp.cluster@")) && ctx.state.story.fired.some((f) => f.id.startsWith("rp.cure@")) && dead < start * 0.1;
  },
  score: (ctx) => 60 + Math.round(ctx.recent("avgHealth") / 4),
  epilogue: (ctx) => {
    const { state } = ctx;
    const cure = state.story.fired.find((f) => f.id.startsWith("rp.cure@"))!;
    const civ = state.civs[Number(cure.id.split("@")[1])];
    const dead = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "plague").length;
    return [
      `The fever came, and on day ${cure.day} the doctors of ${civ.name} found how to treat it. ${dead} people had died by then; many more would have.`,
      `Medicine stands at ${civ.tech.medicine}; the health budget is $${(civ.policies.healthBudget / 100).toFixed(0)} a day. The clinic in ${state.settlements[civ.settlements[0]]?.name} is the busiest building in the valley and the most trusted.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "climate.great_drought",
  title: "Great Drought",
  family: "climate",
  severity: 4,
  eligible: (ctx) => {
    const { state } = ctx;
    const starved = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "starvation").length;
    const start = ctx.metrics[0]?.population ?? state.citizens.length;
    // a Day-0 town at half its people, or (since M7, when caravans feed most famines) one in twenty-five dead of hunger
    const abandoned = state.settlements.some((st) => st.parent < 0 && st.population <= (state.story.startPopulation[st.id] || 1) * 0.5);
    const secondDrought = state.story.fired.some((f) => f.id.startsWith("gd.second_drought@"));
    return state.climate.rainfall <= 45 && (starved >= start * 0.1 || abandoned || (secondDrought && starved >= start * 0.04));
  },
  // the drought is the cause; when it is on the record it outranks the exodus it caused
  score: (ctx) => Math.min(100, 100 - Math.round(ctx.recent("avgWellbeing")) + ctx.count("env.drought_begins") * 10 + (ctx.state.story.fired.some((f) => f.id.startsWith("gd.second_drought@")) ? 30 : 0) + ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "starvation").length),
  epilogue: (ctx) => {
    const { state } = ctx;
    const droughts = ctx.events.filter((e) => e.type === "env.drought_begins");
    const starved = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "starvation").length;
    const left = state.civs.reduce((a, c) => a + c.migrantsOut, 0);
    const emptiest = [...state.settlements].sort((a, b) => a.population / (state.story.startPopulation[a.id] || 1) - b.population / (state.story.startPopulation[b.id] || 1))[0];
    return [
      `${droughts.length} drought${droughts.length === 1 ? "" : "s"} in ${state.day} days, the first on day ${droughts[0]?.day ?? "—"}. Rainfall is down to ${state.climate.rainfall}; the river is a string of pools.`,
      `${starved} people starved. ${left} walked to another town with what they could carry. ${emptiest ? `${emptiest.name} holds ${emptiest.population} of the ${state.story.startPopulation[emptiest.id]} who lived there at the start.` : ""}`,
      `${state.civs.some((c) => c.irrigated) ? `${state.civs.filter((c) => c.irrigated).map((c) => c.name).join(" and ")} cut channels to the fields — late, but the farms there kept their crop.` : "Nobody cut channels to the fields."} The granaries that were full in spring were empty by the second summer.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "climate.green_compact",
  title: "The Green Compact",
  family: "climate",
  severity: 1,
  eligible: (ctx) => {
    const { state } = ctx;
    const starved = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause === "starvation").length;
    return state.story.fired.some((f) => f.id.startsWith("gd.first_drought@")) && state.story.fired.some((f) => f.id.startsWith("gd.irrigation@")) && starved < 5 && state.settlements.every((st) => st.population >= (state.story.startPopulation[st.id] || 1) * 0.8);
  },
  score: (ctx) => 55 + Math.round(ctx.recent("foodDaysReserve") / 4),
  epilogue: (ctx) => {
    const { state } = ctx;
    const irr = state.story.fired.find((f) => f.id.startsWith("gd.irrigation@"))!;
    const civ = state.civs[Number(irr.id.split("@")[1])];
    const droughts = ctx.count("env.drought_begins");
    return [
      `The rains failed ${droughts} time${droughts === 1 ? "" : "s"}, and on day ${irr.day} ${civ.name} finished its channels. The fields of ${state.settlements[civ.settlements[0]]?.name} kept their crop through the dry months.`,
      `Agriculture stands at ${civ.tech.agriculture}; the granary target is ${civ.policies.foodReserveDays} days${state.buildings.some((b) => b.alive && b.kind === "warehouse") ? " and there is a warehouse to hold it" : ""}. Nobody left and almost nobody went hungry.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "tech.accord",
  title: "Human–Machine Accord",
  family: "technology",
  severity: 2,
  eligible: (ctx) => ctx.state.story.fired.some((f) => f.id.startsWith("md.accord@")),
  score: (ctx) => 70 + Math.min(30, ctx.state.civs.filter((c) => c.form === "technocracy").length * 10),
  epilogue: (ctx) => {
    const { state } = ctx;
    const f = state.story.fired.find((x) => x.id.startsWith("md.accord@"))!;
    const civ = state.civs[Number(f.id.split("@")[1])];
    const loss = ctx.events.find((e) => e.type === "research.loss_of_control" && e.civ === civ.id);
    const contained = state.story.fired.find((x) => x.id === `md.contained@${civ.id}`);
    return [
      `${loss ? `On day ${loss.day} the relays of ${civ.name} stopped answering.` : `The relays of ${civ.name} came close to running themselves.`} ${contained ? `On day ${contained.day} the review board brought them back` : "The review board brought them back"}, and on day ${f.day} the council and its machines signed an accord.`,
      `Automation stands at ${civ.tech.automation}; the risk the Oracle counted is down to ${civ.tech.machineAutonomyRisk}. Oversight is ${civ.policies.oversight}. ${civ.name} is a technocracy now: the relays keep the lights, the council keeps the law.`,
      `${civ.ruler >= 0 ? state.citizens[civ.ruler].name : "The council"} signs the budgets, and the machines read them.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

registerEnding({
  id: "tech.machine_dominion",
  title: "Machine Dominion",
  family: "technology",
  severity: 5,
  eligible: (ctx) => ctx.state.civs.some((c) => c.tech.machineAutonomyRisk >= 85 && !ctx.state.story.fired.some((f) => f.id === `md.contained@${c.id}`)),
  score: (ctx) => Math.max(...ctx.state.civs.map((c) => c.tech.machineAutonomyRisk)),
  epilogue: (ctx) => {
    const { state } = ctx;
    const civ = [...state.civs].sort((a, b) => b.tech.machineAutonomyRisk - a.tech.machineAutonomyRisk)[0];
    const loss = ctx.events.find((e) => e.type === "research.loss_of_control" && e.civ === civ.id);
    const automated = state.businesses.filter((b) => b.alive && b.automation >= 50 && civ.settlements.includes(b.settlement)).length;
    const lab = state.businesses.find((b) => b.alive && b.kind === "lab" && civ.settlements.includes(b.settlement));
    const lead = lab ? lab.employees.map((id) => state.citizens[id]).filter((c) => c.alive).sort((a, b) => b.skills.science - a.skills.science)[0] : null;
    const unemployment = ctx.recent("unemployment");
    return [
      `${loss ? `On day ${loss.day}` : "Before the count ended"} the relays of ${civ.name} stopped answering to anyone. Automation stood at ${civ.tech.automation}, oversight at ${civ.policies.oversight}; the risk the Oracle had been counting reached ${civ.tech.machineAutonomyRisk}.`,
      `${automated} workshop${automated === 1 ? "" : "s"} and factories run without people now. About ${Math.round(unemployment)} in a hundred adults have no work. ${lead ? `${lead.name}, who led the research, ${lead.alive ? "is still at the lab" : "did not live to see it"}.` : "The lab that did the work has no one left in it."}`,
      `${civ.ruler >= 0 ? state.citizens[civ.ruler].name : "The council"} still signs the budgets. Nobody is sure the machines read them.`,
      missionsParagraph(ctx),
    ].filter((p) => p.length > 0);
  },
});

function buildContext(state: WorldState, events: WorldEvent[], metrics: DailyMetrics[]): ResolveContext {
  const last = metrics[metrics.length - 1];
  const tail = metrics.slice(-90);
  return {
    state,
    events,
    metrics,
    last,
    recent: (k) => (tail.length ? tail.reduce((a, m) => a + Number(m[k]), 0) / tail.length : Number(last[k])),
    count: (type) => events.filter((e) => e.type === type).length,
  };
}

export function resolveEnding(state: WorldState, events: WorldEvent[], metrics: DailyMetrics[]): EndingResult {
  const ctx = buildContext(state, events, metrics);
  const eligible = ENDINGS.filter((e) => e.eligible(ctx)).map((e) => ({ e, s: e.score(ctx) }));
  eligible.sort((a, b) => b.s - a.s || b.e.severity - a.e.severity || a.e.id.localeCompare(b.e.id));
  const primary = eligible[0];
  const secondary = eligible.slice(1).filter((x) => x.s >= 40).slice(0, 2).map((x) => ({ id: x.e.id, title: x.e.title }));
  const stats = headlineStats(ctx);
  if (primary) {
    return { id: primary.e.id, title: primary.e.title, family: primary.e.family, severity: primary.e.severity, day: state.day, epilogue: primary.e.epilogue(ctx), secondary, stats };
  }
  const fb = fallback(ctx);
  return { ...fb, day: state.day, secondary, stats };
}

// ───────────────────────── fallback: The Unfinished Age ─────────────────────────

function fallback(ctx: ResolveContext): Omit<EndingResult, "day" | "secondary" | "stats"> {
  const { state, last } = ctx;
  const town = state.settlements[0]?.name ?? "the valley";
  const civ = state.civs[0]?.name ?? "the council";
  const start = ctx.metrics[0]?.population ?? state.citizens.length;
  const deaths = ctx.events.filter((e) => e.type === "life.death" && e.data?.cause !== "old age").length; // the old dying in their beds is not a hard age
  const riots = ctx.count("civ.riot");
  const droughts = ctx.count("env.drought_begins");
  const opened = ctx.count("econ.business_opened");
  const closed = ctx.count("econ.business_closed");
  const upgraded = ctx.count("econ.business_upgraded");
  const foodRatio = (state.markets[0]?.price.food ?? ECON.basePrice.food) / ECON.basePrice.food;
  const alive = state.citizens.filter((c) => c.alive);
  const richest = [...alive].sort((a, b) => b.wealth - a.wealth)[0];
  const biggest = state.businesses.filter((b) => b.alive).map((b) => ({ b, tier: state.buildings[b.building].tier })).sort((a, b) => b.tier - a.tier || b.b.employees.length - a.b.employees.length)[0];
  const dead = state.citizens.filter((c) => !c.alive).map((c) => c.name);

  if (last.population === 0) {
    return {
      id: "fallback.empty",
      title: "The Empty Valley",
      family: "fallback",
      severity: 5,
      epilogue: [
        `By day ${state.day} no one was left in ${town}. ${start} people began the count; ${deaths} died, the last of them ${dead[dead.length - 1] ?? "unnamed"}.`,
        `The houses stand. The fields by the river go back to grass. ${civ} issued its last budget to nobody.`,
        droughts ? `The chronicle records ${droughts} drought${droughts > 1 ? "s" : ""}; the market's last food price was ${foodRatio.toFixed(1)}× the old base.` : `There was no single catastrophe in the record — only a town that could not feed itself.`,
      ],
    };
  }

  const wellbeing = ctx.recent("avgWellbeing");
  const unemployment = ctx.recent("unemployment");
  const unrest = ctx.recent("unrest");
  const civs = state.civs.filter((c) => c.alive);
  const wars = ctx.count("war.declared");
  let variant: "plenty" | "hard" | "fragile" | "quiet";
  const hardLoss = Math.max(3, Math.round(start * 0.08));
  if (deaths >= hardLoss || wellbeing < 60) variant = "hard";
  else if (riots > 0 || unrest > 40 || ctx.count("war.declared") > 0) variant = "fragile";
  else if (wellbeing >= 85 && deaths <= Math.max(1, Math.round(start * 0.01)) && unemployment <= 10 && foodRatio >= 0.8 && foodRatio <= 1.3) variant = "plenty";
  else variant = "quiet";

  const titles = { plenty: "The Unfinished Age — An Age of Plenty", hard: "The Unfinished Age — A Hard Age", fragile: "The Unfinished Age — A Fragile Peace", quiet: "The Unfinished Age — A Quiet Age" };
  const opening = {
    plenty: `Five hundred and forty-five days on, ${town} is well fed and busy. ${last.population} of the ${start} who began are still here.`,
    hard: `Five hundred and forty-five days on, ${town} has buried ${deaths} of its own. ${last.population} of ${start} remain.`,
    fragile: `Five hundred and forty-five days on, ${town} holds together, but only just: ${riots > 0 ? `${riots} riot${riots === 1 ? "" : "s"} in the record` : `${wars} war${wars === 1 ? "" : "s"} in the record`}${unrest > 20 ? " and unrest still in the streets" : " and soldiers still drawing pay"}.`,
    quiet: `Five hundred and forty-five days on, ${town} is much as it was: ${last.population} of ${start} still here, nothing decided, nothing lost.`,
  };
  const economy = `Over the count ${opened} business${opened === 1 ? "" : "es"} opened, ${closed} closed and ${upgraded} expanded. Food trades at ${foodRatio.toFixed(2)}× its old price; about ${Math.round(unemployment)} in a hundred adults have no work.`;
  const people = richest
    ? `${richest.name}, ${richest.occupation === "unemployed" ? "without a job" : `${/^[aeiou]/.test(richest.occupation) ? "an" : "a"} ${richest.occupation}`}, ends the count the richest person in town with ${money(richest.wealth)}${biggest ? `; the ${biggest.b.kind.replace("_", " ")} at tier ${biggest.tier} is its largest concern` : ""}.`
    : "";
  const dark = dead.length ? `The dead: ${dead.slice(0, 5).join(", ")}${dead.length > 5 ? ` and ${dead.length - 5} more` : ""}.` : "";
  const others = civs.length > 1 ? `${civs.length} nations share the map; ${wars ? `${wars} war${wars === 1 ? "" : "s"} ${wars === 1 ? "was" : "were"} fought and none of them was decisive` : "none of them went to war"}. ` : "";
  const tail = `${others}${civ} closes the books with ${money(state.civs[0]?.treasury ?? 0)} and ${droughts ? `${droughts} drought${droughts > 1 ? "s" : ""} in living memory` : "no drought in living memory"}. The future this world was shown never arrived — and nothing else did either. The count goes on.`;

  return {
    id: `fallback.${variant}`,
    title: titles[variant],
    family: "fallback",
    severity: variant === "hard" ? 3 : variant === "fragile" ? 2 : 1,
    epilogue: [opening[variant], economy, people, dark, tail, missionsParagraph(ctx)].filter((p) => p.length > 0),
  };
}

function headlineStats(ctx: ResolveContext): { label: string; value: string }[] {
  const { state, last } = ctx;
  const start = ctx.metrics[0]?.population ?? state.citizens.length;
  return [
    { label: "Population", value: `${last.population} of ${start}` },
    { label: "Deaths", value: `${ctx.metrics.reduce((a, m) => a + m.deaths, 0)}` },
    { label: "Food price", value: `$${((state.markets[0]?.price.food ?? 0) / 100).toFixed(2)}` },
    { label: "Unemployment", value: `${last.unemployment}%` },
    { label: "Treasury", value: money(last.treasuryTotal) },
    { label: "Inequality", value: (last.gini / 1000).toFixed(2) },
    { label: "Businesses", value: `${state.businesses.filter((b) => b.alive).length}` },
    { label: "Riots", value: `${ctx.count("civ.riot")}` },
    { label: "Wars", value: `${ctx.count("war.declared")}` },
    { label: "Missions taken", value: `${state.story.missions.filter((m) => m.status === "accepted").length} of ${state.story.missions.length}` },
  ];
}
