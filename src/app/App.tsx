import { Game } from "./Game";
import { Home } from "./Home";
import { useRoute } from "./router";
import { EpilogueGallery } from "./EpilogueGallery";

export function App(): JSX.Element {
  const route = useRoute();
  if (route.name === "world") {
    return <Game key={`${route.load ?? ""}-${route.seed}-${route.terrain}-${route.climate}-${route.size}-${route.civs}-${route.population}`} seed={route.seed} terrain={route.terrain} climate={route.climate} size={route.size} civs={route.civs} population={route.population} load={route.load} />;
  }
  if (new URLSearchParams(location.search).has("gallery")) return <EpilogueGallery />;
  return <Home />;
}
