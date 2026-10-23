/**
 * Achievements (M7): things a player can be the first to see in a world, kept across worlds in
 * IndexedDB. Each is a predicate over what the main thread already holds — the frame, the event
 * history, the ending — so no engine state leaks and the check costs nothing the panels do not pay.
 * Achievements are never shown as hints: the locked list names them, nothing more.
 */
import type { EndingResult, Intervention, WorldEvent } from "../sim/types";
import type { RenderFrame } from "../workers/protocol";
import { earnAchievement, listAchievements } from "../storage/db";

export interface AchievementDef {
  id: string;
  title: string;
  /** Written as a thing that happened, in the chronicle's voice. */
  text: string;
  group: "world" | "society" | "oracle" | "endings";
  check: (ctx: AchievementContext) => boolean;
}

export interface AchievementContext {
  frame: RenderFrame;
  events: WorldEvent[];
  interventions: Intervention[];
  ending: EndingResult | null;
}

const count = (ctx: AchievementContext, type: string) => ctx.events.filter((e) => e.type === type).length;
const accepted = (ctx: AchievementContext, template: string) => ctx.frame.missions.some((m) => m.template === template && m.status === "accepted");

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: "first_caravan", title: "The first cart", text: "A caravan set out between two towns.", group: "world", check: (c) => count(c, "trade.caravan") >= 1 },
  { id: "merchant", title: "Merchant of the valley", text: "A hundred caravans arrived in one world.", group: "world", check: (c) => count(c, "trade.arrived") >= 100 },
  { id: "first_birth", title: "A cradle", text: "A child was born in your world.", group: "society", check: (c) => count(c, "life.birth") >= 1 },
  { id: "generation", title: "A generation", text: "Thirty children were born in one world.", group: "society", check: (c) => count(c, "life.birth") >= 30 },
  { id: "founder", title: "Founder", text: "A colony was founded — by a council or by you.", group: "society", check: (c) => count(c, "civ.colony_founded") >= 1 },
  { id: "your_colony", title: "Your colony", text: "You paid for a new town yourself.", group: "society", check: (c) => c.interventions.some((iv) => iv.type === "found_colony") || accepted(c, "found_colony") },
  { id: "open_gate", title: "The open gate", text: "You opened a border while a neighbour went hungry.", group: "society", check: (c) => accepted(c, "open_borders") || c.interventions.some((iv) => iv.type === "set_policy" && iv.key === "borders" && iv.value === 0) },
  { id: "shut_gate", title: "The shut gate", text: "You closed a border on people with nowhere to go.", group: "society", check: (c) => accepted(c, "close_gates") || c.interventions.some((iv) => iv.type === "set_policy" && iv.key === "borders" && iv.value === 100) },
  { id: "grain_road", title: "The grain road", text: "You lifted an export ban and the caravans left with bread.", group: "society", check: (c) => accepted(c, "lift_export_ban") || c.interventions.some((iv) => iv.type === "set_policy" && iv.key === "exportBan" && iv.value === 0) },
  { id: "peacemaker", title: "Peacemaker", text: "You brokered a peace or opened a trade road between two nations.", group: "oracle", check: (c) => accepted(c, "broker_peace") || accepted(c, "open_trade") },
  { id: "investigator", title: "Investigator", text: "You read ten clues in one world.", group: "oracle", check: (c) => c.frame.story.clues.length >= 10 },
  { id: "witness", title: "Witness", text: "You let a mission expire and lived with it.", group: "oracle", check: (c) => c.frame.missions.some((m) => m.status === "expired") },
  { id: "cure", title: "The cure", text: "A fever was cured before it took a tenth of the world.", group: "endings", check: (c) => c.ending?.id === "disease.last_cure" },
  { id: "compact", title: "The Green Compact", text: "The land came through the drought.", group: "endings", check: (c) => c.ending?.id === "climate.green_compact" },
  { id: "long_peace", title: "Not one war", text: "Five hundred and forty-five days without a war.", group: "endings", check: (c) => c.ending?.id === "politics.long_peace" || c.ending?.id === "politics.merchant_road" },
  { id: "chosen", title: "The Chosen City", text: "A town grew by taking people in.", group: "endings", check: (c) => c.ending?.id === "society.chosen_city" },
  { id: "founders", title: "The Founders", text: "New towns stood where there was grass.", group: "endings", check: (c) => c.ending?.id === "society.founders" },
  { id: "dark", title: "The dark endings", text: "You saw a plague, a drought, a conquest or a machine take a world.", group: "endings", check: (c) => ["disease.red_plague", "climate.great_drought", "war.scorched_border", "tech.machine_dominion", "society.great_exodus", "politics.iron_council"].includes(c.ending?.id ?? "") },
];

/** Evaluates every locked achievement against the context; resolves to the ones newly earned. */
export async function checkAchievements(ctx: AchievementContext, worldName: string, earned: Set<string>): Promise<AchievementDef[]> {
  const fresh: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (earned.has(a.id)) continue;
    let ok = false;
    try { ok = a.check(ctx); } catch { ok = false; }
    if (!ok) continue;
    earned.add(a.id);
    try {
      if (await earnAchievement({ id: a.id, earnedAt: Date.now(), world: worldName, day: ctx.frame.day })) fresh.push(a);
    } catch { /* storage unavailable: the achievement shows for this session only */ fresh.push(a); }
  }
  return fresh;
}

export async function loadEarned(): Promise<Set<string>> {
  try { return new Set((await listAchievements()).map((r) => r.id)); } catch { return new Set(); }
}
