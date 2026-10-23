/**
 * The first-session guide (M8): one line at a time, keyed to what the world is doing, dismissed
 * for good with one click. It never blocks the map and never repeats once the player has seen it.
 */
import { useEffect, useState } from "react";
import type { RenderFrame } from "../../workers/protocol";

const KEY = "545.guideDone";

type Step = { id: string; when: (f: RenderFrame | null, speed: number) => boolean; text: string };

const STEPS: Step[] = [
  { id: "start", when: (f, speed) => !!f && f.day === 0 && speed === 0, text: "This world will run for 545 days. Press 1× (or the space bar) to start the count; click any roof or person to read about them." },
  { id: "running", when: (f, speed) => !!f && f.day > 0 && f.day < 15 && speed > 0, text: "Citizens work, shop and sleep; the ticker tells you what mattered today. The Civs tab shows who rules whom; the Chronicle keeps everything." },
  { id: "mission", when: (f) => !!f && f.missions.some((m) => m.status === "offered"), text: "The Oracle has an offer. The Oracle tab shows what the next 90 days hold if you act and if you don't — both are really run. Either answer counts." },
  { id: "powers", when: (f) => !!f && f.day >= 20 && f.story.influence >= 10, text: "◆ Influence pays for powers (Powers tab, or Investigate / Remove in the Inspector). ◇ Knowledge comes from investigating and buys a plain reading of the Oracle's visions." },
  { id: "overlays", when: (f) => !!f && f.day >= 45, text: "World tab → Map overlay shows food prices, sickness and the trade roads. Drag the timeline to look back; branch a world from any snapshot." },
];

export function Guide({ frame, speed }: { frame: RenderFrame | null; speed: number }): JSX.Element | null {
  const [done, setDone] = useState<boolean>(() => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } });
  const [seen, setSeen] = useState<string[]>([]);
  const [current, setCurrent] = useState<Step | null>(null);

  useEffect(() => {
    if (done) return;
    const next = STEPS.find((s) => !seen.includes(s.id) && s.when(frame, speed));
    if (next && next.id !== current?.id) setCurrent(next);
  }, [frame, speed, seen, done, current]);

  if (done || !current) return null;
  const dismiss = () => { setSeen((s) => [...s, current.id]); setCurrent(null); };
  const finish = () => { setDone(true); try { localStorage.setItem(KEY, "1"); } catch { /* private mode */ } };
  return (
    <div className="guide" role="status">
      <span className="guide__text">{current.text}</span>
      <span className="guide__actions">
        <button className="btn btn--ghost" onClick={dismiss}>Got it</button>
        <button className="btn btn--ghost" onClick={finish} aria-label="Turn the guide off for good">No more tips</button>
      </span>
    </div>
  );
}
