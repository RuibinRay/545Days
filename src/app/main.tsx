import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Self-hosted type: Instrument Sans (SIL OFL) from /public/fonts with font-display: optional and a
// preload in index.html (M9) — the font never swaps in late, so it never shifts the layout.
import "./styles.css";
import { startVitals } from "./vitals";

startVitals();

const el = document.getElementById("root");
if (!el) throw new Error("#root missing");
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
