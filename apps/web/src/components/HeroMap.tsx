"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "../lib/api";
import type { Place, Profile, Settings, Visit } from "../lib/types";
import { buildMapMarkers, visitedCountryCodes } from "../lib/map-data";
import type { MapMarker } from "../lib/map-data";
import { loadThemeStyle } from "../lib/map-style";
import { applyTheme, themes } from "../themes";
import type { ThemeId } from "../themes";

const EUROPE_CENTER: [number, number] = [10, 50];
const EUROPE_ZOOM = 4.2;

interface CountryFeature {
  type: "Feature";
  properties: { ISO_A2: string; NAME: string };
  geometry: unknown;
}
interface CountryCollection {
  type: "FeatureCollection";
  features: CountryFeature[];
}

interface PreviewState {
  marker: MapMarker;
  mode: "micro" | "expanded";
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

function visitLabel(visitType: MapMarker["visitType"]): string {
  const labels: Record<string, string> = {
    lived: "Lived",
    trip: "Trip",
    day_trip: "Day trip",
    stopover: "Stopover",
    transit: "Transit",
  };
  return labels[visitType] ?? visitType;
}

export default function HeroMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjsRef = useRef<maplibregl.Marker[]>([]);
  const previewRef = useRef<PreviewState | null>(null);

  const [places, setPlaces] = useState<Place[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [countriesGeo, setCountriesGeo] = useState<CountryCollection | null>(null);
  const [error, setError] = useState("");
  const [themeId, setThemeId] = useState<ThemeId>("light");
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewPixel, setPreviewPixel] = useState<{ x: number; y: number } | null>(null);

  const theme = themes[themeId];
  const markers = useMemo(() => buildMapMarkers(places, visits, profile), [places, visits, profile]);
  const countryCodes = useMemo(() => visitedCountryCodes(places, visits), [places, visits]);

  // Latest values for map callbacks (kept stable across renders).
  const contentRef = useRef({ theme, markers, countryCodes, countriesGeo });
  contentRef.current = { theme, markers, countryCodes, countriesGeo };
  previewRef.current = preview;

  // --- show / hide / focus callbacks (stable) ---
  const projectPreview = useCallback((m: MapMarker) => {
    const map = mapRef.current;
    if (!map) return;
    const p = map.project([m.place.coordinates.lng, m.place.coordinates.lat]);
    setPreviewPixel({ x: p.x, y: p.y });
  }, []);

  const showPreview = useCallback((m: MapMarker, mode: PreviewState["mode"]) => {
    setPreview({ marker: m, mode });
    projectPreview(m);
  }, [projectPreview]);

  const clearMicroPreview = useCallback((m: MapMarker) => {
    setPreview((prev) =>
      prev && prev.mode === "micro" && prev.marker.place.id === m.place.id ? null : prev
    );
  }, []);

  const focusMarker = useCallback((m: MapMarker) => {
    setPreview({ marker: m, mode: "expanded" });
    const map = mapRef.current;
    if (map) {
      map.easeTo({ center: [m.place.coordinates.lng, m.place.coordinates.lat], duration: 350 });
      const p = map.project([m.place.coordinates.lng, m.place.coordinates.lat]);
      setPreviewPixel({ x: p.x, y: p.y });
    }
  }, []);

  // --- (re)build country layers + markers (idempotent) ---
  const renderMapContent = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const { theme, markers, countryCodes, countriesGeo } = contentRef.current;

    const codes = new Set(countryCodes);
    const filtered: CountryCollection = {
      type: "FeatureCollection",
      features: (countriesGeo?.features ?? []).filter((f) => codes.has(f.properties.ISO_A2)),
    };
    if (!map.getSource("countries")) {
      map.addSource("countries", { type: "geojson", data: filtered as never });
    } else {
      (map.getSource("countries") as maplibregl.GeoJSONSource).setData(filtered as never);
    }
    // The visited-country polygons come from Natural Earth 110m, which is far
    // coarser than the basemap's OSM-derived geometry. An outline would visibly
    // misalign with the basemap's country borders/coastlines, so we render only
    // a very subtle fill: coverage stays a secondary contextual layer without
    // drawing attention to the geometry mismatch.
    for (const id of ["countries-fill", "countries-line"]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    map.addLayer({
      id: "countries-fill",
      type: "fill",
      source: "countries",
      paint: { "fill-color": theme.countries.fill },
    });

    markerObjsRef.current.forEach((m) => m.remove());
    markerObjsRef.current = [];
    for (const m of markers) {
      const el = makeMarkerElement(m);
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([m.place.coordinates.lng, m.place.coordinates.lat])
        .addTo(map);
      el.addEventListener("mouseenter", () => showPreview(m, "micro"));
      el.addEventListener("mouseleave", () => clearMicroPreview(m));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        focusMarker(m);
      });
      markerObjsRef.current.push(marker);
    }
  }, [mapReady, showPreview, clearMicroPreview, focusMarker]);

  // --- create (or recreate) the map ---
  const mapGenRef = useRef(0);
  const createMap = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;
    const gen = ++mapGenRef.current;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
    setMapReady(false);
    setMapError("");
    if (!webglAvailable()) {
      setMapError("WebGL is not available in this browser, which the map requires.");
      return;
    }
    // Load the base style once per theme and adapt it toward the theme's
    // atmosphere (lib/map-style.ts). Fall back to the raw style URL if the
    // network fetch fails, so the map still works offline.
    const theme = contentRef.current.theme;
    let style: StyleSpecification | string = theme.map.styleUrl;
    try {
      style = await loadThemeStyle(theme.id, theme.map.styleUrl);
    } catch {
      style = theme.map.styleUrl;
    }
    if (gen !== mapGenRef.current) return; // superseded by a newer createMap
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container,
        style,
        center: EUROPE_CENTER,
        zoom: EUROPE_ZOOM,
        attributionControl: { compact: true },
      });
    } catch (e) {
      setMapError(e instanceof Error ? e.message : String(e));
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    map.on("load", () => setMapReady(true));
    map.on("click", () => setPreview(null));
    map.on("move", () => {
      const prev = previewRef.current;
      if (prev) {
        const p = map.project([prev.marker.place.coordinates.lng, prev.marker.place.coordinates.lat]);
        setPreviewPixel({ x: p.x, y: p.y });
      }
    });
    mapRef.current = map;
  }, []);

  // --- data load ---
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, v, pr, s] = await Promise.all([
          api.getPlaces(),
          api.getVisits(),
          api.getProfile(),
          api.getSettings(),
        ]);
        if (!alive) return;
        setPlaces(p);
        setVisits(v);
        setProfile(pr);
        setSettings(s);
        if (s.theme === "night" || s.theme === "light") setThemeId(s.theme);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      try {
        const res = await fetch("/geodata/countries.geojson");
        const geo = (await res.json()) as CountryCollection;
        if (alive) setCountriesGeo(geo);
      } catch {
        // country polygons are an optional enhancement
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- apply theme tokens ---
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // --- init map (once) ---
  useEffect(() => {
    createMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [createMap]);

  // --- re-render map content when data or readiness changes ---
  useEffect(() => {
    renderMapContent();
  }, [markers, countryCodes, countriesGeo, mapReady, renderMapContent]);

  // --- recreate map on theme change (base style swap) ---
  const skipFirstStyle = useRef(true);
  useEffect(() => {
    if (skipFirstStyle.current) {
      skipFirstStyle.current = false;
      return;
    }
    createMap();
  }, [theme.map.styleUrl, createMap]);

  const toggleTheme = useCallback(() => {
    const next: ThemeId = themeId === "light" ? "night" : "light";
    setThemeId(next);
    const base = settings ?? {};
    api.saveSettings({ ...base, theme: next }).catch(() => {});
  }, [themeId, settings]);

  return (
    <div className="atlas-hero">
      <div ref={containerRef} className="atlas-hero__map" />
      <div className="atlas-hero__tint" aria-hidden="true" />

      {error ? <div className="atlas-error">{error}</div> : null}
      {mapError ? (
        <div className="atlas-map-error">
          <p>Yu&rsquo;s Atlas needs WebGL to render the map.</p>
          <p className="atlas-map-error__detail">{mapError}</p>
        </div>
      ) : null}

      <header className="atlas-wordmark">Yu&rsquo;s Atlas</header>

      <button className="atlas-theme-toggle" onClick={toggleTheme} type="button">
        {themeId === "light" ? "Night" : "Light"}
      </button>

      {preview && previewPixel ? (
        <div
          className={"atlas-preview atlas-preview--" + preview.mode}
          style={{ left: previewPixel.x, top: previewPixel.y }}
          role="tooltip"
        >
          <div className="atlas-preview__name">{preview.marker.place.name}</div>
          <div className="atlas-preview__meta">
            {preview.marker.place.country}
            {preview.marker.dateLabel ? " · " + preview.marker.dateLabel : ""}
            {" · " + visitLabel(preview.marker.visitType)}
          </div>
          {preview.mode === "expanded" && preview.marker.withFriends ? (
            <div className="atlas-preview__friends">With friends</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function makeMarkerElement(m: MapMarker): HTMLDivElement {
  const el = document.createElement("div");
  el.className =
    "atlas-marker atlas-marker--" + m.visitType + (m.isCurrent ? " atlas-marker--current" : "");
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", m.place.name + ", " + m.place.country);
  if (m.isCurrent) {
    const ring = document.createElement("span");
    ring.className = "atlas-marker__ring";
    el.appendChild(ring);
  }
  const dot = document.createElement("span");
  dot.className = "atlas-marker__dot";
  el.appendChild(dot);
  return el;
}
