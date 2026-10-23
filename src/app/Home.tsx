import { useEffect, useRef, useState } from "react";
import { navigate } from "./router";
import { deleteWorld, listAchievements, listWorlds } from "../storage/db";
import type { AchievementRecord } from "../storage/db";
import { ACHIEVEMENTS } from "./achievements";
import type { SavedSummary, WorldExport } from "../sim/types";
import { SimClient } from "./simClient";

function randomSeed(): number {
  // UI-only randomness: the seed is shown and stored; the simulation never calls this.
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function Home(): JSX.Element {
  const [seed, setSeed] = useState<number>(() => randomSeed());
  const [terrain, setTerrain] = useState("continent");
  const [climate, setClimate] = useState("temperate");
  const [size, setSize] = useState("medium");
  const [civs, setCivs] = useState(3);
  const [population, setPopulation] = useState(100);
  const [saves, setSaves] = useState<SavedSummary[] | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [earned, setEarned] = useState<AchievementRecord[] | null>(null);
  useEffect(() => { listAchievements().then(setEarned).catch(() => setEarned([])); }, []);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => listWorlds().then(setSaves).catch(() => setSaves([]));
  useEffect(() => { void refresh(); }, []);

  const onImportFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as WorldExport;
      if (data.format !== "545days-world") throw new Error("not a 545 DAYS world file");
      setImportMsg(`Replaying ${data.day} days of "${data.name}"…`);
      // a short-lived Worker replays and saves the world, then we open it
      const client = new SimClient();
      client.on({
        imported: (ok, message) => {
          setImportMsg(message);
          const id = client.info?.id;
          client.destroy();
          if (id) navigate({ name: "world", seed: data.seed, terrain: data.settings.terrain, climate: data.settings.climate, size: data.settings.size, civs: data.settings.civs, population: data.settings.population, load: id });
          else void refresh();
          void ok;
        },
        error: (m) => { setImportMsg(`Import failed: ${m}`); client.destroy(); },
      });
      client.import(data);
    } catch (e) {
      setImportMsg(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main className="home">
      <header className="home__hero">
        <p className="home__eyebrow">M4 preview — civilizations, war, research and the Oracle's missions.</p>
        <h1 className="home__title">545 DAYS</h1>
        <p className="home__tag">Every world has a future. You decide whether it survives.</p>
      </header>

      <div className="home__grid">
        <form
          className="panel home__form"
          onSubmit={(e) => {
            e.preventDefault();
            navigate({ name: "world", seed, terrain, climate, size, civs, population, load: null });
          }}
        >
          <h2 className="panel__title">Create World</h2>
          <label className="field">
            <span>Seed</span>
            <span className="field__row">
              <input type="number" min={1} value={seed} onChange={(e) => setSeed(Math.max(1, Math.floor(Number(e.target.value) || 1)))} aria-describedby="seed-help" />
              <button type="button" className="btn btn--ghost" onClick={() => setSeed(randomSeed())}>Random</button>
            </span>
            <small id="seed-help">The same seed always produces the same world.</small>
          </label>
          <label className="field">
            <span>Terrain</span>
            <select value={terrain} onChange={(e) => setTerrain(e.target.value)}>
              <option value="continent">Continent</option>
              <option value="archipelago">Archipelago</option>
              <option value="islands">Islands</option>
            </select>
          </label>
          <label className="field">
            <span>Climate</span>
            <select value={climate} onChange={(e) => setClimate(e.target.value)}>
              <option value="temperate">Temperate</option>
              <option value="dry">Dry</option>
              <option value="mixed">Mixed (dry west, wet east)</option>
            </select>
          </label>
          <label className="field">
            <span>Civilizations</span>
            <select value={civs} onChange={(e) => { const n = Number(e.target.value); setCivs(n); if (n > 1 && size !== "medium") setSize("medium"); }}>
              <option value={1}>One — a quiet valley</option>
              <option value={2}>Two — a neighbour to reckon with</option>
              <option value={3}>Three — farmers, scholars and soldiers</option>
            </select>
            <small>Every civilization gets a disposition: agrarian, scholarly or martial. Three worlds have one of each.</small>
          </label>
          <label className="field">
            <span>People per civilization</span>
            <select value={population} onChange={(e) => setPopulation(Number(e.target.value))}>
              <option value={30}>30 — a hamlet</option>
              <option value={60}>60 — a village</option>
              <option value={100}>100 — a town</option>
            </select>
          </label>
          <label className="field">
            <span>Size</span>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="tiny">Tiny (64×64)</option>
              <option value="small">Small (96×96)</option>
              <option value="medium">Medium (128×128)</option>
            </select>
            {civs > 1 && size !== "medium" && <small>Two or three towns fit best on a medium map.</small>}
          </label>
          <button type="submit" className="btn btn--primary">Generate and open</button>
        </form>

        <section className="panel home__saves" aria-labelledby="saves-title">
          <h2 id="saves-title" className="panel__title">Continue a world</h2>
          {saves === null && <p className="dim">Looking for saved worlds…</p>}
          {saves && saves.length === 0 && <p className="dim">No saved worlds yet. Worlds save themselves every 30 days.</p>}
          {saves && saves.length > 0 && (
            <ul className="saves">
              {saves.map((s) => (
                <li key={s.id} className="saves__item">
                  <button className="saves__open" onClick={() => navigate({ name: "world", seed: s.seed, terrain: "continent", climate: "temperate", size: "medium", civs: 3, population: 100, load: s.id })}>
                    <strong>{s.name}</strong>
                    <span className="dim">{s.settlement} · day {s.day} · {s.population} people{s.endingTitle ? ` · ${s.endingTitle}` : ""}{s.forkedFrom ? ` · branch of ${s.forkedFrom.name}` : ""}</span>
                    <span className="dim">{ago(s.updatedAt)}</span>
                  </button>
                  <button className="btn btn--ghost saves__delete" aria-label={`Delete ${s.name}`} onClick={() => { if (confirm(`Delete "${s.name}"? This cannot be undone.`)) deleteWorld(s.id).then(refresh); }}>Delete</button>
                </li>
              ))}
            </ul>
          )}
          <div className="btnrow">
            <button className="btn btn--ghost" onClick={() => fileRef.current?.click()}>Import a world file</button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportFile(f); e.target.value = ""; }} />
          </div>
          {importMsg && <p className="dim" role="status">{importMsg}</p>}
        </section>
      </div>

      <section className="panel home__achievements" aria-labelledby="ach-title">
        <h2 id="ach-title" className="panel__title">Achievements <span className="dim">{earned ? `${earned.length} of ${ACHIEVEMENTS.length}` : ""}</span></h2>
        <p className="dim">Things seen across all your worlds. Earned ones say where; the rest only say their name.</p>
        <ul className="achievements">
          {ACHIEVEMENTS.map((a) => {
            const r = earned?.find((x) => x.id === a.id);
            return (
              <li key={a.id} className={r ? "ach ach--earned" : "ach"}>
                <span className="ach__mark" aria-hidden="true">{r ? "◆" : "◇"}</span>
                <span className="ach__body">
                  <strong>{a.title}</strong>
                  {r ? <span className="dim"> — {a.text} <em>({r.world || "a world"}, day {r.day})</em></span> : <span className="dim"> — locked</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="home__notes">
        <h2>What exists in this build</h2>
        <ul>
          <li>Up to three civilizations of 100 — agrarian, scholarly, martial — each with a ruler who sets policy, a lab that raises real tech levels, and a barracks. Rulers die and are succeeded; a weak succession becomes a coup. Couples form, children are born and come of age; households move together.</li>
          <li>Diplomacy drifts by disposition; wars are declared, soldiers march on the enemy town, raids kill, loot and ruin buildings, and a town that cannot hold is conquered. Caravans carry real goods between towns that trade; rulers ban grain exports when bread is dear and shut their borders when the houses are full. Crowded, solvent towns found colonies.</li>
          <li>Missions: every few weeks the Oracle offers one action — remove a researcher, depose a king, open a border, lift a grain ban, found a colony — and shows what the next 90 days hold if you act and if you don't, by actually running both. Either answer is a real choice.</li>
          <li>Eighteen designed endings are reachable — from Red Plague, The Famine Fever and The Great Exodus to The Green Compact, The Founders, The Merchant Road and The Divided Humanity — each with its own scene, plus the written-from-numbers epilogue. Live map overlays for food, wealth, sickness and trade; achievements kept across worlds; timeline scrubbing, branching, saves and exports as before.</li>
        </ul>
      </section>
    </main>
  );
}
