/** The World tab (split out of Game.tsx in M8): name, saves, export, display settings, keys and the ?why panel. */
import type { RenderFrame, WorldInfo } from "../../workers/protocol";
import type { OverlayMode, RenderStatus, Tier } from "../../render/scene";
import type { SimClient } from "../simClient";
import { useEffect, useState } from "react";
import { setSoundEnabled, soundEnabled } from "../sound";
import { currentVitals, fmtVital, onVitals, vitalsReport } from "../vitals";
import type { Vitals } from "../vitals";

export type TierSetting = "auto" | "lite" | "still" | "text";

type Props = {
  info: WorldInfo | null;
  frame: RenderFrame | null;
  client: SimClient | null;
  seed: number;
  worldName: string;
  setWorldName: (v: string) => void;
  savedAt: { day: number; auto: boolean } | null;
  overlay: OverlayMode;
  setOverlay: (m: OverlayMode) => void;
  activeTier: Tier;
  tierReason: string;
  tierSetting: TierSetting;
  setTierSetting: (t: TierSetting) => void;
  reducedMotion: boolean;
  setReducedMotion: (v: boolean) => void;
  showWhy: boolean;
  status: RenderStatus | null;
  onExportChronicle: () => void;
};

export function WorldTab(props: Props): JSX.Element {
  const [sound, setSound] = useState<boolean>(() => soundEnabled());
  const [vitals, setVitals] = useState<Vitals>(() => currentVitals());
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => onVitals(setVitals), []);
  return <WorldTabInner {...props} sound={sound} setSound={setSound} vitals={vitals} copied={copied} setCopied={setCopied} />;
}

type Inner = Props & { sound: boolean; setSound: (v: boolean) => void; vitals: Vitals; copied: string | null; setCopied: (v: string | null) => void };

function WorldTabInner({ sound, setSound, vitals, copied, setCopied,  info, frame, client, seed, worldName, setWorldName, savedAt, overlay, setOverlay, activeTier, tierReason, tierSetting, setTierSetting, reducedMotion, setReducedMotion, showWhy, status, onExportChronicle }: Inner): JSX.Element {
  return (
  <section role="tabpanel">
    <h3 className="h4">This world</h3>
    <label className="field">
      <span>Name</span>
      <span className="field__row">
        <input value={worldName} onChange={(e) => setWorldName(e.target.value)} onBlur={() => worldName.trim() && client?.rename(worldName.trim())} aria-label="World name" />
      </span>
    </label>
    <p className="dim">Seed {info?.seed ?? seed} · {info?.settings.terrain} · {info?.settings.climate} · {info?.width}×{info?.height} · {info?.settings.civs} civilization{info?.settings.civs === 1 ? "" : "s"} of {info?.settings.population}{info?.forkedFrom ? ` · branched from "${info.forkedFrom.name}" at day ${info.forkedFrom.day}` : ""}</p>
    <p className="dim">{savedAt ? `Saved ${savedAt.auto ? "automatically" : ""} at day ${savedAt.day}. ` : "Not saved yet — the world saves itself every 30 days. "}Saved worlds appear under "Continue a world" on the start page.</p>
    <div className="btnrow">
      <button className="btn" onClick={() => client?.save()}>Save now</button>
      <button className="btn" onClick={() => client?.export()}>Export file</button>
      <button className="btn" onClick={onExportChronicle} disabled={!info}>Download the record</button>
      <button className="btn btn--ghost" onClick={() => { if (confirm("Restart this world from day 0 with the same seed? The current run stays saved.")) client?.restart(); }}>Restart from day 0</button>
    </div>
    <p className="dim">An export is tiny: the seed, the settings and your interventions. Importing replays them and checks the result against the hash in the file. The record is the chronicle as a Markdown file — every notable day, your hand, and the ending once it is written.</p>

    <h3 className="h4">Performance on this device</h3>
    <p className="dim">Measured here, in your browser, by the page itself — not estimated. Good means under 2.5 s (LCP), 200 ms (INP) and 0.1 (CLS). The copied report has no personal data beyond what your browser tells every site.</p>
    <dl className="civ__facts">
      {(["LCP", "INP", "CLS"] as const).map((k) => (
        <div className="dl__row" key={k}><dt>{k}</dt><dd>{fmtVital(k, vitals[k])}{vitals.rating[k] ? <span className={`dim`}> · {vitals.rating[k].replace("-", " ")}</span> : <span className="dim"> · {k === "INP" ? "needs a few interactions" : "measuring…"}</span>}</dd></div>
      ))}
    </dl>
    <div className="btnrow">
      <button className="btn" onClick={() => { const text = vitalsReport({ tier: activeTier, fps: status?.fps, "worker step ms": frame ? Number(frame.stepMs.toFixed(2)) : undefined, "terrain bake ms": status?.bakeMs, day: frame?.day, seed: info?.seed }); void navigator.clipboard?.writeText(text).then(() => setCopied("Copied — paste it into an issue or a note."), () => setCopied(text)); }}>Copy performance report</button>
    </div>
    {copied && <pre className="dim why__report" role="status">{copied}</pre>}

    <h3 className="h4">Display</h3>
    <label className="field">
      <span>Map overlay</span>
      <select value={overlay} onChange={(e) => setOverlay(e.target.value as OverlayMode)} aria-label="Map overlay" disabled={activeTier !== "full" && activeTier !== "lite"}>
        <option value="none">None</option>
        <option value="political">Territory</option>
        <option value="moisture">Soil moisture (Day 0)</option>
        <option value="elevation">Elevation</option>
        <option value="resources">Resource deposits</option>
        <option value="food">Food prices (live)</option>
        <option value="wealth">Wealth (live)</option>
        <option value="sickness">Sickness (live)</option>
        <option value="trade">Trade roads and gates (live)</option>
      </select>
    </label>
    {overlay !== "none" && (
      <p className="dim" role="note">
        {overlay === "political" && "Each town's claimed land in its civilization's colour."}
        {overlay === "moisture" && "Soil moisture on Day 0: deeper blue is wetter land."}
        {overlay === "elevation" && "Height above the sea, dark to light."}
        {overlay === "resources" && "Deposits: green fertile soil, grey stone, dark coal, cyan water."}
        {overlay === "food" && "Bread around each town: green at the usual price, amber at half again, red at double or more. Redrawn every five days."}
        {overlay === "wealth" && "Mean wealth of a town's people against the world's: dark is poor, bright gold is rich. Redrawn every five days."}
        {overlay === "sickness" && "Share of a town's people sick or incubating: green none, red a third or more. Redrawn every five days."}
        {overlay === "trade" && "Gold roads are routes caravans have used, brighter with today's traffic. Rings: red a grain export ban, grey shut borders, green a quarantine."}
      </p>
    )}
    <label className="check">
      <input type="checkbox" checked={reducedMotion} onChange={(e) => setReducedMotion(e.target.checked)} />
      Reduce motion (citizens snap instead of walk; no water animation)
    </label>
    <label className="check">
      <input type="checkbox" checked={sound} onChange={(e) => { setSoundEnabled(e.target.checked); setSound(e.target.checked); }} />
      Sound cues (short synthesized tones for offers, warnings, achievements and endings; off by default)
    </label>
    <label className="field">
      <span>Rendering</span>
      <select value={tierSetting} onChange={(e) => setTierSetting(e.target.value as TierSetting)}>
        <option value="auto">Automatic</option>
        <option value="lite">Lite (fewer effects)</option>
        <option value="still">Still image (no WebGL)</option>
        <option value="text">Text only</option>
      </select>
    </label>
    <p className="dim">Active: <strong>{activeTier}</strong> — {tierReason}</p>
    <p className="dim">Keys: arrows/WASD pan · + − zoom · space pause · 1 2 3 speeds · Esc clear</p>
    {showWhy && (
      <div className="why">
        <h3 className="h4">?why</h3>
        <dl>
          <dt>tier</dt><dd>{activeTier} ({tierReason})</dd>
          <dt>fps</dt><dd>{status?.fps ?? "–"}</dd>
          <dt>renderer</dt><dd>{status?.renderer ?? (activeTier === "still" ? "canvas2d" : "–")}</dd>
          <dt>zoom</dt><dd>{status?.zoom ?? "–"}</dd>
          <dt>citizens drawn</dt><dd>{status?.visibleCitizens ?? "–"}</dd>
          <dt>context losses</dt><dd>{status?.contextLosses ?? 0}</dd>
          <dt>LCP / INP / CLS</dt><dd>{fmtVital("LCP", vitals.LCP)} / {fmtVital("INP", vitals.INP)} / {fmtVital("CLS", vitals.CLS)}</dd>
          <dt>terrain bake</dt><dd>{status ? (status.bakePending > 0 ? `${status.bakePending} chunks pending` : `${status.bakeMs} ms`) : "–"}</dd>
          <dt>worker step</dt><dd>{frame ? `${frame.stepMs.toFixed(2)} ms` : "–"}</dd>
          <dt>state hash</dt><dd><code>{frame?.hash ?? "–"}</code></dd>
          <dt>day-0 hash</dt><dd><code>{info?.initialHash ?? "–"}</code></dd>
          <dt>cores</dt><dd>{navigator.hardwareConcurrency ?? "?"}</dd>
          <dt>dpr</dt><dd>{window.devicePixelRatio}</dd>
        </dl>
      </div>
    )}
  </section>
  );
}
