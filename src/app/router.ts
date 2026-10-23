import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "world"; seed: number; terrain: string; climate: string; size: string; civs: number; population: number; load: string | null };

/** Hash router: works on GitHub Pages with no 404 rewrite (docs/01 §8). */
export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path, query = ""] = h.split("?");
  if (path === "world") {
    const q = new URLSearchParams(query);
    const seed = Number(q.get("seed"));
    return {
      name: "world",
      seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : 545,
      terrain: q.get("terrain") ?? "continent",
      climate: q.get("climate") ?? "temperate",
      size: q.get("size") ?? "medium",
      civs: Math.min(3, Math.max(1, Number(q.get("civs") ?? 3) || 3)),
      population: Math.min(150, Math.max(10, Number(q.get("pop") ?? 100) || 100)),
      load: q.get("load"),
    };
  }
  return { name: "home" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(route: Route): void {
  if (route.name === "home") location.hash = "#/";
  else if (route.load) location.hash = `#/world?load=${encodeURIComponent(route.load)}&seed=${route.seed}`;
  else location.hash = `#/world?seed=${route.seed}&terrain=${route.terrain}&climate=${route.climate}&size=${route.size}&civs=${route.civs}&pop=${route.population}`;
}
