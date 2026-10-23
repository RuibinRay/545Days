/** The Powers tab (split out of Game.tsx in M8): sandbox drought, decrees on gates and grain, founding a colony. */
import type { RenderFrame } from "../../workers/protocol";
import type { EndingResult } from "../../sim/types";
import { STORY_ECON } from "../../sim/types";
import { money } from "../frameView";
import type { SimClient } from "../simClient";

type Props = {
  frame: RenderFrame | null;
  client: SimClient | null;
  liveDay: number;
  peeking: boolean;
  scrub: (day: number | null) => void;
  ending: EndingResult | null;
  droughtIntensity: number;
  setDroughtIntensity: (v: number) => void;
  powerCiv: number;
  setPowerCiv: (id: number) => void;
};

export function Powers({ frame, client, liveDay, peeking, scrub, ending, droughtIntensity, setDroughtIntensity, powerCiv, setPowerCiv }: Props): JSX.Element {
  return (
  <section role="tabpanel">
    <h3 className="h4">Drought</h3>
    <p className="dim">Sandbox power — affects every town. Soil moisture falls every day for the duration (slowly on river-fed land, fast elsewhere); farm output follows; prices and hunger follow that. Applied at the start of the next day, recorded with the run, and a snapshot is taken first so you can branch from this moment later.</p>
    <label className="field">
      <span>Intensity: {droughtIntensity} → {20 + droughtIntensity} days</span>
      <input type="range" min={10} max={100} step={5} value={droughtIntensity} onChange={(e) => setDroughtIntensity(Number(e.target.value))} />
    </label>
    <button className="btn btn--primary" onClick={() => { if (peeking) scrub(null); client?.intervene({ day: liveDay + 1, type: "disaster", kind: "drought", settlement: 0, intensity: droughtIntensity }); }} disabled={!frame}>Begin a drought</button>
    <h3 className="h4">Gates and grain</h3>
    <p className="dim">Decrees on a civilization's gates. A decree binds its ruler for 120 days; after that the council manages the gate itself again. Each costs {STORY_ECON.cost.set_policy} ◆.</p>
    {frame && frame.civs.filter((c) => c.alive).length > 0 && (() => {
      const civs = frame.civs.filter((c) => c.alive);
      const c = civs.find((x) => x.id === powerCiv) ?? civs[0];
      const lockedUntil = (k: "borders" | "exportBan" | "quarantine") => c.policyLock[k] ?? -1;
      const decree = (key: "borders" | "exportBan" | "quarantine", value: number) => { if (peeking) scrub(null); client?.intervene({ day: liveDay + 1, type: "set_policy", civ: c.id, key, value }); };
      const canPay = frame.story.influence >= STORY_ECON.cost.set_policy;
      return (
        <>
          <label className="field">
            <span>Civilization</span>
            <select value={c.id} onChange={(e) => setPowerCiv(Number(e.target.value))} aria-label="Civilization for decrees">
              {civs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <dl className="civ__facts">
            <div className="dl__row"><dt>Borders</dt><dd>{c.borders ? "shut to migrants" : "open"}{lockedUntil("borders") > liveDay ? ` · your decree until day ${lockedUntil("borders")}` : ""} · {c.migrantsIn} came, {c.migrantsOut} left</dd></div>
            <div className="dl__row"><dt>Grain exports</dt><dd>{c.exportBan ? "banned" : "allowed"}{lockedUntil("exportBan") > liveDay ? ` · your decree until day ${lockedUntil("exportBan")}` : ""} · {c.tradeOut} units out, {c.tradeIn} in</dd></div>
            <div className="dl__row"><dt>Quarantine</dt><dd>{c.quarantine ? "gates closed to travellers" : "open"}{lockedUntil("quarantine") > liveDay ? ` · your decree until day ${lockedUntil("quarantine")}` : ""}</dd></div>
          </dl>
          <div className="btnrow">
            <button className="btn" disabled={!canPay || ending !== null} onClick={() => decree("borders", c.borders ? 0 : 100)}>{c.borders ? "Open the borders" : "Shut the borders"}</button>
            <button className="btn" disabled={!canPay || ending !== null} onClick={() => decree("exportBan", c.exportBan ? 0 : 100)}>{c.exportBan ? "Lift the export ban" : "Ban grain exports"}</button>
            <button className="btn" disabled={!canPay || ending !== null} onClick={() => decree("quarantine", c.quarantine ? 0 : 100)}>{c.quarantine ? "Lift the quarantine" : "Declare a quarantine"}</button>
          </div>
          <h3 className="h4">A new town</h3>
          <p className="dim">Found a colony of {c.name}'s first town a day's walk away — three houses, two farms, a market — settled by its homeless and jobless with their households. Costs the treasury $4,000 and you {STORY_ECON.cost.found_colony} ◆; needs land within reach, no war, and under three towns.</p>
          <button className="btn btn--primary" disabled={frame.story.influence < STORY_ECON.cost.found_colony || c.treasury < 400000 || c.settlements.length >= 3 || c.wars.length > 0 || ending !== null} onClick={() => { if (peeking) scrub(null); client?.intervene({ day: liveDay + 1, type: "found_colony", civ: c.id, from: c.settlements[0] }); }}>
            Found a colony of {frame.settlements.find((s) => s.id === c.settlements[0])?.name ?? c.name}
          </button>
          {c.treasury < 400000 && <p className="dim">{c.name}'s treasury holds {money(c.treasury)}; a colony costs $4,000.</p>}
        </>
      );
    })()}
    <h3 className="h4">Direct powers</h3>
    <p className="dim">Select a person or a building in the Inspect tab to remove or destroy it directly — the same actions the Oracle's missions use, without the forecast. Every use is recorded and has consequences.</p>
  </section>
  );
}
