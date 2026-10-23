import { useEffect, useRef, useState } from "react";
import { EPILOGUE_H, EPILOGUE_W, drawEpilogue } from "../../render/epilogue";
import type { EndingResult, Intervention } from "../../sim/types";
import type { Baseline, Divergence } from "../../sim/story/oracle";

type Props = {
  ending: EndingResult;
  worldName: string;
  snapshotDays: number[];
  onContinue: () => void;
  onRestart: () => void;
  onFork: (day: number) => void;
  onNewWorld: () => void;
  onExport: () => void;
  baseline?: Baseline | null;
  divergence?: Divergence | null;
  interventions?: Intervention[];
};

/** Day 545 (or an earlier end). The epilogue is the resolver's text; every number is from state. */
export function EndingScreen({ ending, worldName, snapshotDays, onContinue, onRestart, onFork, onNewWorld, onExport, baseline, divergence, interventions = [] }: Props): JSX.Element {
  const acted = interventions.filter((iv) => iv.type !== "mission" || iv.accept).length;
  const same = baseline ? baseline.endingId === ending.id : null;
  const forkable = snapshotDays.filter((d) => d > 0 && d < ending.day);
  const [forkDay, setForkDay] = useState<number>(forkable[Math.max(0, forkable.length - 3)] ?? 0);
  const artRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = artRef.current;
    if (!el) return;
    const g = el.getContext("2d");
    if (!g) return;
    try {
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, el.width, el.height);
      g.drawImage(drawEpilogue(ending), 0, 0);
    } catch { /* no 2D canvas: the words carry the ending */ }
  }, [ending]);
  return (
    <div className="ending" role="dialog" aria-modal="true" aria-labelledby="ending-title">
      <div className="ending__card">
        <p className="ending__eyebrow">{worldName} · day {ending.day} · {ending.family === "fallback" ? "no special ending applied" : ending.family}</p>
        <h2 id="ending-title" className="ending__title">{ending.title}</h2>
        <canvas ref={artRef} className="ending__art" width={EPILOGUE_W} height={EPILOGUE_H} role="img" aria-label={`A scene for ${ending.title}`} />
        <dl className="ending__stats">
          {ending.stats.map((s) => (
            <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>
          ))}
        </dl>
        {baseline && (
          <div className="ending__oracle">
            <p><strong>The Oracle foresaw:</strong> {baseline.endingTitle}. <strong>What came:</strong> {ending.title}. {same ? "The vision held." : "The vision did not hold."}</p>
            <p className="dim">{acted === 0 ? "You did not intervene; the world went exactly where it was going." : `${acted} intervention${acted === 1 ? "" : "s"} of yours; the world departed from the vision by ${divergence?.score ?? 0} on a scale of 100.`}{divergence && divergence.unforeseen.length > 0 ? ` ${divergence.unforeseen.length} unforeseen turning point${divergence.unforeseen.length === 1 ? "" : "s"}.` : ""}</p>
          </div>
        )}
        <div className="ending__text">
          {ending.epilogue.map((p, i) => <p key={i}>{p}</p>)}
          {ending.secondary.length > 0 && <p className="dim">Also in play: {ending.secondary.map((s) => s.title).join(", ")}.</p>}
        </div>
        <div className="ending__actions">
          <button className="btn btn--primary" onClick={onContinue}>Continue living</button>
          <button className="btn" onClick={onRestart}>Restart the timeline</button>
          {forkable.length > 0 && (
            <span className="ending__fork">
              <label className="dim" htmlFor="fork-day">Alternate universe from</label>
              <select id="fork-day" value={forkDay} onChange={(e) => setForkDay(Number(e.target.value))}>
                {forkable.map((d) => <option key={d} value={d}>day {d}</option>)}
              </select>
              <button className="btn" onClick={() => onFork(forkDay)}>Branch</button>
            </span>
          )}
          <button className="btn" onClick={onNewWorld}>Generate a new world</button>
          <button className="btn btn--ghost" onClick={onExport}>Export this world</button>
        </div>
        <p className="dim ending__note">The same seed with the same actions always ends this way. A branch replays from a snapshot and goes wherever your next decisions take it.</p>
      </div>
    </div>
  );
}
