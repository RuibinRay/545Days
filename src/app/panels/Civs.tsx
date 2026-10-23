/** The civilizations panel: who they are, who rules, what they research, whom they hate. */
import type { CivSnapshot, SettlementSnapshot, WorldInfo } from "../../workers/protocol";
import { label, money } from "../frameView";
import type { Selection } from "../../render/scene";

type Props = {
  civs: CivSnapshot[];
  settlements: SettlementSnapshot[];
  info: WorldInfo;
  day: number;
  onFocus: (sel: Selection) => void;
  onCenter: (settlementId: number) => void;
};

export const CIV_COLORS = ["#f2c14e", "#6fa0d4", "#c0512f", "#8fd18a", "#d49bd6", "#f0a060"];
export const DISPOSITION_GLYPH: Record<string, string> = { agrarian: "🌾", scholarly: "⚗", martial: "⚔" };
const DISPOSITION_TEXT: Record<string, string> = {
  agrarian: "Farms and granaries. Keeps a food reserve, researches agriculture, arms only when threatened.",
  scholarly: "A lab and a library. Researches automation first; its machines are its strength and its risk.",
  martial: "A barracks and a crown. Measures its neighbours by their soldiers and acts on the difference.",
};

function attitudeWord(v: number): string {
  if (v <= -50) return "hostile";
  if (v <= -20) return "cold";
  if (v < 20) return "wary";
  if (v < 50) return "friendly";
  return "allied";
}

export function Civs({ civs, settlements, info, day, onFocus, onCenter }: Props): JSX.Element {
  return (
    <div className="civs">
      {civs.map((c) => {
        const color = CIV_COLORS[c.color % CIV_COLORS.length];
        const towns = c.settlements.map((id) => settlements.find((s) => s.id === id)).filter((s): s is SettlementSnapshot => !!s);
        const techRows: [string, number][] = [["agriculture", c.tech.agriculture], ["industry", c.tech.industry], ["medicine", c.tech.medicine], ["automation", c.tech.automation], ["military", c.tech.military]];
        return (
          <section key={c.id} className={`civ ${c.alive ? "" : "civ--fallen"}`} style={{ borderColor: color }} aria-label={c.name}>
            <header className="civ__head">
              <span className="civ__swatch" style={{ background: color }} aria-hidden="true" />
              <div>
                <h3 className="civ__name">{DISPOSITION_GLYPH[c.disposition]} {c.name}</h3>
                <p className="dim">{c.alive ? `${label(c.disposition)} ${c.form} · ${c.title} ${c.rulerName}` : "Fallen — its last town was taken"}</p>
              </div>
            </header>
            <p className="dim civ__blurb">{DISPOSITION_TEXT[c.disposition]}</p>
            <div className="civ__towns">
              {towns.map((t) => (
                <button key={t.id} className="btn btn--ghost" onClick={() => onCenter(t.id)} title="Centre the map here">
                  {t.name}{t.parent >= 0 ? ` (colony, day ${t.foundedDay})` : ""} · {t.population} people{t.homeless > 0 ? ` · ${t.homeless} outside` : ""}{t.foodRatio >= 150 ? ` · bread ${t.foodRatio}%` : ""}{t.fear > 0 ? ` · fear ${t.fear}` : ""}{t.unrest > 20 ? ` · unrest ${t.unrest}` : ""}
                </button>
              ))}
              {c.rulerId >= 0 && c.alive && (
                <button className="btn btn--ghost" onClick={() => onFocus({ kind: "citizen", id: c.rulerId })}>{c.title}: {c.rulerName}</button>
              )}
            </div>
            {c.alive && (
              <dl className="civ__facts">
                <div className="dl__row"><dt>Treasury</dt><dd>{money(c.treasury)} · tax {c.policies.taxRate}%</dd></div>
                <div className="dl__row"><dt>Legitimacy</dt><dd>{c.legitimacy}/100</dd></div>
                <div className="dl__row"><dt>Army</dt><dd>{c.soldiers} soldier{c.soldiers === 1 ? "" : "s"} · strength {c.strength} · budget {money(c.policies.militaryBudget)}/d</dd></div>
                <div className="dl__row"><dt>Research</dt><dd>{c.researchFocus} · budget {money(c.policies.researchBudget)}/d · oversight {c.policies.oversight}</dd></div>
                <div className="dl__row"><dt>Granary</dt><dd>{c.policies.foodReserveDays} days target{c.irrigated ? " · irrigated fields" : ""} · welfare {money(c.policies.welfare)}/d</dd></div>
                <div className="dl__row"><dt>Health</dt><dd>{c.sick > 0 ? <strong className="civ__warn">{c.sick} sick</strong> : "no fever"}{c.recovered ? ` · ${c.recovered} recovered` : ""}{c.quarantine ? " · gates closed" : ""} · clinic {money(c.policies.healthBudget)}/d</dd></div>
                <div className="dl__row"><dt>People</dt><dd>{c.population} · {c.births} born{c.migrantsIn > 0 || c.migrantsOut > 0 ? ` · ${c.migrantsIn} arrived, ${c.migrantsOut} left` : ""}{c.borders ? <strong className="civ__warn"> · borders shut</strong> : ""}</dd></div>
                <div className="dl__row"><dt>Trade</dt><dd>{c.tradeIn + c.tradeOut > 0 ? `${c.tradeIn} units in · ${c.tradeOut} out` : "no caravans yet"}{c.exportBan ? <strong className="civ__warn"> · grain exports banned</strong> : ""}</dd></div>
              </dl>
            )}
            {c.alive && (
              <ul className="meters" aria-label="Technology">
                {techRows.map(([k, v]) => (
                  <li key={k}>
                    <span className="meters__label">{label(k)}</span>
                    <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={k}><span className="meter__fill" style={{ width: `${v}%`, background: k === c.researchFocus ? color : undefined }} /></span>
                    <span className="meters__value">{v}</span>
                  </li>
                ))}
                <li>
                  <span className="meters__label">Machine risk</span>
                  <span className="meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.tech.machineAutonomyRisk} aria-label="machine autonomy risk"><span className="meter__fill meter__fill--danger" style={{ width: `${c.tech.machineAutonomyRisk}%` }} /></span>
                  <span className="meters__value">{c.tech.machineAutonomyRisk}</span>
                </li>
              </ul>
            )}
            {c.alive && civs.length > 1 && (
              <ul className="civ__relations" aria-label="Relations">
                {civs.filter((o) => o.id !== c.id).map((o) => {
                  const v = c.attitude[o.id] ?? 0;
                  const atWar = c.wars.includes(o.id);
                  return (
                    <li key={o.id} className={atWar ? "civ__rel civ__rel--war" : "civ__rel"}>
                      <span className="civ__swatch civ__swatch--small" style={{ background: CIV_COLORS[o.color % CIV_COLORS.length] }} aria-hidden="true" />
                      {o.alive ? o.name : `${o.name} (fallen)`}: <strong>{atWar ? "AT WAR" : attitudeWord(v)}</strong> <span className="dim">({v > 0 ? "+" : ""}{v}{!atWar && c.ceasefireUntil > day ? ` · ceasefire ${c.ceasefireUntil - day} d` : ""})</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {c.conquests > 0 && <p className="dim">Conquests: {c.conquests}</p>}
          </section>
        );
      })}
      <p className="dim">Civilizations are the map's colours: territory, roofs and banners. {info.civs.length === 1 ? "This world has one civilization; create a world with two or three for diplomacy and war." : ""}</p>
    </div>
  );
}
