/**
 * The record (M9): a world's chronicle as a Markdown file — settings and seed, every notable event
 * as the sentence the chronicle showed, the player's interventions, and the ending's epilogue. A
 * player can keep it, paste it into an issue, or read it without the game.
 */
import type { EndingResult, Intervention, WorldEvent } from "../sim/types";
import type { WorldInfo } from "../workers/protocol";
import { eventText } from "./events";

export function chronicleMarkdown(info: WorldInfo, events: WorldEvent[], interventions: Intervention[], ending: EndingResult | null, kindOf: (bizId: number) => string, day: number): string {
  const s = info.settings;
  const out: string[] = [];
  out.push(`# ${info.name} — the record of ${day} days`);
  out.push("");
  out.push(`Seed ${info.seed} · ${s.terrain} · ${s.climate} · ${info.width}×${info.height} · ${s.civs} civilization${s.civs === 1 ? "" : "s"} of ${s.population} · disasters ${s.disasters}${info.forkedFrom ? ` · branched from "${info.forkedFrom.name}" at day ${info.forkedFrom.day}` : ""}`);
  out.push("");
  out.push(`Civilizations: ${info.civs.map((c) => `${c.name} (${c.disposition})`).join(", ")}. Towns: ${info.settlements.map((t) => t.name).join(", ")}.`);
  out.push("");
  if (interventions.length) {
    out.push("## Your hand");
    out.push("");
    for (const iv of interventions) out.push(`- Day ${iv.day}: ${describeIntervention(iv, info)}`);
    out.push("");
  }
  out.push("## Chronicle");
  out.push("");
  let lastDay = -1;
  for (const e of events) {
    if (e.importance < 4) continue;
    if (e.day !== lastDay) { out.push(""); out.push(`**Day ${e.day}**`); lastDay = e.day; }
    out.push(`- ${eventText(e, info, kindOf)}`);
  }
  out.push("");
  if (ending) {
    out.push(`## ${ending.title}`);
    out.push("");
    for (const p of ending.epilogue) { out.push(p); out.push(""); }
    if (ending.secondary.length) out.push(`Also in reach: ${ending.secondary.map((x) => x.title).join(", ")}.`);
    if (ending.stats.length) { out.push(""); for (const st of ending.stats) out.push(`- ${st.label}: ${st.value}`); }
  } else {
    out.push(`_The count stands at day ${day}; the ending is not written yet._`);
  }
  out.push("");
  out.push("---");
  out.push("Exported from 545 DAYS. The seed and these interventions replay this world exactly (World tab → Export file).");
  return out.join("\n");
}

function describeIntervention(iv: Intervention, info: WorldInfo): string {
  const civ = (id: number) => info.civs[id]?.name ?? `civilization ${id}`;
  const person = (id: number) => info.citizens[id]?.name ?? `#${id}`;
  const town = (id: number) => info.settlements[id]?.name ?? `town ${id}`;
  switch (iv.type) {
    case "mission": return `${iv.accept ? "accepted" : "declined"} the Oracle's mission #${iv.mission}`;
    case "remove_citizen": return `removed ${person(iv.citizen)}`;
    case "destroy_building": return `destroyed building #${iv.building}`;
    case "build": return `built a ${iv.kind} in ${town(iv.settlement)}`;
    case "set_policy": return `set ${civ(iv.civ)}'s ${iv.key} to ${iv.value}`;
    case "set_attitude": return `set ${civ(iv.civ)}'s regard for ${civ(iv.other)} to ${iv.value}`;
    case "set_focus": return `turned ${civ(iv.civ)}'s lab to ${iv.field}`;
    case "disaster": return `began a ${iv.kind} (intensity ${iv.intensity})`;
    case "reveal": return `investigated ${iv.target} #${iv.id}`;
    case "reveal_vision": return `read vision ${iv.vision + 1} plainly`;
    case "found_colony": return `founded a colony of ${town(iv.from)} for ${civ(iv.civ)}`;
    case "relocate_citizen": return `moved ${person(iv.citizen)} to ${town(iv.settlement)}`;
    case "nudge_belief": return `nudged ${person(iv.citizen)}'s belief "${iv.key}"`;
    default: return iv.type.replace(/_/g, " ");
  }
}

export function downloadText(text: string, filename: string, type = "text/markdown"): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
