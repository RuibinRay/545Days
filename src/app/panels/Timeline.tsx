import { useEffect, useRef } from "react";
import { DAYS } from "../../sim/engine";
import type { WorldEvent } from "../../sim/types";

type Props = {
  day: number;           // live day
  viewDay: number | null; // day being peeked, or null for live
  events: WorldEvent[];
  interventions: { day: number }[];
  onScrub: (day: number | null) => void;
};

/**
 * The 545-day strip. Event marks are importance ≥ 5 (ember) and ≥ 7 (tall). Dragging the thumb
 * replays the world to that day from the nearest snapshot (the Worker's `peek`); the simulation
 * waits while you look.
 */
export function Timeline({ day, viewDay, events, interventions, onScrub }: Props): JSX.Element {
  const ref = useRef<HTMLInputElement>(null);
  const max = Math.max(day, 1);
  const marks = events.filter((e) => e.importance >= 5 && e.day <= day);
  const pos = (d: number) => `${(100 * d) / DAYS}%`;
  const current = viewDay ?? day;

  useEffect(() => {
    // keep the thumb in sync when the live day advances and nobody is scrubbing
    if (viewDay === null && ref.current) ref.current.value = String(day);
  }, [day, viewDay]);

  return (
    <div className={`timeline ${viewDay !== null ? "timeline--peeking" : ""}`} role="group" aria-label="Timeline">
      <div className="timeline__track" aria-hidden="true">
        <div className="timeline__lived" style={{ width: pos(day) }} />
        {interventions.map((iv, i) => (
          <span key={`iv${i}`} className="timeline__iv" style={{ left: pos(iv.day) }} title={`Day ${iv.day}: intervention`} />
        ))}
        {marks.map((e, i) => (
          <span key={i} className={`timeline__mark ${e.importance >= 7 ? "timeline__mark--big" : ""}`} style={{ left: pos(e.day) }} title={`Day ${e.day}: ${e.type}`} />
        ))}
        <span className="timeline__end" style={{ left: pos(DAYS) }} title="Day 545" />
        <span className="timeline__now" style={{ left: pos(current) }} />
      </div>
      <input
        ref={ref}
        className="timeline__input"
        type="range"
        min={0}
        max={max}
        defaultValue={day}
        aria-label={`View day (0 to ${day})`}
        aria-valuetext={`Day ${current}`}
        onInput={(e) => {
          const d = Number((e.target as HTMLInputElement).value);
          onScrub(d >= day ? null : d);
        }}
      />
      <div className="timeline__legend">
        {viewDay !== null ? (
          <>
            <span className="timeline__badge">Viewing day {viewDay} of {day}</span>
            <button className="btn btn--ghost" onClick={() => onScrub(null)}>Return to today</button>
          </>
        ) : (
          <span className="dim">Drag to look back · {marks.length} notable events · {interventions.length} intervention{interventions.length === 1 ? "" : "s"}</span>
        )}
      </div>
    </div>
  );
}
