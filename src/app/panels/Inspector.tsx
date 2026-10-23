import { useEffect, useState } from "react";
import type { Selection } from "../../render/scene";
import type { CitizenDetail, WorldInfo } from "../../workers/protocol";
import { BIOME_INDEX, RESOURCE_INDEX } from "../../sim/types";
import type { WorldView } from "../frameView";
import { label, money } from "../frameView";
import type { SimClient } from "../simClient";

type Props = {
  sel: Selection;
  info: WorldInfo;
  view: WorldView;
  client: SimClient | null;
  day: number;
  onClear: () => void;
  onFocus: (s: Selection) => void;
  /** Direct powers (undefined while peeking). */
  onRemoveCitizen?: (id: number) => void;
  onDestroyBuilding?: (id: number) => void;
  onInvestigate?: (target: "citizen" | "building", id: number) => void;
  influence?: number;
  /** Last investigation day per "c<id>"/"b<id>", for the cooldown. */
  revealLog?: Record<string, number>;
};
const COST = { remove: 15, destroy: 10, reveal: 1, cooldown: 60 };

function Bar({ v, name }: { v: number; name: string }): JSX.Element {
  return (
    <div className="bar" role="meter" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100} aria-label={name}>
      <span className="bar__label">{name}</span>
      <span className="bar__track"><span className="bar__fill" style={{ width: `${v}%` }} data-low={v < 35 || undefined} /></span>
      <span className="bar__value">{v}</span>
    </div>
  );
}

export function Inspector({ sel, info, view, client, day, onClear, onFocus, onRemoveCitizen, onDestroyBuilding, onInvestigate, influence = 0, revealLog = {} }: Props): JSX.Element {
  const townOf = (settlement: number) => info.settlements.find((s) => s.id === settlement);
  const cooldown = (key: string) => { const last = revealLog[key]; return last === undefined ? 0 : Math.max(0, COST.cooldown - (day - last)); };
  const [detail, setDetail] = useState<CitizenDetail | null>(null);
  const citizenId = sel.kind === "citizen" ? sel.id : -1;
  useEffect(() => {
    if (citizenId < 0 || !client) return;
    setDetail(null);
    client.on({ inspect: (d) => d.id === citizenId && setDetail(d) });
    client.inspect(citizenId);
    const t = setInterval(() => client.inspect(citizenId), 2000);
    return () => clearInterval(t);
  }, [citizenId, client, day]);

  if (sel.kind === "building") {
    const b = view.buildings.find((x) => x.id === sel.id);
    if (!b) return <p>Unknown building.</p>;
    const biz = b.business >= 0 ? view.businesses.find((x) => x.id === b.business) : undefined;
    const residents = b.kind === "house" ? view.citizens.filter((c) => c.alive && c.home === b.id) : [];
    const staff = view.citizens.filter((c) => c.alive && c.workplaceBuilding === b.id);
    const town = townOf(b.settlement);
    return (
      <div>
        <h3>{label(b.kind)} #{b.id}</h3>
        <p className="dim">{town ? `${town.name} · ${info.civs[town.civ]?.name ?? town.civName}` : ""}</p>
        <dl>
          <dt>Position</dt><dd>{b.x}, {b.y}</dd>
          <dt>Tier</dt><dd>{b.tier}</dd>
          <dt>Condition</dt><dd>{b.condition}/100</dd>
          {biz && (
            <>
              <dt>Staff</dt><dd>{biz.employees} / {biz.staffTarget}{biz.employees < biz.staffTarget ? " (hiring)" : ""}</dd>
              <dt>Wage</dt><dd>{money(biz.wage)}/day{biz.insolventDays > 0 ? ` · ${biz.insolventDays} days behind on payroll` : ""}</dd>
              <dt>Cash</dt><dd>{money(biz.cash)}</dd>
              <dt>30-day profit</dt><dd>{money(biz.profit30)}</dd>
              <dt>Yesterday</dt><dd>{biz.lastOutput} units produced</dd>
              <dt>Stock</dt><dd>food {biz.inventory.food} · materials {biz.inventory.materials} · energy {biz.inventory.energy}</dd>
              <dt>Owner</dt><dd>{biz.owner >= 0 ? <button className="link" onClick={() => onFocus({ kind: "citizen", id: biz.owner })}>{info.citizens[biz.owner]?.name}</button> : "public"}</dd>
            </>
          )}
          {b.kind !== "house" && !biz && b.kind !== "town_hall" && b.kind !== "ruin" && <><dt>Status</dt><dd>empty — no business operates here</dd></>}
          {b.kind === "ruin" && <><dt>Status</dt><dd>a ruin — nothing stands here now</dd></>}
        </dl>
        {residents.length > 0 && (
          <>
            <h3 className="h4">Residents</h3>
            <ul className="list">{residents.map((c) => <li key={c.id}><button className="list__item" onClick={() => onFocus({ kind: "citizen", id: c.id })}>{c.name} <span className="dim">{c.occupation}</span></button></li>)}</ul>
          </>
        )}
        {staff.length > 0 && (
          <>
            <h3 className="h4">Works here</h3>
            <ul className="list">{staff.map((c) => <li key={c.id}><button className="list__item" onClick={() => onFocus({ kind: "citizen", id: c.id })}>{c.name} <span className="dim">{c.action === "work" ? "at work" : c.action.replace("_", " ")}</span></button></li>)}</ul>
          </>
        )}
        <div className="btnrow">
          <button className="btn btn--ghost" onClick={onClear}>Clear</button>
          {onInvestigate && b.kind !== "house" && b.kind !== "ruin" && (
            <button className="btn" disabled={influence < COST.reveal || cooldown(`b${b.id}`) > 0} title={cooldown(`b${b.id}`) > 0 ? `Investigated recently; ${cooldown(`b${b.id}`)} days until it tells you something new` : "Read this building's records: evidence, ◆ 1 → ◇ 2"} onClick={() => onInvestigate("building", b.id)}>Investigate (◆ {COST.reveal})</button>
          )}
          {onDestroyBuilding && b.kind !== "ruin" && (
            <button className="btn btn--danger" disabled={influence < COST.destroy} title={influence < COST.destroy ? `Needs ◆ ${COST.destroy}` : ""} onClick={() => { if (confirm(`Destroy the ${label(b.kind).toLowerCase()} #${b.id} for ◆ ${COST.destroy}? Its business closes, its people lose their work or home, and the town remembers.`)) onDestroyBuilding(b.id); }}>Destroy (◆ {COST.destroy})</button>
          )}
        </div>
      </div>
    );
  }

  if (sel.kind === "citizen") {
    const c = view.citizens.find((x) => x.id === sel.id);
    if (!c) return <p>Unknown citizen.</p>;
    const home = view.buildings.find((x) => x.id === c.home);
    const work = view.buildings.find((x) => x.id === c.workplaceBuilding);
    return (
      <div>
        <h3>{c.name}{!c.alive && <span className="dim"> (deceased)</span>}</h3>
        <p className="dim">{c.occupation === "ruler" ? `${info.civs[townOf(c.settlement)?.civ ?? 0]?.title ?? "Ruler"} of ${info.civs[townOf(c.settlement)?.civ ?? 0]?.name ?? ""}` : label(c.occupation)} · {townOf(c.settlement)?.name ?? ""} · age {c.age} · {c.traits.join(", ")} · wants to {c.goal.replace("_", " ")}</p>
        <dl>
          <dt>Today</dt><dd>{label(c.action)}{c.infection === "sick" ? " · sick with the fever" : c.infection === "incubating" ? " · incubating the fever" : c.infection === "recovered" ? " · recovered from the fever" : ""}</dd>
          <dt>Wealth</dt><dd>{money(c.wealth)}</dd>
          <dt>Food at home</dt><dd>{c.foodStock} days{detail && detail.hungryDays > 0 ? ` · hungry for ${detail.hungryDays} days` : ""}</dd>
          <dt>Home</dt><dd>{home ? <button className="link" onClick={() => onFocus({ kind: "building", id: home.id })}>House #{home.id}</button> : "none"}</dd>
          <dt>Workplace</dt><dd>{work ? <button className="link" onClick={() => onFocus({ kind: "building", id: work.id })}>{label(work.kind)} #{work.id}</button> : "none"}{detail && detail.hiredDay >= 0 && work ? <span className="dim"> since day {detail.hiredDay}</span> : null}</dd>
          {detail && (detail.partner >= 0 || detail.children.length > 0 || detail.born >= 0 || detail.origin !== c.settlement) && (
            <>
              <dt>Family</dt>
              <dd>
                {detail.partner >= 0 && info.citizens[detail.partner] && <button className="link" onClick={() => onFocus({ kind: "citizen", id: detail.partner })}>{info.citizens[detail.partner].name}</button>}
                {detail.partner >= 0 && detail.children.length > 0 && " · "}
                {detail.children.length > 0 && <>{detail.children.length === 1 ? "child " : "children "}{detail.children.map((id, i) => <span key={id}>{i > 0 && ", "}<button className="link" onClick={() => onFocus({ kind: "citizen", id })}>{info.citizens[id]?.name ?? `#${id}`}</button></span>)}</>}
                {detail.partner < 0 && detail.children.length === 0 && <span className="dim">none here</span>}
                {detail.born >= 0 && <span className="dim"> · born here on day {detail.born}</span>}
                {detail.born < 0 && detail.origin !== c.settlement && <span className="dim"> · came from {townOf(detail.origin)?.name ?? "another town"}</span>}
              </dd>
            </>
          )}
        </dl>
        <Bar v={c.health} name="Health" />
        <Bar v={c.needs.food} name="Food" />
        <Bar v={c.needs.shelter} name="Shelter" />
        <Bar v={c.needs.safety} name="Safety" />
        <Bar v={c.needs.belonging} name="Belonging" />
        {detail && (
          <>
            <h3 className="h4">Skills</h3>
            <p className="dim">{Object.entries(detail.skills).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
            <h3 className="h4">Beliefs</h3>
            {detail.beliefs.length === 0 && <p className="dim">Nothing yet — beliefs form from what happens to them.</p>}
            <ul className="list">{detail.beliefs.map((b) => <li key={b.key} className="list__row"><span>{label(b.key)}</span><span className="dim">{b.strength}/100</span></li>)}</ul>
            <h3 className="h4">Remembers</h3>
            {detail.memories.length === 0 && <p className="dim">Nothing yet.</p>}
            <ul className="list">
              {detail.memories.map((m, i) => (
                <li key={i} className="list__row">
                  <span>day {m.day}: {label(m.tag.replace(/^\w+\./, ""))}{m.aboutCitizen !== undefined && m.aboutCitizen !== c.id ? ` (${info.citizens[m.aboutCitizen]?.name})` : ""}</span>
                  <span className="dim">{m.valence > 0 ? "+" : ""}{m.valence}</span>
                </li>
              ))}
            </ul>
            {detail.relationships.length > 0 && (
              <>
                <h3 className="h4">Relationships</h3>
                <ul className="list">
                  {detail.relationships.slice(0, 8).map((r) => (
                    <li key={r.other}><button className="list__item" onClick={() => onFocus({ kind: "citizen", id: r.other })}>{info.citizens[r.other]?.name} <span className="dim">{r.kind} {r.affinity > 0 ? "+" : ""}{r.affinity}</span></button></li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        <div className="btnrow">
          <button className="btn btn--ghost" onClick={onClear}>Clear</button>
          {onInvestigate && c.alive && (
            <button className="btn" disabled={influence < COST.reveal || cooldown(`c${c.id}`) > 0} title={cooldown(`c${c.id}`) > 0 ? `Spoke recently; ${cooldown(`c${c.id}`)} days until there is something new` : "Overhear what this person believes: a rumor, ◆ 1 → ◇ 1"} onClick={() => onInvestigate("citizen", c.id)}>Investigate (◆ {COST.reveal})</button>
          )}
          {onRemoveCitizen && c.alive && (
            <button className="btn btn--danger" disabled={influence < COST.remove} title={influence < COST.remove ? `Needs ◆ ${COST.remove}` : ""} onClick={() => { if (confirm(`Remove ${c.name} from the world for ◆ ${COST.remove}? ${c.occupation === "ruler" ? "A successor takes over, the civilization's legitimacy falls, and the new ruler may blame the neighbours." : c.occupation === "scientist" ? "The lab may name itself after them and double its grant." : "Colleagues and friends will remember; prominent people cost their council legitimacy."}`)) onRemoveCitizen(c.id); }}>Remove (◆ {COST.remove})</button>
          )}
        </div>
      </div>
    );
  }

  const i = sel.y * info.width + sel.x;
  return (
    <div>
      <h3>Tile {sel.x}, {sel.y}</h3>
      <dl>
        <dt>Biome</dt><dd>{BIOME_INDEX[info.biome[i]]}{info.river[i] ? " · river" : ""}</dd>
        <dt>Elevation</dt><dd>{info.elevation[i]}</dd>
        <dt>Moisture</dt><dd>{info.moisture[i]} <span className="dim">(Day 0)</span></dd>
        <dt>Resource</dt><dd>{RESOURCE_INDEX[info.resource[i]]}</dd>
        <dt>Territory</dt><dd>{info.owner[i] ? info.settlements.find((s) => s.id === info.owner[i] - 1)?.name ?? "?" : "unclaimed"}</dd>
      </dl>
      <button className="btn btn--ghost" onClick={onClear}>Clear</button>
    </div>
  );
}
