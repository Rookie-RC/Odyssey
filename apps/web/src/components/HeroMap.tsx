"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Media, Place, Profile, Visit } from "../lib/types";
import { buildMapMarkers, visitedCountryCodes } from "../lib/map-data";
import type { MapMarker } from "../lib/map-data";
import { visitTypeLabel } from "../lib/timeline";
import { getPrimaryMediaForPlace } from "../lib/domain";
import { loadThemeStyle } from "../lib/map-style";
import type { AtlasTheme } from "../themes";

const EUROPE_CENTER: [number, number] = [10, 50];
const EUROPE_ZOOM = 4.2;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export interface CountryFeature {
  type: "Feature";
  properties: { ISO_A2: string; NAME: string };
  geometry: unknown;
}
export interface CountryCollection {
  type: "FeatureCollection";
  features: CountryFeature[];
}

interface PreviewState {
  marker: MapMarker;
  mode: "micro" | "expanded";
}

interface HeroMapProps {
  places: Place[];
  visits: Visit[];
  profile: Profile | null;
  countriesGeo: CountryCollection | null;
  theme: AtlasTheme;
  media: Media[];
  /** True while an overlay (place detail / profile) is open or closing. */
  overlayOpen: boolean;
  onOpenPlace?: (placeId: string) => void;
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function HeroMap({
  places,
  visits,
  profile,
  countriesGeo,
  theme,
  media,
  overlayOpen,
  onOpenPlace,
}: HeroMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjsRef = useRef<maplibregl.Marker[]>([]);
  const previewRef = useRef<PreviewState | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewPixel, setPreviewPixel] = useState<{ x: number; y: number } | null>(null);

  const markers = useMemo(() => buildMapMarkers(places, visits, profile), [places, visits, profile]);
  const countryCodes = useMemo(() => visitedCountryCodes(places, visits), [places, visits]);

  // Latest values for map callbacks (kept stable across renders).
  const contentRef = useRef({ theme, markers, countryCodes, countriesGeo });
  contentRef.current = { theme, markers, countryCodes, countriesGeo };
  previewRef.current = preview;

  // A Place Detail / Profile overlay supersedes the map preview.
  useEffect(() => {
    if (overlayOpen) setPreview(null);
  }, [overlayOpen]);

  const openDetail = useCallback(
    (m: MapMarker) => {
      setPreview(null);
      onOpenPlace?.(m.place.id);
    },
    [onOpenPlace]
  );

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
        // Wheel input over the hero map must scroll the page (it drives the
        // collapse/expand transition), so MapLibre's built-in scroll zoom is
        // disabled. Zoom is reserved for explicit intent: Ctrl+wheel (scoped
        // handler below) or the +/- controls.
        scrollZoom: false,
        // The Atlas is a flat 2D map: rotation and pitch/tilt are disabled at
        // the gesture level (right-drag rotate, Ctrl+drag rotate, drag-to-pitch,
        // touch rotate/pitch) and clamped so the camera can never leave 2D.
        dragRotate: false,
        pitchWithRotate: false,
        touchZoomRotate: false,
        touchPitch: false,
        keyboard: false,
        maxPitch: 0,
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

  // --- scoped Ctrl+wheel zoom ---
  // MapLibre's built-in scrollZoom is disabled so a normal wheel scrolls the
  // page (driving the hero collapse/expand). Zoom becomes an explicit gesture:
  // Ctrl+wheel over the map container. preventDefault() also stops the
  // browser's own Ctrl+wheel page zoom. Without Ctrl we touch nothing, so
  // normal page scrolling is never interfered with.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain wheel → page scroll (no interference)
      const map = mapRef.current;
      if (!map) return;
      e.preventDefault(); // suppress browser page zoom + page scroll
      let value = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 40 : e.deltaY;
      if (value === 0) return;
      // Scale like MapLibre's own scroll zoom (sigmoid), tuned so a wheel
      // notch and small trackpad deltas both feel deliberate. Wheel up
      // (deltaY < 0) zooms in, wheel down zooms out.
      const rate = 1 / 200;
      let scale = 2 / (1 + Math.exp(-Math.abs(value * rate)));
      if (value > 0) scale = 1 / scale;
      const zoom = clamp(map.getZoom() * scale, map.getMinZoom(), map.getMaxZoom());
      // Keep the point under the cursor stationary while zooming.
      const rect = map.getCanvasContainer().getBoundingClientRect();
      const around = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      map.easeTo({ zoom, duration: 0, around });
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

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

  return (
    <div className="atlas-hero">
      <div ref={containerRef} className="atlas-hero__map" />
      <div className="atlas-hero__tint" aria-hidden="true" />

      {mapError ? (
        <div className="atlas-map-error">
          <p>Yu&rsquo;s Atlas needs WebGL to render the map.</p>
          <p className="atlas-map-error__detail">{mapError}</p>
        </div>
      ) : null}

      {preview && previewPixel ? (
        <div
          className={"atlas-preview atlas-preview--" + preview.mode}
          style={{ left: previewPixel.x, top: previewPixel.y }}
        >
          {preview.mode === "expanded" ? (
            <ExpandedPreview
              marker={preview.marker}
              visits={visits}
              media={media}
              onOpenDetail={() => openDetail(preview.marker)}
            />
          ) : (
            <>
              <div className="atlas-preview__name">{preview.marker.place.name}</div>
              <div className="atlas-preview__meta">
                {preview.marker.place.country}
                {preview.marker.dateLabel ? " · " + preview.marker.dateLabel : ""}
                {" · " + visitTypeLabel(preview.marker.visitType)}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ExpandedPreview({
  marker,
  visits,
  media,
  onOpenDetail,
}: {
  marker: MapMarker;
  visits: Visit[];
  media: Media[];
  onOpenDetail: () => void;
}) {
  const photo = getPrimaryMediaForPlace(marker.place.id, visits, [], media);
  return (
    <>
      {photo ? (
        <img
          className="atlas-preview__img"
          src={photo.path}
          alt={photo.caption ?? marker.place.name}
          draggable={false}
        />
      ) : null}
      <div className="atlas-preview__body">
        <div className="atlas-preview__name">{marker.place.name}</div>
        <div className="atlas-preview__meta">
          {marker.place.country}
          {marker.dateLabel ? " · " + marker.dateLabel : ""}
          {" · " + visitTypeLabel(marker.visitType)}
        </div>
        {marker.withFriends ? <div className="atlas-preview__friends">With friends</div> : null}
        <button type="button" className="atlas-preview__action" onClick={onOpenDetail}>
          View memory
          <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
            <path
              d="M2 8h11M9 3.5 13.5 8 9 12.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </>
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
