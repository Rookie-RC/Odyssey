// Loads the theme's CARTO base style and adapts it toward the Yu's Atlas
// Light/Night atmosphere defined in VISUAL_SPEC: warm parchment vs deep-navy
// cinematic. The base tiles (sources, glyphs, sprites) are untouched; only
// paint/layout values of known layers are overridden, so the adaptation is
// resilient to CARTO style-sheet updates (missing layers are skipped).
import type { StyleSpecification } from "maplibre-gl";
import type { ThemeId } from "../themes";

type LayerLike = {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  minzoom?: number;
};

type StyleLike = {
  layers?: LayerLike[];
};

const cache = new Map<string, Promise<StyleSpecification>>();

export function loadThemeStyle(
  themeId: ThemeId,
  styleUrl: string
): Promise<StyleSpecification> {
  const key = themeId + "|" + styleUrl;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const res = await fetch(styleUrl);
      if (!res.ok) throw new Error("failed to load map style: " + res.status);
      const style = (await res.json()) as StyleSpecification;
      return adaptBaseStyle(style, themeId);
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

// --- small mutation helpers ---

function paint(style: StyleLike, id: string, key: string, value: unknown): void {
  const layer = style.layers?.find((l) => l.id === id);
  if (!layer) return;
  layer.paint = layer.paint ?? {};
  layer.paint[key] = value;
}

// hideUntil defers a label/feature layer to a higher zoom so the hero view
// stays quiet and editorial while zooming in still reveals detail.
function hideUntil(style: StyleLike, id: string, minzoom: number): void {
  const layer = style.layers?.find((l) => l.id === id);
  if (!layer) return;
  layer.minzoom = minzoom;
}

function setLabel(style: StyleLike, id: string, color: string, halo: string, haloWidth = 1): void {
  paint(style, id, "text-color", color);
  paint(style, id, "text-halo-color", halo);
  paint(style, id, "text-halo-width", haloWidth);
}

function setRoadFamily(style: StyleLike, prefix: string, fill: string, caseColor: string): void {
  for (const l of style.layers ?? []) {
    if (!l.id.startsWith(prefix)) continue;
    if (l.type !== "line") continue;
    if (l.id.includes("fill")) paint(style, l.id, "line-color", fill);
    else if (l.id.includes("case")) paint(style, l.id, "line-color", caseColor);
  }
}

// --- theme adaptations ---

export function adaptBaseStyle(style: StyleSpecification, themeId: ThemeId): StyleSpecification {
  const s = JSON.parse(JSON.stringify(style)) as StyleSpecification;
  if (themeId === "night") adaptNight(s);
  else adaptLight(s);
  return s;
}

// Deep-navy, cinematic/cartographic night: water and land move off pure black
// into a navy family; labels soften to blue-gray; minor labels defer to zoom.
function adaptNight(style: StyleLike): void {
  const WATER = "#081422";
  const LAND = "#0E1B2C";
  const HALO = "#081220";

  // Unify land/water toward a single deep-navy void so the map reads as a
  // night sky with lights, not a flat political GIS map.
  paint(style, "background", "background-color", "#0A1322");
  for (const id of ["landcover", "park_national_park", "park_nature_reserve", "landuse"]) {
    paint(style, id, "fill-color", LAND);
  }
  paint(style, "landuse_residential", "fill-color", "rgba(8, 15, 26, 0.5)");
  paint(style, "water", "fill-color", WATER);
  paint(style, "waterway", "line-color", "rgba(30, 50, 76, 1)");
  paint(style, "building", "fill-color", "rgba(18, 28, 44, 0.85)");
  paint(style, "building-top", "fill-color", "rgba(20, 32, 50, 1)");

  // Boundaries: barely-there so the map stays a void, not a political map.
  paint(style, "boundary_country_outline", "line-color", "transparent");
  paint(style, "boundary_country_inner", "line-color", "rgba(96, 118, 144, 0.38)");
  paint(style, "boundary_state", "line-color", "rgba(64, 82, 104, 0.22)");
  paint(style, "boundary_county", "line-color", "rgba(58, 74, 94, 0.14)");

  // Roads read as faint navy-gray veins.
  setRoadFamily(style, "road", "#1A2C44", "#0E1B2E");
  setRoadFamily(style, "bridge", "#1A2C44", "#0E1B2E");
  setRoadFamily(style, "tunnel", "#1A2C44", "#0E1B2E");

  // Water labels: quiet blue-gray.
  setLabel(style, "waterway_label", "#5F7E9E", HALO);
  setLabel(style, "watername_ocean", "#5E7C9E", HALO);
  setLabel(style, "watername_sea", "#4E6C8C", HALO);
  setLabel(style, "watername_lake", "#64839F", HALO);
  setLabel(style, "watername_lake_line", "#64839F", HALO);

  // Place labels: soft blue-gray, halos keyed to the navy water so text stays
  // legible but never hot.
  setLabel(style, "place_country_2", "#647C99", HALO);
  setLabel(style, "place_country_1", "#6F87A3", HALO);
  setLabel(style, "place_state", "#5A7591", HALO);
  setLabel(style, "place_continent", "#728AA4", HALO);
  setLabel(style, "place_city_r6", "#93A6BE", HALO);
  setLabel(style, "place_city_r5", "#A3B6CC", HALO);
  for (const id of [
    "place_city_dot_r7", "place_city_dot_r4", "place_city_dot_r2", "place_city_dot_z7",
    "place_capital_dot_z7",
  ]) {
    setLabel(style, id, "#97AAC2", HALO);
  }
  setLabel(style, "place_town", "#74879E", HALO);
  setLabel(style, "place_villages", "#687B92", HALO);
  setLabel(style, "place_suburbs", "#687B92", HALO);
  setLabel(style, "place_hamlet", "#5F7289", HALO);

  // Road name labels: dim, deferred to higher zooms.
  setLabel(style, "roadname_minor", "#6A7C91", HALO);
  setLabel(style, "roadname_sec", "#7A8DA2", HALO);
  setLabel(style, "roadname_pri", "#8A9CB2", HALO);
  setLabel(style, "roadname_major", "#8A9CB2", HALO);
  setLabel(style, "poi_stadium", "#5E7E6A", HALO);
  setLabel(style, "poi_park", "#5E7E6A", HALO);

  // Density: keep minor settlements, POIs, secondary states and small-country
  // labels out of the hero viewport; they appear only once the user zooms in.
  hideUntil(style, "place_hamlet", 10);
  hideUntil(style, "place_suburbs", 10);
  hideUntil(style, "place_villages", 10);
  hideUntil(style, "place_town", 8);
  hideUntil(style, "place_state", 6.5);
  hideUntil(style, "place_country_2", 5.5);
  hideUntil(style, "poi_stadium", 13);
  hideUntil(style, "poi_park", 13);
  hideUntil(style, "roadname_minor", 12);
  hideUntil(style, "roadname_sec", 11);
  hideUntil(style, "roadname_pri", 10);
}

// Warm, quiet, editorial light: parchment land, pale blue water, labels with
// enough contrast to read but few enough to stay calm.
function adaptLight(style: StyleLike): void {
  const HALO = "#F7F4EC";

  paint(style, "background", "background-color", "#F6F3EA");
  for (const id of ["landcover", "park_national_park", "park_nature_reserve", "landuse"]) {
    paint(style, id, "fill-color", "#EDE9DC");
  }
  paint(style, "landuse_residential", "fill-color", "rgba(224, 221, 211, 0.55)");
  paint(style, "water", "fill-color", "#DBE7EF");
  paint(style, "waterway", "line-color", "#BFD2DC");
  paint(style, "building", "fill-color", "#EAE6DB");
  paint(style, "building-top", "fill-color", "#EDE9DF");

  paint(style, "boundary_country_outline", "line-color", "transparent");
  paint(style, "boundary_country_inner", "line-color", "#E4DAC8");
  paint(style, "boundary_state", "line-color", "#E1D7C4");
  paint(style, "boundary_county", "line-color", "#E8DECE");

  setRoadFamily(style, "road", "#FFFFFF", "#E2DED2");
  setRoadFamily(style, "bridge", "#FFFFFF", "#E2DED2");
  setRoadFamily(style, "tunnel", "#EDE9DF", "#E2DED2");

  setLabel(style, "waterway_label", "#8FA6B2", HALO);
  setLabel(style, "watername_ocean", "#9FB0BC", HALO);
  setLabel(style, "watername_sea", "#9FB0BC", HALO);
  setLabel(style, "watername_lake", "#8CA3B0", HALO);
  setLabel(style, "watername_lake_line", "#8CA3B0", HALO);

  setLabel(style, "place_country_2", "#8A97A3", HALO);
  setLabel(style, "place_country_1", "#73828F", HALO);
  setLabel(style, "place_state", "#97A4AE", HALO);
  setLabel(style, "place_continent", "#8B99A6", HALO);
  setLabel(style, "place_city_r6", "#5F6C79", HALO);
  setLabel(style, "place_city_r5", "#5F6C79", HALO);
  for (const id of [
    "place_city_dot_r7", "place_city_dot_r4", "place_city_dot_r2", "place_city_dot_z7",
    "place_capital_dot_z7",
  ]) {
    setLabel(style, id, "#5F6C79", HALO);
  }
  setLabel(style, "place_town", "#6B7885", HALO);
  setLabel(style, "place_villages", "#8A97A3", HALO);
  setLabel(style, "place_suburbs", "#8A97A3", HALO);
  setLabel(style, "place_hamlet", "#8A97A3", HALO);

  setLabel(style, "roadname_minor", "#8F999E", HALO);
  setLabel(style, "roadname_sec", "#8F999E", HALO);
  setLabel(style, "roadname_pri", "#8F999E", HALO);
  setLabel(style, "roadname_major", "#8F999E", HALO);
  setLabel(style, "poi_stadium", "#8BA08C", HALO);
  setLabel(style, "poi_park", "#8BA08C", HALO);

  hideUntil(style, "place_hamlet", 10);
  hideUntil(style, "place_suburbs", 10);
  hideUntil(style, "place_villages", 10);
  hideUntil(style, "place_town", 8);
  hideUntil(style, "place_state", 6.5);
  hideUntil(style, "place_country_2", 5.5);
  hideUntil(style, "poi_stadium", 13);
  hideUntil(style, "poi_park", 13);
  hideUntil(style, "roadname_minor", 12);
  hideUntil(style, "roadname_sec", 11);
  hideUntil(style, "roadname_pri", 10);
}
