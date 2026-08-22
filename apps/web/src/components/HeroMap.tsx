"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Media, Place, Profile, Visit } from "../lib/types";
import { buildMapMarkers, visitedCountryCodes } from "../lib/map-data";
import type { MapMarker } from "../lib/map-data";
import { getRouteTrajectory } from "../lib/routes";
import { visitTypeLabel } from "../lib/timeline";
import { getPrimaryMediaForPlace } from "../lib/domain";
import { loadThemeStyle } from "../lib/map-style";
import type { SyncFocus } from "../lib/sync";
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
  /** Chronological route layer visibility (v1.2). */
  routesOn: boolean;
  onToggleRoutes: () => void;
  /** Shared Map ↔ Timeline focus (v1.3). The map responds when the Timeline
   * initiated (`source === "timeline"`): the marker is emphasized and the
   * camera is gently adjusted only when needed. Map-initiated focus is
   * already where the user clicked. */
  focus?: SyncFocus | null;
  /** Emitted when a marker is clicked/selected (Map → Timeline sync). */
  onFocusPlace?: (placeId: string) => void;
  /** Emitted when the map background is clicked (selection cleared). */
  onClearFocus?: () => void;
  onOpenPlace?: (placeId: string) => void;
  /** Optional default map position from Settings (PRODUCT_SPEC §34). */
  initialCenter?: [number, number] | null;
  initialZoom?: number | null;
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
  routesOn,
  onToggleRoutes,
  focus = null,
  onFocusPlace,
  onClearFocus,
  onOpenPlace,
  initialCenter,
  initialZoom,
}: HeroMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjsRef = useRef<maplibregl.Marker[]>([]);
  // placeId -> marker DOM element, used to apply the shared focus emphasis.
  const markerElsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const previewRef = useRef<PreviewState | null>(null);

  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewPixel, setPreviewPixel] = useState<{ x: number; y: number } | null>(null);

  const markers = useMemo(() => buildMapMarkers(places, visits, profile), [places, visits, profile]);
  const countryCodes = useMemo(() => visitedCountryCodes(places, visits), [places, visits]);
  // Residence-based route trajectory, derived in the domain layer (lib/routes)
  // and memoized: it only changes when Places/Visits change, never on map
  // moves or the hero collapse scroll.
  const trajectory = useMemo(() => getRouteTrajectory(places, visits), [places, visits]);

  // Latest values for map callbacks (kept stable across renders).
  const contentRef = useRef({ theme, markers, countryCodes, countriesGeo, routesOn, trajectory });
  contentRef.current = { theme, markers, countryCodes, countriesGeo, routesOn, trajectory };
  previewRef.current = preview;

  // A Place Detail / Profile overlay supersedes the map preview.
  useEffect(() => {
    if (overlayOpen) setPreview(null);
  }, [overlayOpen]);

  // The page scroll drives the hero collapse (PRODUCT_SPEC §18): once the map
  // shrinks to the strip, a marker's projected pixel position is meaningless
  // (or sits above content that has scrolled underneath), so a lingering
  // preview would float detached over Journey/Where Next. Close it as soon as
  // scrolling starts, mirroring the Timeline preview's own scroll dismissal.
  useEffect(() => {
    if (!preview) return;
    const onScroll = () => setPreview(null);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [preview]);

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
    const { theme, markers, countryCodes, countriesGeo, routesOn, trajectory } = contentRef.current;

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

    // Chronological route layer (v1.2): a thin GeoJSON line layer between the
    // country fill and the (DOM) markers, which therefore always stay on top.
    // The layer is only present while routesOn; geometry updates only when the
    // memoized trajectory changes.
    if (routesOn) {
      if (!map.getSource("routes")) {
        map.addSource("routes", { type: "geojson", data: trajectory.geojson as never });
      } else {
        (map.getSource("routes") as maplibregl.GeoJSONSource).setData(trajectory.geojson as never);
      }
      if (!map.getLayer("routes-line")) {
        map.addLayer({
          id: "routes-line",
          type: "line",
          source: "routes",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": theme.routes.line,
            // Thin and restrained; width grows very slightly as the user zooms
            // in, but never enough to dominate markers. The focused segment
            // (feature-state "emphasized", driven by Map ↔ Timeline sync) is
            // subtly stronger — slightly wider and more opaque — while every
            // other segment stays visible but weaker. ("zoom" must sit at the
            // top level of the expression, so the emphasis case is inside the
            // interpolate outputs.)
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              3,
              ["case", ["boolean", ["feature-state", "emphasized"], false], 2.6, 1.2],
              7,
              ["case", ["boolean", ["feature-state", "emphasized"], false], 3.1, 1.7],
              11,
              ["case", ["boolean", ["feature-state", "emphasized"], false], 3.8, 2.4],
            ],
            "line-opacity": [
              "case",
              ["boolean", ["feature-state", "emphasized"], false],
              0.95,
              0.55,
            ],
          },
        });
      }
    } else if (map.getLayer("routes-line")) {
      map.removeLayer("routes-line");
      map.removeSource("routes");
    }

    markerObjsRef.current.forEach((m) => m.remove());
    markerObjsRef.current = [];
    markerElsRef.current.clear();
    for (const m of markers) {
      const el = makeMarkerElement(m);
      markerElsRef.current.set(m.place.id, el);
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([m.place.coordinates.lng, m.place.coordinates.lat])
        .addTo(map);
      // MapLibre stamps its own generic aria-label ("Map marker") and no
      // tabindex onto the element during addTo(), so both are (re)applied
      // afterwards: every marker announces its own place, and the
      // role="button" it already carries becomes a promise keyboard users can
      // actually act on (PRODUCT_SPEC §38).
      el.setAttribute("aria-label", m.place.name + ", " + m.place.country);
      el.tabIndex = 0;
      el.addEventListener("mouseenter", () => showPreview(m, "micro"));
      el.addEventListener("mouseleave", () => clearMicroPreview(m));
      el.addEventListener("focus", () => showPreview(m, "micro"));
      el.addEventListener("blur", () => clearMicroPreview(m));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        focusMarker(m);
        // Map → Timeline synchronization (v1.3): selecting a marker focuses
        // the matching Timeline item in the shared focus state.
        onFocusPlace?.(m.place.id);
      });
      el.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault(); // Space would otherwise scroll the page
        ev.stopPropagation();
        focusMarker(m);
      });
      markerObjsRef.current.push(marker);
    }
  }, [mapReady, showPreview, clearMicroPreview, focusMarker, onFocusPlace]);

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
    map.on("click", () => {
      setPreview(null);
      // Map background click clears the shared selection (v1.3).
      onClearFocus?.();
    });
    map.on("move", () => {
      const prev = previewRef.current;
      if (prev) {
        const p = map.project([prev.marker.place.coordinates.lng, prev.marker.place.coordinates.lat]);
        setPreviewPixel({ x: p.x, y: p.y });
      }
    });
    mapRef.current = map;
  }, [onClearFocus]);

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
  }, [markers, countryCodes, countriesGeo, mapReady, trajectory, routesOn, renderMapContent]);

  // --- Map ↔ Timeline synchronization (v1.3): marker emphasis ---
  // Timeline-initiated focus emphasizes the matching marker (a restrained
  // ring); anything else (map-initiated, cleared, or a place without a
  // marker, e.g. a future/wishlist node) leaves markers untouched. Runs after
  // renderMapContent so freshly recreated markers are covered.
  useEffect(() => {
    const focusPlaceId =
      focus && markerElsRef.current.has(focus.placeId) ? focus.placeId : null;
    for (const [placeId, el] of markerElsRef.current) {
      el.classList.toggle("atlas-marker--focused", placeId === focusPlaceId);
    }
  }, [focus, markers, mapReady]);

  // --- Map ↔ Timeline synchronization (v1.3): restrained camera ---
  // Only a timeline-initiated focus moves the camera, and only when the Place
  // is not already comfortably visible: a small pan preserving the current
  // zoom, with modest easing. Hover never moves the camera; a collapsed Hero
  // Map never moves the camera (marker emphasis still applies — see above).
  useEffect(() => {
    if (!focus || focus.source !== "timeline" || !mapReady) return;
    const map = mapRef.current;
    const place = places.find((p) => p.id === focus.placeId);
    // Only visited Places have markers; a future/wishlist node has nothing to
    // emphasize on the hero map, so the camera must not wander to it.
    if (!map || !place || !markerElsRef.current.has(focus.placeId)) return;
    if (
      document.querySelector(".atlas-map-clip")?.classList.contains("atlas-map-clip--strip")
    ) {
      return; // collapsed contextual strip: keep the user's scroll position
    }
    const p = map.project([place.coordinates.lng, place.coordinates.lat]);
    const w = map.getCanvas().clientWidth;
    const h = map.getCanvas().clientHeight;
    const margin = Math.min(110, Math.round(Math.min(w, h) * 0.16));
    if (p.x > margin && p.x < w - margin && p.y > margin && p.y < h - margin) {
      return; // already comfortably visible — do not move the camera
    }
    map.easeTo({ center: [place.coordinates.lng, place.coordinates.lat], duration: 480 });
  }, [focus, places, mapReady]);

  // --- Map ↔ Timeline synchronization (v1.3): route-segment emphasis ---
  // When the focused node is a Visit with a residence → destination segment
  // and Routes are enabled, that segment is emphasized via MapLibre
  // feature-state (wider, more opaque) while the others stay visible but
  // weaker. Routes disabled → no emphasis, and synchronization keeps working.
  const emphasizedSegIdRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const clearEmphasis = () => {
      if (emphasizedSegIdRef.current != null && map.getSource("routes")) {
        map.setFeatureState(
          { source: "routes", id: emphasizedSegIdRef.current },
          { emphasized: false }
        );
      }
      emphasizedSegIdRef.current = null;
    };
    const segId = focus?.visitId
      ? trajectory.segments.find((s) => s.id.endsWith("#" + focus.visitId))?.id
      : undefined;
    if (!segId || !routesOn || !map.getSource("routes")) {
      clearEmphasis();
      return;
    }
    clearEmphasis();
    map.setFeatureState({ source: "routes", id: segId }, { emphasized: true });
    emphasizedSegIdRef.current = segId;
  }, [focus, routesOn, trajectory, mapReady]);

  // --- recreate map on theme change (base style swap) ---
  const skipFirstStyle = useRef(true);
  useEffect(() => {
    if (skipFirstStyle.current) {
      skipFirstStyle.current = false;
      return;
    }
    createMap();
  }, [theme.map.styleUrl, createMap]);

  // --- optional default map position (Settings) ---
  // The map is created once on mount (possibly before Settings arrive), so the
  // default position is applied with a one-shot jump the first time it is known.
  const appliedInitialRef = useRef(false);
  useEffect(() => {
    if (appliedInitialRef.current || !initialCenter) return;
    const map = mapRef.current;
    if (!map || !mapReady) return;
    appliedInitialRef.current = true;
    map.jumpTo({ center: initialCenter, zoom: initialZoom ?? EUROPE_ZOOM });
  }, [initialCenter, initialZoom, mapReady]);

  return (
    <div className="atlas-hero">
      <div ref={containerRef} className="atlas-hero__map" />
      <div className="atlas-hero__tint" aria-hidden="true" />

      {!overlayOpen ? (
        <div className="atlas-hero__hint" aria-hidden="true">
          <span>Scroll to explore my journey</span>
          <svg viewBox="0 0 16 16" width="14" height="14">
            <path
              d="M3 6l5 5 5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      ) : null}

      {!overlayOpen ? (
        <button
          type="button"
          className={"atlas-hero__routes" + (routesOn ? " atlas-hero__routes--on" : "")}
          onClick={onToggleRoutes}
          aria-pressed={routesOn}
          title={routesOn ? "Hide chronological routes" : "Show chronological routes"}
        >
          <svg
            className="atlas-hero__routes-icon"
            viewBox="0 0 20 12"
            width="20"
            height="12"
            aria-hidden="true"
          >
            <path
              d="M2 6h16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <circle cx="6.5" cy="6" r="1.6" fill="currentColor" />
            <circle cx="13.5" cy="6" r="1.6" fill="currentColor" />
          </svg>
          <span className="atlas-hero__routes-label">Routes</span>
          <span className="atlas-hero__routes-state">{routesOn ? "On" : "Off"}</span>
        </button>
      ) : null}

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
  // aria-label and tabindex are (re)applied by the caller after addTo(),
  // because MapLibre overwrites the label and drops focusability there.
  if (m.isCurrent) {
    const ring = document.createElement("span");
    ring.className = "atlas-marker__ring";
    el.appendChild(ring);
  }
  const dot = document.createElement("span");
  dot.className = "atlas-marker__dot";
  el.appendChild(dot);
  // The current location is the one marker whose label is visible by default
  // (VISUAL_SPEC §4: "Current location: … label visible by default"); every
  // other place only reveals its name through the hover/focus preview.
  if (m.isCurrent) {
    const label = document.createElement("span");
    label.className = "atlas-marker__label";
    label.setAttribute("aria-hidden", "true"); // the button's own aria-label already announces this
    const name = document.createElement("span");
    name.className = "atlas-marker__label-name";
    name.textContent = m.place.name;
    const country = document.createElement("span");
    country.className = "atlas-marker__label-country";
    country.textContent = m.place.country;
    label.append(name, country);
    el.appendChild(label);
  }
  // A residence (lived Visit) that is not the current base gets a calm static
  // ring so the map reads as clusters radiating from home bases (v1.3) —
  // restrained, theme-aware, and never animated like the current marker.
  if (m.visitType === "lived" && !m.isCurrent) {
    const home = document.createElement("span");
    home.className = "atlas-marker__home";
    home.setAttribute("aria-hidden", "true");
    el.appendChild(home);
  }
  return el;
}
