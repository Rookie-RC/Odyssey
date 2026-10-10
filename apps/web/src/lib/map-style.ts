// Loads a CARTO base style and adapts it to the active theme's map palette
// (themes/*.ts → theme.map). Positron (light) and Dark Matter (dark) share the
// same layer ids, so a single palette-driven adapter serves every theme. The
// base tiles (sources, glyphs, sprites) are untouched; only paint/layout of
// known layers is overridden, so the adaptation stays resilient to CARTO
// style-sheet updates (missing layers are skipped).
//
// On top of the base style the adapter adds, per theme:
//   - shaded relief (AWS Terrain Tiles, terrarium encoding) beneath the water,
//     so mountains give the hero map its cartographic texture while the sea
//     stays calm;
//   - "city lights" (Night): a soft glow on populated places taken from the
//     base tiles' own place layer — no extra data;
//   - sea/ocean names at the Europe-wide hero zoom (italic, quiet), the way an
//     atlas page names its waters.
import type { StyleSpecification } from "maplibre-gl";
import type { AtlasTheme, MapPalette } from "../themes";
import { getLocale, type Locale } from "./i18n";

const BASE_STYLE_URL: Record<AtlasTheme["map"]["base"], string> = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
};

const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Layer ids our own content is inserted before (see HeroMap):
 *  - country fill sits under the basemap water, so the coarse Natural Earth
 *    polygons are trimmed by the precise OSM coastline;
 *  - routes sit above roads/borders but below every label. */
export const LAYER_BEFORE = {
  countries: "waterway",
  routes: "watername_ocean",
};

type LayerLike = {
  id: string;
  type: string;
  source?: string;
  "source-layer"?: string;
  filter?: unknown;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  minzoom?: number;
  maxzoom?: number;
};

type StyleLike = {
  sources?: Record<string, unknown>;
  layers?: LayerLike[];
};

const cache = new Map<string, Promise<StyleSpecification>>();
const baseCache = new Map<string, Promise<StyleSpecification>>();

function fetchBase(url: string): Promise<StyleSpecification> {
  let p = baseCache.get(url);
  if (!p) {
    p = fetch(url).then((res) => {
      if (!res.ok) throw new Error("failed to load map style: " + res.status);
      return res.json() as Promise<StyleSpecification>;
    });
    baseCache.set(url, p);
    p.catch(() => baseCache.delete(url));
  }
  return p;
}

export function baseStyleUrl(theme: AtlasTheme): string {
  return BASE_STYLE_URL[theme.map.base];
}

export function loadThemeStyle(theme: AtlasTheme, locale: Locale = getLocale()): Promise<StyleSpecification> {
  const key = theme.id + "|" + locale;
  let p = cache.get(key);
  if (!p) {
    p = fetchBase(baseStyleUrl(theme)).then((style) => adaptBaseStyle(style, theme, locale));
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

// --- small mutation helpers ---

function find(style: StyleLike, id: string): LayerLike | undefined {
  return style.layers?.find((l) => l.id === id);
}

function paint(style: StyleLike, id: string, key: string, value: unknown): void {
  const layer = find(style, id);
  if (!layer) return;
  layer.paint = layer.paint ?? {};
  layer.paint[key] = value;
}

function layout(style: StyleLike, id: string, key: string, value: unknown): void {
  const layer = find(style, id);
  if (!layer) return;
  layer.layout = layer.layout ?? {};
  layer.layout[key] = value;
}

// hideUntil defers a label/feature layer to a higher zoom so the hero view
// stays quiet and editorial while zooming in still reveals detail.
function hideUntil(style: StyleLike, id: string, minzoom: number): void {
  const layer = find(style, id);
  if (layer) layer.minzoom = minzoom;
}

function setLabel(style: StyleLike, id: string, color: string, halo: string, haloWidth = 1.1): void {
  paint(style, id, "text-color", color);
  paint(style, id, "text-halo-color", halo);
  paint(style, id, "text-halo-width", haloWidth);
  paint(style, id, "text-halo-blur", 0.4);
}

function setRoadFamily(style: StyleLike, prefix: string, fill: string, caseColor: string): void {
  for (const l of style.layers ?? []) {
    if (!l.id.startsWith(prefix) || l.type !== "line") continue;
    if (l.id.includes("fill")) paint(style, l.id, "line-color", fill);
    else if (l.id.includes("case")) paint(style, l.id, "line-color", caseColor);
  }
}

function insertBefore(style: StyleLike, beforeId: string, layer: LayerLike): void {
  const layers = style.layers ?? [];
  const idx = layers.findIndex((l) => l.id === beforeId);
  if (idx >= 0) layers.splice(idx, 0, layer);
  else layers.push(layer);
  style.layers = layers;
}

// --- shared boundary treatment ---
// International borders: a continuous solid line (the CARTO style dashes them
// from zoom 7, which reads as missing segments); disputed borders: a subtle
// dashed overlay drawn from the same source using its `disputed` property.
function styleCountryBoundaries(style: StyleLike, color: string, width: number): void {
  const inner = find(style, "boundary_country_inner");
  paint(style, "boundary_country_outline", "line-color", "transparent");
  if (!inner) return;
  paint(style, "boundary_country_inner", "line-color", color);
  paint(style, "boundary_country_inner", "line-dasharray", [1]);
  paint(style, "boundary_country_inner", "line-width", [
    "interpolate", ["linear"], ["zoom"], 3, width, 6, width * 1.4, 10, width * 2,
  ]);
  inner.filter = ["all", ["==", "admin_level", 2], ["==", "maritime", 0], ["!=", "disputed", 1]];
  const idx = style.layers?.findIndex((l) => l.id === inner.id) ?? -1;
  if (idx >= 0) {
    style.layers?.splice(idx + 1, 0, {
      id: "boundary_country_disputed",
      type: "line",
      source: inner.source,
      "source-layer": inner["source-layer"],
      filter: ["all", ["==", "admin_level", 2], ["==", "maritime", 0], ["==", "disputed", 1]],
      paint: { "line-color": color, "line-width": width, "line-dasharray": [2, 2] },
    });
  }
}

// --- theme adaptation ---

export function adaptBaseStyle(
  style: StyleSpecification,
  theme: AtlasTheme,
  locale: Locale = "en"
): StyleSpecification {
  const s = JSON.parse(JSON.stringify(style)) as StyleSpecification & StyleLike;
  applyPalette(s, theme.map.palette);
  if (locale === "zh") useChineseNames(s);
  addRelief(s, theme);
  addCityLights(s, theme);
  return s;
}

// The CARTO tiles carry OSM's `name:zh`; in the Chinese interface, countries,
// seas and cities are named in Chinese where a name exists (falling back to the
// English, then the local name). MapLibre draws CJK ideographs with local
// system fonts (localIdeographFontFamily), so no extra glyphs are downloaded.
function useChineseNames(style: StyleLike): void {
  // Prefer the Simplified-Chinese name: OSM's plain name:zh sometimes holds
  // both scripts ("亞得里亞海 / 亚得里亚海").
  const field = ["coalesce", ["get", "name:zh-Hans"], ["get", "name:zh"], ["get", "name_en"], ["get", "name"]];
  for (const l of style.layers ?? []) {
    if (l.type !== "symbol") continue;
    if (!/^(place_|watername_|waterway_label)/.test(l.id)) continue;
    layout(style, l.id, "text-field", field);
  }
}

function applyPalette(style: StyleLike, p: MapPalette): void {
  paint(style, "background", "background-color", p.background);
  paint(style, "landcover", "fill-color", p.land);
  paint(style, "landcover", "fill-opacity", 1);
  for (const id of ["park_national_park", "park_nature_reserve"]) {
    paint(style, id, "fill-color", p.park);
  }
  paint(style, "landuse", "fill-color", p.park);
  paint(style, "landuse_residential", "fill-color", p.residential);
  paint(style, "water", "fill-color", p.water);
  paint(style, "water_shadow", "fill-color", p.water);
  paint(style, "water_shadow", "fill-opacity", 0);
  paint(style, "waterway", "line-color", p.waterway);
  paint(style, "building", "fill-color", p.building);
  paint(style, "building-top", "fill-color", p.building);
  paint(style, "aeroway-runway", "line-color", p.roadCase);
  paint(style, "aeroway-taxiway", "line-color", p.roadCase);

  styleCountryBoundaries(style, p.border, p.borderWidth);
  paint(style, "boundary_state", "line-color", p.borderState);
  paint(style, "boundary_county", "line-color", p.borderCounty);

  for (const prefix of ["road", "bridge", "tunnel"]) setRoadFamily(style, prefix, p.road, p.roadCase);
  paint(style, "rail", "line-color", p.roadCase);
  paint(style, "rail_dash", "line-color", p.road);
  paint(style, "tunnel_rail", "line-color", p.roadCase);
  paint(style, "tunnel_rail_dash", "line-color", p.road);

  // Waters: an atlas names its seas. CARTO only shows sea names from zoom 5,
  // above the Europe-wide hero framing, so they are brought forward and set
  // in a spaced italic.
  for (const id of ["waterway_label", "watername_ocean", "watername_sea", "watername_lake", "watername_lake_line"]) {
    setLabel(style, id, p.labelWater, p.labelHalo, 0.8);
  }
  hideUntil(style, "watername_sea", 3.4);
  const ocean = find(style, "watername_ocean");
  if (ocean) ocean.maxzoom = 6;
  for (const id of ["watername_ocean", "watername_sea"]) {
    // OSM sea names concatenate every language ("North Sea / Nordsee / …");
    // the English name keeps the atlas page readable.
    layout(style, id, "text-field", ["coalesce", ["get", "name_en"], ["get", "name:latin"], ["get", "name"]]);
    layout(style, id, "text-max-width", 8);
    layout(style, id, "text-letter-spacing", 0.12);
    layout(style, id, "text-size", ["interpolate", ["linear"], ["zoom"], 3, 11, 6, 13]);
  }

  setLabel(style, "place_country_2", p.labelCountry, p.labelHalo);
  setLabel(style, "place_country_1", p.labelCountry, p.labelHalo);
  setLabel(style, "place_continent", p.labelCountry, p.labelHalo);
  setLabel(style, "place_state", p.labelMinor, p.labelHalo);
  setLabel(style, "place_city_r6", p.labelCity, p.labelHalo);
  setLabel(style, "place_city_r5", p.labelCity, p.labelHalo);
  for (const id of [
    "place_city_dot_r7", "place_city_dot_r4", "place_city_dot_r2", "place_city_dot_z7",
    "place_capital_dot_z7",
  ]) {
    setLabel(style, id, p.labelCity, p.labelHalo);
  }
  setLabel(style, "place_town", p.labelTown, p.labelHalo);
  for (const id of ["place_villages", "place_suburbs", "place_hamlet"]) {
    setLabel(style, id, p.labelMinor, p.labelHalo);
  }
  for (const id of ["roadname_minor", "roadname_sec", "roadname_pri", "roadname_major", "housenumber"]) {
    setLabel(style, id, p.labelRoad, p.labelHalo);
  }
  setLabel(style, "poi_stadium", p.labelMinor, p.labelHalo);
  setLabel(style, "poi_park", p.labelMinor, p.labelHalo);

  // Country names are uppercase and widely spaced, like an atlas plate.
  for (const id of ["place_country_1", "place_country_2"]) {
    layout(style, id, "text-letter-spacing", 0.18);
    layout(style, id, "text-transform", "uppercase");
  }

  // Density: keep minor settlements, POIs, secondary states and small-country
  // labels out of the hero viewport; they appear only once the user zooms in
  // (VISUAL_SPEC §3/§4: "avoid dense European text clutter"). Our own place
  // markers carry the places the user actually cares about at that zoom.
  hideUntil(style, "place_hamlet", 10);
  hideUntil(style, "place_suburbs", 10);
  hideUntil(style, "place_villages", 10);
  hideUntil(style, "place_town", 8);
  hideUntil(style, "place_state", 6.5);
  hideUntil(style, "place_country_2", 5.5);
  hideUntil(style, "place_country_1", 5.5);
  hideUntil(style, "place_city_dot_r2", 6.5);
  hideUntil(style, "place_city_dot_r4", 6.5);
  hideUntil(style, "poi_stadium", 13);
  hideUntil(style, "poi_park", 13);
  hideUntil(style, "roadname_minor", 12);
  hideUntil(style, "roadname_sec", 11);
  hideUntil(style, "roadname_pri", 10);
}

// Shaded relief from open elevation tiles (Mapzen/AWS Terrain Tiles, no key).
// Inserted beneath the waterways/water so only land carries relief.
function addRelief(style: StyleLike, theme: AtlasTheme): void {
  const h = theme.map.hillshade;
  if (!h) return;
  style.sources = style.sources ?? {};
  style.sources.terrain = {
    type: "raster-dem",
    tiles: [TERRAIN_TILES],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 11,
    attribution: "Terrain: Mapzen, AWS Terrain Tiles",
  };
  insertBefore(style, "waterway", {
    id: "atlas-relief",
    type: "hillshade",
    source: "terrain",
    paint: {
      "hillshade-shadow-color": h.shadow,
      "hillshade-highlight-color": h.highlight,
      "hillshade-accent-color": h.accent,
      "hillshade-exaggeration": h.exaggeration,
      "hillshade-illumination-direction": 315,
    },
  });
}

// Night "city lights": two circle layers (soft glow + tiny core) on the base
// tiles' populated places, sized by importance and growing gently with zoom.
function addCityLights(style: StyleLike, theme: AtlasTheme): void {
  const cl = theme.map.cityLights;
  if (!cl) return;
  const source = "carto";
  const filter = ["in", ["get", "class"], ["literal", ["city", "town", "village"]]];
  // Lower rank = more important. Missing rank reads as a small place.
  const weight = [
    "interpolate", ["linear"], ["coalesce", ["get", "rank"], 12],
    1, 1, 6, 0.65, 12, 0.35,
  ];
  insertBefore(style, LAYER_BEFORE.routes, {
    id: "atlas-city-glow",
    type: "circle",
    source,
    "source-layer": "place",
    filter,
    paint: {
      "circle-color": cl.color,
      "circle-radius": [
        "interpolate", ["linear"], ["zoom"],
        3, ["*", 7, weight], 6, ["*", 13, weight], 10, ["*", 20, weight],
      ],
      "circle-blur": 1,
      "circle-opacity": ["*", cl.opacity * 0.8, weight],
    },
  });
  insertBefore(style, LAYER_BEFORE.routes, {
    id: "atlas-city-core",
    type: "circle",
    source,
    "source-layer": "place",
    filter,
    paint: {
      "circle-color": cl.core,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, ["*", 1.2, weight], 8, ["*", 2.2, weight]],
      "circle-blur": 0.4,
      "circle-opacity": ["*", cl.opacity, weight],
    },
  });
}
