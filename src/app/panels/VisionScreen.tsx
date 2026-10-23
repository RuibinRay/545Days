/**
 * Day 0: the Oracle shows what it saw. Three to five fragments of the untouched future, revealed
 * one at a time (click, Enter or Space), then the count begins. Nothing here is invented: every
 * fragment maps to an event or the ending of the baseline run.
 */
import { useEffect, useState } from "react";
import type { Vision } from "../../sim/story/oracle";

type Props = { visions: Vision[]; worldName: string; ms: number; reducedMotion: boolean; onBegin: () => void };

export function VisionScreen({ visions, worldName, ms, reducedMotion, onBegin }: Props): JSX.Element {
  const [shown, setShown] = useState(1);
  const all = shown >= visions.length;
  const next = () => (all ? onBegin() : setShown((n) => n + 1));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); next(); }
      if (e.key === "Escape") onBegin();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  return (
    <div className={`vision ${reducedMotion ? "vision--still" : ""}`} role="dialog" aria-modal="true" aria-labelledby="vision-title" onClick={next}>
      <div className="vision__card" onClick={(e) => e.stopPropagation()}>
        <p className="vision__eyebrow">{worldName} · before day 1</p>
        <h2 id="vision-title" className="vision__title">The Oracle has seen 545 days</h2>
        <p className="dim">It ran this world forward, untouched, to the end of the count ({(ms / 1000).toFixed(1)} s). These are fragments of what it found. The future is exact — and it has not happened yet.</p>
        <ol className="vision__list" aria-live="polite">
          {visions.slice(0, shown).map((v, i) => (
            <li key={i} className={`vision__item ${v.source.type === "ending" ? "vision__item--ending" : ""}`} style={{ animationDelay: "0ms" }}>
              <span className="vision__glyph" aria-hidden="true">{v.source.type === "ending" ? "◈" : "◇"}</span>
              <span>{v.cryptic}</span>
            </li>
          ))}
        </ol>
        <div className="btnrow vision__actions">
          {!all && <button className="btn btn--primary" onClick={next}>Show me more</button>}
          {all && <button className="btn btn--primary" onClick={onBegin}>Begin the count</button>}
          <button className="btn btn--ghost" onClick={onBegin}>Skip</button>
        </div>
        <p className="dim vision__note">The fragments stay in the Oracle tab. Every mission you take or leave moves the world away from this vision; the Oracle tab keeps score of how far.</p>
      </div>
    </div>
  );
}
