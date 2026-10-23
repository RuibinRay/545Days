/**
 * Missions: the Oracle's offers. The open mission shows its brief, the one action it proposes,
 * and a forecast of both answers computed by replaying the world forward. Accept or decline;
 * either is recorded as an intervention. Past missions and what came of them are listed below.
 */
import type { Mission, RevealedClue, WorldEvent } from "../../sim/types";
import { STORY_ECON } from "../../sim/types";
import type { Baseline, Divergence, Vision } from "../../sim/story/oracle";
import type { BranchSummary, Forecast, WorldInfo } from "../../workers/protocol";
import type { Selection } from "../../render/scene";
import { eventText } from "../events";
import { CIV_COLORS } from "./Civs";

type Props = {
  missions: Mission[];
  forecast: Forecast | null;
  baseline: Baseline | null;
  visions: Vision[];
  divergence: Divergence | null;
  ended: boolean;
  day: number;
  info: WorldInfo;
  live: boolean;
  kindOf: (bizId: number) => string;
  onAnswer: (id: number, accept: boolean) => void;
  onRefresh: (id: number) => void;
  onFocus: (sel: Selection) => void;
  story: { influence: number; knowledge: number; clues: RevealedClue[]; revealedVisions: number[] };
  missionCost: (m: Mission) => number;
  onRevealVision: (index: number) => void;
};

function civName(info: WorldInfo, id: number | undefined): string {
  return id === undefined ? "" : info.civs[id]?.name ?? `civ ${id}`;
}

function BranchCard({ b, other, info, kindOf }: { b: BranchSummary; other: BranchSummary; info: WorldInfo; kindOf: (id: number) => string }): JSX.Element {
  const diff = (a: number, c: number) => (a === c ? "" : a < c ? " ▼" : " ▲");
  const rows: [string, string, string][] = [
    ["Deaths", `${b.deaths}`, diff(b.deaths, other.deaths)],
    ["…in battle", `${b.battleDeaths}`, diff(b.battleDeaths, other.battleDeaths)],
    ["…of hunger", `${b.starved}`, diff(b.starved, other.starved)],
    ["Wars declared", `${b.wars}`, diff(b.wars, other.wars)],
    ["Raids", `${b.raids}`, diff(b.raids, other.raids)],
    ["Conquests", `${b.conquests}`, diff(b.conquests, other.conquests)],
    ["Rulers replaced", `${b.successions}`, diff(b.successions, other.successions)],
    ["Machine risk (max)", `${b.maxRisk}`, diff(b.maxRisk, other.maxRisk)],
  ];
  return (
    <div className="branch">
      <h5 className="branch__title">{b.label}</h5>
      <dl className="branch__rows">
        {rows.map(([k, v, d]) => (
          <div key={k} className="dl__row"><dt>{k}</dt><dd>{v}<span className={d.includes("▲") ? "branch__up" : "branch__down"}>{d}</span></dd></div>
        ))}
      </dl>
      <ul className="branch__civs">
        {info.civs.map((c) => (
          <li key={c.id}><span className="civ__swatch civ__swatch--small" style={{ background: CIV_COLORS[c.color % CIV_COLORS.length] }} aria-hidden="true" /> {c.name}: {b.population[c.id] ?? 0} people, food up to ${((b.foodPeak[c.id] ?? 0) / 100).toFixed(2)}</li>
        ))}
      </ul>
      {b.ending && <p className="branch__ending">Ends in: <strong>{b.ending}</strong></p>}
      {b.notable.length > 0 && (
        <ul className="branch__events">
          {b.notable.slice(0, 6).map((e: WorldEvent, i) => (
            <li key={i}><span className="dim">d{e.day}</span> {eventText(e, info, kindOf)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VisionBlock({ baseline, visions, divergence, ended, info, kindOf, knowledge, revealed, live, onRevealVision }: { baseline: Baseline | null; visions: Vision[]; divergence: Divergence | null; ended: boolean; info: WorldInfo; kindOf: (id: number) => string; knowledge: number; revealed: number[]; live: boolean; onRevealVision: (i: number) => void }): JSX.Element {
  if (!baseline) return <p className="dim" role="status">The Oracle is running the untouched world to Day 545…</p>;
  return (
    <section className="vision-block" aria-labelledby="vision-block-title">
      <h3 className="h4" id="vision-block-title">What the Oracle saw</h3>
      {visions.length === 0 && <p className="dim">Visions are off for this world (ending preview setting).</p>}
      <ol className="vision__list vision__list--compact">
        {visions.map((v, i) => (
          <li key={i} className={`vision__item ${v.source.type === "ending" ? "vision__item--ending" : ""}`}>
            <span className="vision__glyph" aria-hidden="true">{v.source.type === "ending" ? "◈" : "◇"}</span>
            <span>
              {ended || revealed.includes(i) ? v.clear : v.cryptic}
              {!ended && !revealed.includes(i) && (
                <button className="btn btn--ghost vision__reveal" disabled={!live || knowledge < STORY_ECON.visionRevealCost} onClick={() => onRevealVision(i)} title={`Spend ${STORY_ECON.visionRevealCost} Knowledge to read this plainly`}>read plainly (◇ {STORY_ECON.visionRevealCost})</button>
              )}
            </span>
          </li>
        ))}
      </ol>
      {ended && <p className="dim">Foreseen ending: <strong>{baseline.endingTitle}</strong> (untouched, day {baseline.endingDay}).</p>}
      {divergence && (
        <div className="divergence">
          <div className="meters__row">
            <span className="meters__label">Departure from the vision</span>
            <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={divergence.score} aria-label="departure from the foreseen future"><span className="meter__fill" style={{ width: `${divergence.score}%`, background: "#f2c14e" }} /></span>
            <span className="meters__value">{divergence.score}</span>
          </div>
          {divergence.notes.length > 0 && <ul className="divergence__notes">{divergence.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
          {divergence.missing.length > 0 && (
            <p className="dim">Foreseen and did not happen: {divergence.missing.slice(0, 3).map((e) => `day ${e.day} — ${eventText(e, info, kindOf)}`).join(" · ")}{divergence.missing.length > 3 ? ` · and ${divergence.missing.length - 3} more` : ""}</p>
          )}
          {divergence.unforeseen.length > 0 && (
            <p className="dim">Happened and was not foreseen: {divergence.unforeseen.slice(0, 3).map((e) => `day ${e.day} — ${eventText(e, info, kindOf)}`).join(" · ")}{divergence.unforeseen.length > 3 ? ` · and ${divergence.unforeseen.length - 3} more` : ""}</p>
          )}
          {divergence.score === 0 && <p className="dim">So far the world is exactly as foreseen.</p>}
        </div>
      )}
    </section>
  );
}

export function Missions({ missions, forecast, baseline, visions, divergence, ended, day, info, live, kindOf, onAnswer, onRefresh, onFocus, story, missionCost, onRevealVision }: Props): JSX.Element {
  const open = missions.find((m) => m.status === "offered");
  const past = [...missions].filter((m) => m.status !== "offered").reverse();
  const f = forecast && open && forecast.mission === open.id ? forecast : null;
  const cost = open ? missionCost(open) : 0;
  const affordable = cost <= story.influence;
  const clues = [...story.clues].reverse();
  return (
    <div className="missions">
      <p className="resources"><span title="Influence: spent on missions and direct powers; one point every other day, up to 30">◆ Influence <strong>{story.influence}</strong>/{STORY_ECON.influenceCap}</span> <span title="Knowledge: earned by investigating people and buildings and from evidence; spent to read visions plainly">◇ Knowledge <strong>{story.knowledge}</strong></span></p>
      <VisionBlock baseline={baseline} visions={visions} divergence={divergence} ended={ended} info={info} kindOf={kindOf} knowledge={story.knowledge} revealed={story.revealedVisions} live={live} onRevealVision={onRevealVision} />
      <h3 className="h4">Missions</h3>
      {!open && <div className="mission mission--empty"><p className="dim">No open mission. The Oracle speaks every few weeks, when the world gives it something to say: a researcher pushing too far, a king eyeing a neighbour, a granary running low.</p></div>}
      {open && (
        <article className="mission" aria-labelledby={`mission-${open.id}`}>
          <p className="mission__eyebrow">The Oracle · {civName(info, open.civ)} · {open.expiresDay - day} day{open.expiresDay - day === 1 ? "" : "s"} to answer</p>
          <h3 id={`mission-${open.id}`} className="mission__title">{open.title}</h3>
          <p className="mission__brief">{open.brief}</p>
          <p className="mission__action"><strong>If you act:</strong> {open.action} <span className={affordable ? "dim" : "mission__short"}>Costs ◆ {cost}{affordable ? "" : ` — you have ${story.influence}; one point comes every other day`}.</span></p>
          <div className="btnrow">
            {open.targets.citizen !== undefined && <button className="btn btn--ghost" onClick={() => onFocus({ kind: "citizen", id: open.targets.citizen! })}>Show the person</button>}
            {open.targets.building !== undefined && <button className="btn btn--ghost" onClick={() => onFocus({ kind: "building", id: open.targets.building! })}>Show the building</button>}
          </div>
          {!f && <p className="dim" role="status">The Oracle is running both futures…{live ? "" : " (forecasts are only computed for the live day)"} <button className="btn btn--ghost" onClick={() => onRefresh(open.id)}>Recompute</button></p>}
          {f && (
            <>
              <p className="dim">What the next {f.horizon} days hold, by replaying the world both ways from today ({f.ms} ms). The Oracle is exact about this world as it is; your later choices can still change it.</p>
              <div className="branches">
                <BranchCard b={f.act} other={f.ignore} info={info} kindOf={kindOf} />
                <BranchCard b={f.ignore} other={f.act} info={info} kindOf={kindOf} />
              </div>
            </>
          )}
          <div className="btnrow mission__answer">
            <button className="btn btn--primary" disabled={!live || !affordable} onClick={() => onAnswer(open.id, true)}>Act (◆ {cost})</button>
            <button className="btn" disabled={!live} onClick={() => onAnswer(open.id, false)}>Decline</button>
            {!live && <span className="dim">Return to today to answer.</span>}
          </div>
        </article>
      )}
      <h3 className="h4">What you have learned</h3>
      {clues.length === 0 && <p className="dim">Nothing yet. Investigate a person or a building from the Inspect tab (◆ 1) for a rumor or a record; story events leave clues of their own. Evidence is read from the world and is always true; a rumor is what someone believes.</p>}
      {clues.length > 0 && (
        <ul className="clues">
          {clues.slice(0, 30).map((c) => (
            <li key={c.id} className={`clue clue--${c.grade}`}>
              <span className="clue__grade">{c.grade}</span> <span className="dim">d{c.day}</span> {c.text}
              {c.refs.citizen !== undefined && info.citizens[c.refs.citizen] && <button className="link" onClick={() => onFocus({ kind: "citizen", id: c.refs.citizen! })}>{info.citizens[c.refs.citizen].name}</button>}
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <>
          <h3 className="h4">Past offers</h3>
          <ul className="mission__history">
            {past.map((m) => (
              <li key={m.id} className={`mission__past mission__past--${m.status}`}>
                <span className="dim">d{m.offeredDay}</span> <strong>{m.title}</strong> — {m.status === "accepted" ? "you acted" : m.status === "declined" ? "you declined" : "unanswered"}{m.resolvedDay >= 0 ? ` on day ${m.resolvedDay}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
