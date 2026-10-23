import { useState } from "react";
import type { DailyMetrics, WorldEvent } from "../../sim/types";
import type { WorldInfo } from "../../workers/protocol";
import { eventText } from "../events";
import type { WorldView } from "../frameView";
import type { Selection } from "../../render/scene";
import { explain } from "../why";
import type { CauseNode } from "../why";

type Props = {
  events: WorldEvent[];
  metrics: DailyMetrics[];
  foodPrices: { day: number; price: number }[];
  info: WorldInfo | null;
  view: WorldView | null;
  onFocus: (s: Selection) => void;
  onGoToDay: (day: number) => void;
  highlightDay: number | null;
};

/** The town's history, newest first. Every line is an engine event; nothing is generated text. */
export function Chronicle({ events, metrics, foodPrices, info, view, onFocus, onGoToDay, highlightDay }: Props): JSX.Element {
  const [open, setOpen] = useState<number | null>(null);
  const kindOf = (bizId: number) => view?.businesses.find((x) => x.id === bizId)?.kind ?? "business";
  const shown = events.filter((e) => e.importance >= 3).slice(-80).reverse();
  if (shown.length === 0) return <p className="dim">Nothing has happened yet. Press play.</p>;

  const target = (e: WorldEvent): Selection | null => {
    if (e.citizens?.length) return { kind: "citizen", id: e.citizens[0] };
    if (e.businesses?.length && view) {
      const b = view.businesses.find((x) => x.id === e.businesses![0]);
      if (b) return { kind: "building", id: b.building };
    }
    return null;
  };

  const renderCauses = (nodes: CauseNode[], depth = 0): JSX.Element | null =>
    nodes.length === 0 ? null : (
      <ul className={`why__list why__list--${depth}`}>
        {nodes.map((n, i) => (
          <li key={i}>
            <span className="why__arrow">←</span>{" "}
            {n.event ? (
              <>
                <button className="link" onClick={() => onGoToDay(n.event!.day)}>day {n.event.day}</button>: {eventText(n.event, info, kindOf)}
              </>
            ) : (
              <>
                {n.label}{n.detail ? <span className="dim"> — {n.detail}</span> : null}
              </>
            )}
            {renderCauses(n.children, depth + 1)}
          </li>
        ))}
      </ul>
    );

  return (
    <ol className="chronicle" aria-live="polite">
      {shown.map((e, i) => {
        const idx = events.indexOf(e);
        const t = target(e);
        const isOpen = open === idx;
        return (
          <li key={`${e.day}-${i}`} className={`chronicle__item chronicle__item--${e.importance >= 6 ? "major" : "minor"} ${highlightDay === e.day ? "chronicle__item--hl" : ""}`}>
            <button className="chronicle__day link" onClick={() => onGoToDay(e.day)} title="View the map on this day">Day {e.day}</button>
            <span className="chronicle__text">
              {eventText(e, info, kindOf)}
              {(e.causes?.length ?? 0) > 0 && (
                <button className="link chronicle__why" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : idx)}>{isOpen ? "hide why" : "why?"}</button>
              )}
              {isOpen && <div className="why">{renderCauses(explain(e, events, metrics, foodPrices)) ?? <span className="dim">No recorded cause.</span>}</div>}
            </span>
            {t && <button className="link chronicle__go" onClick={() => onFocus(t)}>show</button>}
          </li>
        );
      })}
    </ol>
  );
}
