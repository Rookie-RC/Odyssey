import { describe, expect, test } from "vitest";
import type { StyleSpecification } from "maplibre-gl";
import {
  buildMapMarkers,
  buildWishMarkers,
  markerRadius,
  placesBounds,
  visitedCountryCodes,
  wishlistCountryCodes,
} from "./map-data";
import { ACTIVITIES, ACTIVITY_GLYPH, activitiesOf, primaryActivity } from "./activity";
import type { Visit } from "./types";
import { getRouteTrajectory, mercatorBearing } from "./routes";
import { LAYER_BEFORE, adaptBaseStyle } from "./map-style";
import { themes } from "../themes";
import { places, profile, visits, wishlist } from "./fixtures.test-helpers";

describe("map data", () => {
  test("one marker per visited place, strongest visit wins, current base flagged", () => {
    const markers = buildMapMarkers(places, visits, profile);
    const ids = markers.map((m) => m.place.id);
    expect(ids).not.toContain("lofoten"); // wishlist-only
    expect(markers.find((m) => m.place.id === "paris")!.visitType).toBe("trip");
    expect(markers[0].isCurrent).toBe(true); // sorted by rank, current first
  });

  test("visited country codes are distinct and sorted", () => {
    expect(visitedCountryCodes(places, visits)).toEqual(["CN", "DE", "FR", "IT", "JP"]);
  });

  test("wishlist countries are the ones not visited yet", () => {
    expect(wishlistCountryCodes(places, visits, wishlist)).toEqual(["NO", "PT"]); // Kyoto's JP is visited
  });

  test("wishlist pins exclude places already visited", () => {
    const pins = buildWishMarkers(places, visits, wishlist).map((w) => w.place.id);
    expect(pins).toEqual(["lofoten", "lisbon"]);
  });

  test("placesBounds", () => {
    expect(placesBounds([])).toBeNull();
    expect(placesBounds(places)).toEqual([[-9.1, 30.3], [135.8, 68.2]]);
  });
});

describe("activities", () => {
  const markerFor = (vs: Visit[], id: string) => buildMapMarkers(places, vs, profile).find((m) => m.place.id === id)!;
  const withActivities = (id: string, activities: string[]) =>
    visits.map((v) => (v.id === id ? { ...v, activities } : v));

  test("every activity has a glyph", () => {
    for (const a of ACTIVITIES) expect(ACTIVITY_GLYPH[a]).toMatch(/^<(path|circle|rect)/);
  });

  test("unknown ids are skipped, duplicates collapse, order is kept", () => {
    const v = { activities: ["wine_tasting", "ski", "food", "ski"] };
    expect(activitiesOf(v)).toEqual(["ski", "food"]);
    expect(primaryActivity(v)).toBe("ski");
    expect(primaryActivity({})).toBeNull();
  });

  test("a pin shows the primary activity of the place's strongest visit", () => {
    const m = markerFor(withActivities("v-paris", ["citywalk", "museum"]), "paris");
    expect(m.activity).toBe("citywalk");
    expect(markerRadius(m)).toBe(11);
  });

  test("else the most recent visit that names one", () => {
    // Paris: the trip (strongest) has none, the later stopover has one.
    expect(markerFor(withActivities("v-paris2", ["food"]), "paris").activity).toBe("food");
  });

  test("a bare stopover is a night in passing; homes and plain trips keep dots", () => {
    const vs: Visit[] = [...visits, { id: "v-lis", placeId: "lisbon", visitType: "stopover" }];
    expect(markerFor(vs, "lisbon").activity).toBe("overnight");
    expect(markerFor(visits, "kyoto").activity).toBeNull();
    expect(markerRadius(markerFor(visits, "kyoto"))).toBe(5);
    // The current base never carries an activity badge, even when tagged.
    expect(markerFor(withActivities("v-home", ["study"]), "home").activity).toBeNull();
  });
});

describe("residence-based routes", () => {
  const t = getRouteTrajectory(places, visits);
  const pairs = t.segments.map((s) => s.from.id + "→" + s.to.id);

  test("each trip radiates from the residence active at the time", () => {
    expect(pairs).toContain("old-home→kyoto"); // 2018, while living in Hangzhou
    expect(pairs).toContain("home→paris"); // 2023, while living in Jülich
  });

  test("each route carries its trip's transport, plane by default, with a badge at its midpoint", () => {
    expect(t.segments.every((s) => s.mode === "plane")).toBe(true);
    const byTrain = getRouteTrajectory(
      places,
      visits.map((v) => (v.id === "v-paris" ? { ...v, transport: "train" as const } : v))
    );
    const paris = byTrain.segments.find((s) => s.to.id === "paris" && s.id.endsWith("#v-paris"))!;
    expect(paris.mode).toBe("train");
    expect(byTrain.geojson.features.find((f) => f.properties.segment === paris.id)!.properties.mode).toBe("train");
    expect(byTrain.icons.features).toHaveLength(byTrain.segments.length);
  });

  test("flight arcs lift further from the straight line than ground routes", () => {
    const lift = (mode: "plane" | "train") => {
      const tr = getRouteTrajectory(
        places,
        visits.map((v) => (v.id === "v-paris" ? { ...v, transport: mode } : v))
      );
      const f = tr.geojson.features.find((x) => x.properties.segment.endsWith("#v-paris"))!;
      const c = f.geometry.coordinates;
      const mid = c[Math.floor(c.length / 2)];
      const chord: [number, number] = [(c[0][0] + c.at(-1)![0]) / 2, (c[0][1] + c.at(-1)![1]) / 2];
      return Math.hypot(mid[0] - chord[0], mid[1] - chord[1]);
    };
    expect(lift("plane")).toBeGreaterThan(lift("train") * 2);
  });

  test("mercator bearing: north 0°, east 90°, south 180°, west 270°", () => {
    expect(mercatorBearing([0, 0], [0, 1])).toBe(0);
    expect(mercatorBearing([0, 0], [1, 0])).toBe(90);
    expect(mercatorBearing([0, 1], [0, 0])).toBe(180);
    expect(mercatorBearing([1, 0], [0, 0])).toBe(270);
  });

  test("no residence→residence, no undated visits, no chains", () => {
    expect(pairs.some((p) => p.endsWith("→home") || p.endsWith("→old-home"))).toBe(false);
    expect(pairs.some((p) => p.includes("rome"))).toBe(false);
    expect(t.geojson.features).toHaveLength(t.segments.length);
  });
});

describe("theme map adaptation", () => {
  const base = {
    version: 8,
    sources: { carto: { type: "vector", url: "x" } },
    layers: [
      { id: "background", type: "background", paint: {} },
      { id: "landcover", type: "fill", source: "carto", "source-layer": "landcover", paint: {} },
      { id: "waterway", type: "line", source: "carto", "source-layer": "waterway", paint: {} },
      { id: "water", type: "fill", source: "carto", "source-layer": "water", paint: {} },
      { id: "boundary_country_inner", type: "line", source: "carto", "source-layer": "boundary", paint: {} },
      { id: "watername_ocean", type: "symbol", source: "carto", "source-layer": "water_name", layout: {}, paint: {} },
      { id: "watername_sea", type: "symbol", source: "carto", "source-layer": "water_name", layout: {}, paint: {}, minzoom: 5 },
      { id: "place_country_1", type: "symbol", source: "carto", "source-layer": "place", layout: {}, paint: {} },
    ],
  } as unknown as StyleSpecification;

  const ids = (s: StyleSpecification) => s.layers.map((l) => l.id);
  const layer = (s: StyleSpecification, id: string) => s.layers.find((l) => l.id === id) as {
    paint?: Record<string, unknown>;
    layout?: Record<string, unknown>;
    minzoom?: number;
  };

  test("palette is applied and the input style is not mutated", () => {
    const night = adaptBaseStyle(base, themes.night);
    expect(layer(night, "water").paint?.["fill-color"]).toBe(themes.night.map.palette.water);
    expect(layer(base, "water").paint?.["fill-color"]).toBeUndefined();
  });

  test("relief sits beneath the water; city lights only where the theme asks", () => {
    const night = adaptBaseStyle(base, themes.night);
    const order = ids(night);
    expect(order.indexOf("atlas-relief")).toBeLessThan(order.indexOf("waterway"));
    expect(order).toContain("atlas-city-glow");
    expect(order.indexOf("atlas-city-glow")).toBeLessThan(order.indexOf(LAYER_BEFORE.routes));
    expect(ids(adaptBaseStyle(base, themes.light))).not.toContain("atlas-city-glow");
    expect(ids(adaptBaseStyle(base, themes.minimal))).not.toContain("atlas-relief");
  });

  test("the Chinese interface names places from name:zh", () => {
    const zh = adaptBaseStyle(base, themes.light, "zh");
    expect(JSON.stringify(layer(zh, "watername_sea").layout?.["text-field"])).toContain("name:zh");
    expect(JSON.stringify(layer(adaptBaseStyle(base, themes.light), "watername_sea").layout?.["text-field"])).not.toContain(
      "name:zh"
    );
  });

  test("seas are named at hero zoom; Minimal hides country names", () => {
    expect(layer(adaptBaseStyle(base, themes.light), "watername_sea").minzoom).toBeLessThan(5);
    expect(layer(adaptBaseStyle(base, themes.minimal), "place_country_1").layout?.visibility).toBe("none");
    expect(ids(adaptBaseStyle(base, themes.light))).toContain("boundary_country_disputed");
  });
});
