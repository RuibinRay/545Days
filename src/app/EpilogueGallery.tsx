/** `?gallery` (M10): every ending's scene side by side, for the design review. Not linked from the UI. */
import { useEffect, useRef } from "react";
import { ENDINGS } from "../sim/story/endings";
import { drawEpilogue } from "../render/epilogue";

export function EpilogueGallery(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = "";
    for (const e of [...ENDINGS, { id: "fallback.fragile", title: "The Unfinished Age", family: "fallback" as const }]) {
      const fig = document.createElement("figure");
      fig.className = "gallery__item";
      const c = drawEpilogue(e);
      c.className = "ending__art";
      const cap = document.createElement("figcaption");
      cap.textContent = `${e.title} · ${e.id}`;
      fig.append(c, cap);
      host.appendChild(fig);
    }
  }, []);
  return <main className="home"><h1>Epilogue scenes</h1><div ref={ref} className="gallery" /></main>;
}
