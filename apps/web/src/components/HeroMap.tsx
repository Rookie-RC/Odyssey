"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Media, Place, Profile, Transport, Visit, Wishlist } from "../lib/types";
import {
  buildMapMarkers,
  buildWishMarkers,
  placesBounds,
  visitedCountryCodes,
  wishlistCountryCodes,
  markerHasFlag,
  markerRadius,
  type MapMarker,
  type WishMarker,
} from "../lib/map-data";
import { getRouteTrajectory } from "../lib/routes";
import { visitTypeLabel } from "../lib/timeline";
import { formatDateRange, getPlaceStory } from "../lib/domain";
import { TRANSPORTS, TRANSPORT_GLYPH, transportLabel, transportOf } from "../lib/transport";
import { ACTIVITY_GLYPH, OVERNIGHT_GLYPH, activityLabel, glyphSvg, primaryActivity } from "../lib/activity";
import { LAYER_BEFORE, baseStyleUrl, loadThemeStyle } from "../lib/map-style";
import { mediaSrc } from "../lib/api";
import { getLocale, t, useLocale } from "../lib/i18n";
import type { SyncFocus } from "../lib/sync";
import type { AtlasTheme } from "../themes";
import {
  ChevronRight,
  LayersIcon,
  MinusIcon,
  PeopleIcon,
  PinIcon,
  PlusIcon,
  RecenterIcon,
  RouteIcon,
  StarIcon,
  HomeIcon,
  TransportIcon,
  ActivityIcon,
} from "./Icons";

const EUROPE_CENTER: [number, number] = [10, 50];
const EUROPE_ZOOM = 4.2;
const FIT_MAX_ZOOM = 5.2;
/** A wishlist pin's disc radius (label collisions, tap picking). */
const WISH_RADIUS = 9;
/** A pin within this many px above the place card's top edge, or under the
 * card, counts as hidden by it… */
const CARD_CLEARANCE = 28;
/** …and the camera lifts it to this far above the card. */
const CARD_BREATHING = 64;
/** The top bar's bottom edge: a lifted pin never goes above it. */
const TOPBAR_EDGE = 72;

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

/** Optional Hero Map layers (persisted in Settings). */
export interface MapLayers {
  routes: boolean;
  wishlist: boolean;
  countries: boolean;
}

/** Something on the map that can be tapped: a visited place or a wish. */
type Pin = { kind: "visit"; marker: MapMarker } | { kind: "wish"; wish: WishMarker };

/** The hover tooltip: a marker and where it sits on the map. */
interface MicroState {
  marker: MapMarker;
  x: number;
  y: number;
}

interface HeroMapProps {
  places: Place[];
  visits: Visit[];
  wishlist: Wishlist[];
  profile: Profile | null;
  countriesGeo: CountryCollection | null;
  theme: AtlasTheme;
  media: Media[];
  /** True while something covers the map: an overlay (place detail, ideas),
   * Manage Atlas or another tab. Closes the map's own card and layers menu. */
  obscured: boolean;
  layers: MapLayers;
  onLayersChange: (next: MapLayers) => void;
  /** Shared Map ↔ Timeline focus (v1.3). The map responds when the Timeline
   * initiated (`source === "timeline"`): the marker is emphasized and the
   * camera is gently adjusted only when needed. */
  focus?: SyncFocus | null;
  /** Emitted when a marker is tapped/selected (Map → Timeline sync). */
  onFocusPlace?: (placeId: string) => void;
  /** Emitted when the selection ends: the map is tapped or the place card is
   * dismissed. */
  onClearFocus?: () => void;
  onOpenPlace?: (placeId: string) => void;
  /** Optional default map position from Settings (PRODUCT_SPEC §34). */
  initialCenter?: [number, number] | null;
  initialZoom?: number | null;
  /** Imperative "show on map" request (search); nonce re-triggers. */
  flyTo?: { placeId: string; nonce: number } | null;
  /** False until Settings (theme, language, default position) are known; the
   * map is created only then, so it never paints the wrong basemap first. */
  ready?: boolean;
}

interface MarkerEntry {
  marker: maplibregl.Marker;
  el: HTMLDivElement;
  label: HTMLSpanElement | null;
  labelSize: { w: number; h: number } | null;
  lngLat: [number, number];
  pin: Pin;
  rank: number;
  isCurrent: boolean;
  hasFlag: boolean;
  /** The pin disc's radius (an activity badge is larger than a dot). */
  radius: number;
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
  wishlist,
  profile,
  countriesGeo,
  theme,
  media,
  obscured,
  layers,
  onLayersChange,
  focus = null,
  onFocusPlace,
  onClearFocus,
  onOpenPlace,
  initialCenter,
  initialZoom,
  flyTo,
  ready = true,
}: HeroMapProps) {
  const heroRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const layersRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const entriesRef = useRef<Map<string, MarkerEntry>>(new Map());
  const wishObjsRef = useRef<maplibregl.Marker[]>([]);
  // Wishlist pins whose names join the label layout (after visited labels).
  const wishEntriesRef = useRef<
    {
      el: HTMLDivElement;
      label: HTMLSpanElement;
      labelSize: { w: number; h: number } | null;
      lngLat: [number, number];
      pin: Pin;
    }[]
  >([]);
  const peekRef = useRef<MapMarker | null>(null);
  const microRef = useRef<MicroState | null>(null);
  const userMovedRef = useRef(false);
  const appliedThemeRef = useRef<string | null>(null);
  // True between a style's `style.load` and the next setStyle. Style-bound
  // layers are (re)added on this rather than isStyleLoaded(), which stays false
  // until every tile and the sprite have arrived — so additions right after a
  // theme switch, or during a pan, would otherwise be silently dropped.
  const styleReadyRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [styleGen, setStyleGen] = useState(0);
  const [mapError, setMapError] = useState("");
  // The tapped place, as a card docked above the tab bar.
  const [peek, setPeek] = useState<MapMarker | null>(null);
  // The hover tooltip (hover-capable pointers only).
  const [micro, setMicro] = useState<MicroState | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  // Height of whatever is docked at the bottom (the card or, on phones, the
  // layers sheet), so the map controls can sit above it.
  const [dockH, setDockH] = useState(0);

  // Labels inside the derived markers are localized: recompute on a language switch.
  const locale = useLocale();
  const markers = useMemo(
    () => buildMapMarkers(places, visits, profile),
    [places, visits, profile, locale] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const wishMarkers = useMemo(
    () => buildWishMarkers(places, visits, wishlist),
    [places, visits, wishlist, locale] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const countryCodes = useMemo(() => visitedCountryCodes(places, visits), [places, visits]);
  const wishCodes = useMemo(() => wishlistCountryCodes(places, visits, wishlist), [places, visits, wishlist]);
  // Residence-based route trajectory, derived in the domain layer (lib/routes)
  // and memoized: it only changes when Places/Visits change, never on map
  // moves.
  const trajectory = useMemo(() => getRouteTrajectory(places, visits), [places, visits]);

  // Latest values for map callbacks (kept stable across renders).
  const contentRef = useRef({ theme, countryCodes, wishCodes, countriesGeo, layers, trajectory, markers });
  contentRef.current = { theme, countryCodes, wishCodes, countriesGeo, layers, trajectory, markers };
  peekRef.current = peek;
  microRef.current = micro;

  // An overlay or another tab supersedes the place card and the layers menu.
  useEffect(() => {
    if (obscured) {
      setPeek(null);
      setMicro(null);
      setLayersOpen(false);
    }
  }, [obscured]);

  // --- place card and hover tooltip helpers (stable) ---
  const showMicro = useCallback((m: MapMarker) => {
    const map = mapRef.current;
    if (!map || peekRef.current) return;
    const p = map.project([m.place.coordinates.lng, m.place.coordinates.lat]);
    setMicro({ marker: m, x: p.x, y: p.y });
  }, []);

  const clearMicro = useCallback((m: MapMarker) => {
    setMicro((prev) => (prev?.marker.place.id === m.place.id ? null : prev));
  }, []);

  const openPeek = useCallback((m: MapMarker) => {
    setMicro(null);
    setLayersOpen(false);
    setPeek(m);
  }, []);

  // Dismissing the card ends its selection, as tapping the map does.
  const closePeek = useCallback(() => {
    const open = peekRef.current != null;
    setPeek(null);
    if (open) onClearFocus?.();
  }, [onClearFocus]);

  // What a tap on a pin does: a visited place opens its card, a wish its detail.
  const activate = useCallback(
    (pin: Pin) => {
      if (pin.kind === "wish") {
        onOpenPlace?.(pin.wish.place.id);
        return;
      }
      openPeek(pin.marker);
      // Map → Timeline synchronization (v1.3).
      onFocusPlace?.(pin.marker.place.id);
    },
    [openPeek, onOpenPlace, onFocusPlace]
  );

  // Every pin has an invisible 44 px hit area, and close pins' areas overlap;
  // the browser would give the overlap to whichever pin was added last. A tap
  // is settled here instead: the pin whose disc it is nearest to (deepest
  // inside, if it landed in one), a higher-ranked pin first on a tie.
  const pickPin = useCallback((clientX: number, clientY: number, fallback: Pin): Pin => {
    const map = mapRef.current;
    if (!map) return fallback;
    const box = map.getContainer().getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    let best = fallback;
    let bestGap = Infinity;
    const consider = (pin: Pin, lngLat: [number, number], radius: number) => {
      const p = map.project(lngLat);
      const gap = Math.hypot(p.x - x, p.y - y) - radius;
      if (gap < bestGap) {
        best = pin;
        bestGap = gap;
      }
    };
    for (const e of entriesRef.current.values()) consider(e.pin, e.lngLat, e.radius);
    for (const w of wishEntriesRef.current) consider(w.pin, w.lngLat, WISH_RADIUS);
    return best;
  }, []);

  // --- label collision layout ---
  // Every visited place may carry a name label, but labels never collide: in
  // rank order (current, lived, trip … transit) each label tries the right of
  // its pin, then the left, and is hidden if both would overlap an earlier
  // label or another pin. Density therefore stays calm at any zoom
  // (VISUAL_SPEC §4: selective labels, no dense European text clutter).
  const layoutLabels = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const entries = Array.from(entriesRef.current.values());
    const W = map.getCanvas().clientWidth;
    const H = map.getCanvas().clientHeight;
    const pts = entries.map((e) => ({ e, p: map.project(e.lngLat) }));
    type Rect = { x: number; y: number; w: number; h: number };
    const taken: Rect[] = pts.map(({ p, e }) => {
      const r = e.radius;
      return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
    });
    // A planted flag rises above its pin (pole + 13×9 flag).
    for (const { p, e } of pts) {
      if (e.hasFlag) taken.push({ x: p.x - 1, y: p.y - e.radius - 19, w: 16, h: 13 });
    }
    const wishes = wishEntriesRef.current.map((w) => ({ w, p: map.project(w.lngLat) }));
    // Vehicle badges on the routes (only those drawn at this zoom).
    const { layers: shown, trajectory: tr } = contentRef.current;
    if (shown.routes) {
      // Zoom-dependent filters are evaluated at integer zoom levels.
      const z = Math.floor(map.getZoom());
      for (const f of tr.icons.features) {
        if (z < f.properties.minZoom) continue;
        const q = map.project(f.geometry.coordinates);
        taken.push({ x: q.x - 9, y: q.y - 9, w: 18, h: 18 });
      }
    }
    for (const { p } of wishes) {
      taken.push({ x: p.x - WISH_RADIUS, y: p.y - WISH_RADIUS, w: WISH_RADIUS * 2, h: WISH_RADIUS * 2 });
    }
    // Floating chrome (map controls, top bar, tab bar, the open place card) is
    // an obstacle too, so a label never slides underneath a button or the card.
    const box = map.getContainer().getBoundingClientRect();
    for (const sel of [".atlas-map-controls", ".atlas-topbar__actions", ".atlas-tabbar", ".atlas-peek-card"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      taken.push({ x: r.left - box.left - 6, y: r.top - box.top - 6, w: r.width + 12, h: r.height + 12 });
    }
    const hits = (a: Rect) =>
      taken.some((b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
    pts.sort((a, b) => b.e.rank - a.e.rank);
    for (const { e, p } of pts) {
      if (!e.label) continue;
      if (!e.labelSize) {
        e.labelSize = { w: e.label.offsetWidth, h: e.label.offsetHeight };
      }
      const { w, h } = e.labelSize;
      const off = e.isCurrent ? 18 : e.radius + 6;
      const right: Rect = { x: p.x + off, y: p.y - h / 2, w, h };
      const left: Rect = { x: p.x - off - w, y: p.y - h / 2, w, h };
      const inView = (r: Rect) => r.x >= 4 && r.x + r.w <= W - 4 && r.y >= 4 && r.y + r.h <= H - 4;
      let side: "right" | "left" | null = null;
      if (!hits(right) && (inView(right) || !inView(left))) side = "right";
      else if (!hits(left) && inView(left)) side = "left";
      else if (e.isCurrent) side = "right"; // the current label is always shown
      e.el.classList.toggle("atlas-marker--label-left", side === "left");
      e.el.classList.toggle("atlas-marker--label-hidden", side === null);
      if (side) taken.push(side === "right" ? right : left);
    }
    // Wishlist names come last: they yield to every visited label.
    for (const { w, p } of wishes) {
      if (!w.labelSize) w.labelSize = { w: w.label.offsetWidth, h: w.label.offsetHeight };
      const { w: lw, h } = w.labelSize;
      const right: Rect = { x: p.x + 13, y: p.y - h / 2, w: lw, h };
      const left: Rect = { x: p.x - 13 - lw, y: p.y - h / 2, w: lw, h };
      const inView = (r: Rect) => r.x >= 4 && r.x + r.w <= W - 4 && r.y >= 4 && r.y + r.h <= H - 4;
      let side: "right" | "left" | null = null;
      if (!hits(right) && inView(right)) side = "right";
      else if (!hits(left) && inView(left)) side = "left";
      w.el.classList.toggle("atlas-wishpin--label-left", side === "left");
      w.el.classList.toggle("atlas-wishpin--label-hidden", side === null);
      if (side) taken.push(side === "right" ? right : left);
    }
  }, []);

  const labelRaf = useRef<number | null>(null);
  const scheduleLabels = useCallback(() => {
    if (labelRaf.current != null) return;
    labelRaf.current = requestAnimationFrame(() => {
      labelRaf.current = null;
      layoutLabels();
    });
  }, [layoutLabels]);

  // --- camera framing ---
  const frameAtlas = useCallback(
    (animate: boolean) => {
      const map = mapRef.current;
      if (!map) return;
      const { markers } = contentRef.current;
      if (initialCenter) {
        const opts = { center: initialCenter, zoom: initialZoom ?? EUROPE_ZOOM };
        if (animate) map.flyTo({ ...opts, duration: 900, essential: true });
        else map.jumpTo(opts);
        return;
      }
      const b = placesBounds(markers.map((m) => m.place));
      if (!b) {
        const opts = { center: EUROPE_CENTER, zoom: EUROPE_ZOOM };
        if (animate) map.flyTo({ ...opts, duration: 900 });
        else map.jumpTo(opts);
        return;
      }
      const W = map.getCanvas().clientWidth;
      const H = map.getCanvas().clientHeight;
      const padding = {
        top: Math.round(H * 0.16) + 40,
        // the tab bar floats over the bottom of the map
        bottom: Math.round(H * 0.12) + 110,
        left: Math.round(W * 0.14),
        right: Math.round(W * 0.14),
      };
      try {
        map.fitBounds(b, { padding, maxZoom: FIT_MAX_ZOOM, duration: animate ? 900 : 0 });
      } catch {
        map.jumpTo({ center: EUROPE_CENTER, zoom: EUROPE_ZOOM });
      }
    },
    [initialCenter, initialZoom]
  );

  // --- (re)add style-bound layers: country fill + routes (idempotent) ---
  const renderLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !styleReadyRef.current) return;
    const { theme, countryCodes, wishCodes, countriesGeo, layers, trajectory } = contentRef.current;

    const pick = (list: string[]): CountryCollection => {
      const codes = new Set(list);
      return {
        type: "FeatureCollection",
        features: (countriesGeo?.features ?? []).filter((f) => codes.has(f.properties.ISO_A2)),
      };
    };
    const filtered = pick(countryCodes);
    const countrySrc = map.getSource("countries") as maplibregl.GeoJSONSource | undefined;
    if (!countrySrc) map.addSource("countries", { type: "geojson", data: filtered as never });
    else countrySrc.setData(filtered as never);
    if (!map.getLayer("countries-fill")) {
      // Inserted beneath the basemap water: the coarse Natural Earth polygons
      // are trimmed by the precise OSM coastline, so the fill never spills
      // into the sea and needs no (misaligned) outline.
      map.addLayer(
        { id: "countries-fill", type: "fill", source: "countries", paint: { "fill-color": theme.countries.fill } },
        map.getLayer(LAYER_BEFORE.countries) ? LAYER_BEFORE.countries : undefined
      );
    }
    map.setPaintProperty("countries-fill", "fill-color", theme.countries.fill);
    map.setLayoutProperty("countries-fill", "visibility", layers.countries ? "visible" : "none");

    // Countries only on the wishlist: fine hatching in the wish colour — solid
    // means "been there", hatched means "would like to go". Shown with the
    // wishlist pins.
    const hatch = "atlas-hatch-" + theme.id;
    if (!map.hasImage(hatch)) map.addImage(hatch, hatchImage(theme.countries.wish), { pixelRatio: 2 });
    const wishSrc = map.getSource("wish-countries") as maplibregl.GeoJSONSource | undefined;
    if (!wishSrc) map.addSource("wish-countries", { type: "geojson", data: pick(wishCodes) as never });
    else wishSrc.setData(pick(wishCodes) as never);
    if (!map.getLayer("countries-wish")) {
      map.addLayer(
        { id: "countries-wish", type: "fill", source: "wish-countries", paint: { "fill-pattern": hatch } },
        map.getLayer(LAYER_BEFORE.countries) ? LAYER_BEFORE.countries : undefined
      );
    }
    map.setPaintProperty("countries-wish", "fill-pattern", hatch);
    map.setLayoutProperty("countries-wish", "visibility", layers.wishlist ? "visible" : "none");

    // Routes (v1.2/v1.3): residence → destination, each drawn in its trip's
    // transport style — a dashed flight arc, a rail line with sleepers, a road
    // with a centre line — above roads/borders, below labels and the DOM
    // markers. The focused segment (feature-state "emphasized", Map ↔ Timeline
    // sync) is subtly stronger.
    const routeSrc = map.getSource("routes") as maplibregl.GeoJSONSource | undefined;
    // promoteId: MapLibre drops non-numeric string feature ids, so feature
    // state (segment emphasis) is keyed by the `segment` property instead.
    if (!routeSrc) map.addSource("routes", { type: "geojson", data: trajectory.geojson as never, promoteId: "segment" });
    else routeSrc.setData(trajectory.geojson as never);
    const iconSrc = map.getSource("route-icons") as maplibregl.GeoJSONSource | undefined;
    if (!iconSrc) map.addSource("route-icons", { type: "geojson", data: trajectory.icons as never });
    else iconSrc.setData(trajectory.icons as never);
    const before = map.getLayer(LAYER_BEFORE.routes) ? LAYER_BEFORE.routes : undefined;
    const ink = opaque(theme.routes.line);
    for (const spec of routeLayers(theme)) {
      if (!map.getLayer(spec.id)) map.addLayer(spec as maplibregl.LayerSpecification, before);
      else for (const [k, v] of Object.entries(spec.paint ?? {})) map.setPaintProperty(spec.id, k, v);
      map.setLayoutProperty(spec.id, "visibility", layers.routes ? "visible" : "none");
    }
    for (const mode of TRANSPORTS) {
      const name = "atlas-mode-" + mode + "-" + theme.id;
      if (!map.hasImage(name)) map.addImage(name, vehicleImage(mode, ink, theme.markers.labelHalo), { pixelRatio: 2 });
    }
    if (!map.getLayer("routes-icons")) {
      map.addLayer(
        {
          id: "routes-icons",
          type: "symbol",
          source: "route-icons",
          filter: [">=", ["zoom"], ["get", "minZoom"]],
          layout: {
            "icon-image": ["concat", "atlas-mode-", ["get", "mode"], "-" + theme.id],
            // The plane turns with its flight; ground vehicles stay upright.
            "icon-rotate": ["case", ["==", ["get", "mode"], "plane"], ["get", "bearing"], 0],
            "icon-rotation-alignment": "map",
            "icon-size": ["interpolate", ["linear"], ["zoom"], 2, 0.78, 6, 1],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
          },
        },
        before
      );
    }
    map.setLayoutProperty("routes-icons", "icon-image", ["concat", "atlas-mode-", ["get", "mode"], "-" + theme.id]);
    map.setLayoutProperty("routes-icons", "visibility", layers.routes ? "visible" : "none");
    scheduleLabels(); // vehicle badges are label obstacles
  }, [scheduleLabels]);

  // --- create the map (once, when Settings are known) ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !ready) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    (async () => {
      if (!webglAvailable()) {
        setMapError(t("WebGL is not available in this browser, which the map requires."));
        return;
      }
      const initialTheme = contentRef.current.theme;
      const initialLocale = getLocale();
      let style: StyleSpecification | string = baseStyleUrl(initialTheme);
      try {
        style = await loadThemeStyle(initialTheme);
      } catch {
        // offline / blocked: fall back to the raw style URL (MapLibre retries)
      }
      if (cancelled) return;
      try {
        map = new maplibregl.Map({
          container,
          style,
          center: initialCenter ?? EUROPE_CENTER,
          zoom: initialZoom ?? EUROPE_ZOOM,
          // The map has its own tab: one finger pans, a pinch or the wheel zooms.
          scrollZoom: true,
          // A flat 2D atlas: rotation and pitch are disabled at the gesture
          // level and clamped so the camera can never leave 2D.
          dragRotate: false,
          pitchWithRotate: false,
          touchZoomRotate: true,
          touchPitch: false,
          keyboard: false,
          maxPitch: 0,
          attributionControl: { compact: true },
          fadeDuration: 180,
        });
        map.touchZoomRotate.disableRotation();
      } catch (e) {
        setMapError(e instanceof Error ? e.message : String(e));
        return;
      }
      mapRef.current = map;
      appliedThemeRef.current = initialTheme.id + "|" + getLocale();
      // Settings (and so the theme) may have arrived while the first style
      // was loading: catch up immediately.
      const latest = contentRef.current.theme;
      if (latest.id !== initialTheme.id || getLocale() !== initialLocale) {
        appliedThemeRef.current = latest.id + "|" + getLocale();
        loadThemeStyle(latest)
          .then((st) => {
            if (mapRef.current !== map || !map) return;
            styleReadyRef.current = false;
            map.setStyle(st, { diff: false });
          })
          .catch(() => {});
      }
      map.on("load", () => {
        setMapReady(true);
        // Keep the credits one tap away (ⓘ) rather than a line of text over
        // the hero: MapLibre opens compact attribution expanded on load.
        container
          .querySelector(".maplibregl-ctrl-attrib.maplibregl-compact-show")
          ?.classList.remove("maplibregl-compact-show");
      });
      map.on("style.load", () => {
        styleReadyRef.current = true;
        setStyleGen((g) => g + 1);
      });
      map.on("click", () => {
        setPeek(null);
        setLayersOpen(false);
        onClearFocus?.();
      });
      map.on("dragstart", () => {
        userMovedRef.current = true;
      });
      map.on("zoomstart", (e) => {
        if (e.originalEvent) userMovedRef.current = true;
      });
      map.on("move", () => {
        const hovered = microRef.current;
        const m = mapRef.current;
        if (hovered && m) {
          const { lng, lat } = hovered.marker.place.coordinates;
          const p = m.project([lng, lat]);
          setMicro({ ...hovered, x: p.x, y: p.y });
        }
        scheduleLabels();
      });
      map.on("resize", scheduleLabels);
    })();
    return () => {
      cancelled = true;
      if (labelRaf.current != null) cancelAnimationFrame(labelRaf.current);
      mapRef.current?.remove();
      mapRef.current = null;
      styleReadyRef.current = false;
    };
    // The map is created exactly once (`ready` only ever turns true); later
    // prop changes flow through effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // --- theme / language change: swap the adapted base style in place
  // (camera, markers and selection survive; style-bound layers are re-added
  // on style.load) ---
  useEffect(() => {
    const map = mapRef.current;
    const key = theme.id + "|" + locale;
    // No map yet: creation reads the latest theme itself once it is ready.
    if (!map || appliedThemeRef.current === key) return;
    appliedThemeRef.current = key;
    let cancelled = false;
    loadThemeStyle(theme)
      .then((style) => {
        if (cancelled || mapRef.current !== map) return;
        styleReadyRef.current = false;
        map.setStyle(style, { diff: false });
      })
      .catch(() => {
        if (cancelled || mapRef.current !== map) return;
        styleReadyRef.current = false;
        map.setStyle(baseStyleUrl(theme), { diff: false });
      });
    return () => {
      cancelled = true;
    };
  }, [theme, locale]);

  // --- style-bound layers follow data, layer toggles and style reloads ---
  useEffect(() => {
    renderLayers();
  }, [renderLayers, styleGen, mapReady, countryCodes, wishCodes, countriesGeo, trajectory, layers, theme]);

  // --- visited markers (DOM; independent of the style) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const e of entriesRef.current.values()) e.marker.remove();
    entriesRef.current.clear();
    for (const m of markers) {
      const { el, label } = makeMarkerElement(m);
      const lngLat: [number, number] = [m.place.coordinates.lng, m.place.coordinates.lat];
      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map);
      // MapLibre stamps a generic aria-label and drops tabindex during
      // addTo(), so both are (re)applied: every marker announces its own place
      // and is keyboard-operable (PRODUCT_SPEC §38).
      const name = m.place.name + ", " + m.place.country;
      el.setAttribute("aria-label", m.isCurrent ? t("{place} — current base", { place: name }) : name);
      el.tabIndex = 0;
      const pin: Pin = { kind: "visit", marker: m };
      // The tooltip is for hover-capable pointers: a touch (which also moves
      // focus to the tapped pin) goes straight to the card.
      el.addEventListener("pointerenter", (ev) => {
        if (ev.pointerType !== "touch") showMicro(m);
      });
      el.addEventListener("pointerleave", () => clearMicro(m));
      el.addEventListener("focus", () => {
        if (el.matches(":focus-visible")) showMicro(m);
      });
      el.addEventListener("blur", () => clearMicro(m));
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // detail is 0 for a click made without a pointer (assistive tech).
        activate(ev.detail > 0 ? pickPin(ev.clientX, ev.clientY, pin) : pin);
      });
      el.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        activate(pin);
      });
      entriesRef.current.set(m.place.id, {
        marker,
        el,
        label,
        labelSize: null,
        lngLat,
        pin,
        rank: m.rank,
        isCurrent: m.isCurrent,
        hasFlag: markerHasFlag(m),
        radius: markerRadius(m),
      });
    }
    scheduleLabels();
  }, [markers, mapReady, showMicro, clearMicro, activate, pickPin, scheduleLabels]);

  // Label metrics depend on the theme's fonts: re-measure after a theme switch.
  useEffect(() => {
    const t = window.setTimeout(() => {
      for (const e of entriesRef.current.values()) e.labelSize = null;
      for (const w of wishEntriesRef.current) w.labelSize = null;
      scheduleLabels();
    }, 120);
    return () => window.clearTimeout(t);
  }, [theme.id, scheduleLabels]);

  // --- wishlist pins (optional layer) ---
  useEffect(() => {
    const map = mapRef.current;
    wishObjsRef.current.forEach((m) => m.remove());
    wishObjsRef.current = [];
    wishEntriesRef.current = [];
    if (!map || !mapReady || !layers.wishlist) {
      scheduleLabels();
      return;
    }
    for (const w of wishMarkers) {
      const { el, label } = makeWishElement(w);
      const lngLat: [number, number] = [w.place.coordinates.lng, w.place.coordinates.lat];
      const marker = new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat(lngLat).addTo(map);
      const pin: Pin = { kind: "wish", wish: w };
      wishEntriesRef.current.push({ el, label, labelSize: null, lngLat, pin });
      el.setAttribute("aria-label", t("Wishlist: {place}", { place: w.place.name + ", " + w.place.country }));
      el.tabIndex = 0;
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        activate(ev.detail > 0 ? pickPin(ev.clientX, ev.clientY, pin) : pin);
      });
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          ev.stopPropagation();
          activate(pin);
        }
      });
      wishObjsRef.current.push(marker);
    }
    scheduleLabels();
  }, [wishMarkers, layers.wishlist, mapReady, activate, pickPin, scheduleLabels]);

  // --- first framing: fit the visited places once they are known ---
  const framedRef = useRef(false);
  useEffect(() => {
    if (framedRef.current || !mapReady || userMovedRef.current) return;
    if (markers.length === 0 && !initialCenter) return;
    framedRef.current = true;
    frameAtlas(false);
    scheduleLabels();
  }, [mapReady, markers, initialCenter, frameAtlas, scheduleLabels]);

  // --- Map ↔ Timeline synchronization (v1.3): marker emphasis ---
  // The pin whose card is open stays marked too, whoever holds the focus.
  const peekId = peek?.place.id ?? null;
  useEffect(() => {
    const focusPlaceId = focus && entriesRef.current.has(focus.placeId) ? focus.placeId : null;
    for (const [placeId, e] of entriesRef.current) {
      e.el.classList.toggle("atlas-marker--focused", placeId === focusPlaceId || placeId === peekId);
    }
  }, [focus, markers, mapReady, peekId]);

  // --- place card: never hide its own pin ---
  // The card is docked over the bottom of the map. When the tapped pin lies
  // under it (or too close to read), the camera lifts the pin into clear view;
  // a pin that is already well above the card leaves the map where it is.
  useEffect(() => {
    const map = mapRef.current;
    const card = heroRef.current?.querySelector<HTMLElement>(".atlas-peek-card");
    if (!map || !peek || !card || dockH === 0) return;
    const { lng, lat } = peek.place.coordinates;
    const p = map.project([lng, lat]);
    const top = card.offsetTop;
    if (p.y < top - CARD_CLEARANCE) return;
    const dy = p.y - Math.max(TOPBAR_EDGE, top - CARD_BREATHING);
    if (dy > 0) map.panBy([0, dy], { duration: 420 });
  }, [peek, dockH]);

  // The card and the controls move together; lay the labels out again once
  // they have settled.
  useEffect(() => {
    scheduleLabels();
    const id = window.setTimeout(scheduleLabels, 320);
    return () => window.clearTimeout(id);
  }, [dockH, scheduleLabels]);

  // --- layers menu: closes on any outside press and on Escape ---
  useEffect(() => {
    if (!layersOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!layersRef.current?.contains(e.target as Node)) setLayersOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayersOpen(false);
    };
    // Capture: a pin or the map may stop the event before it reaches the document.
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [layersOpen]);

  // --- Map ↔ Timeline synchronization (v1.3): restrained camera ---
  // Only a timeline-initiated focus moves the camera, and only when the Place
  // is not comfortably visible.
  useEffect(() => {
    if (!focus || focus.source !== "timeline" || !mapReady) return;
    const map = mapRef.current;
    const place = places.find((p) => p.id === focus.placeId);
    if (!map || !place || !entriesRef.current.has(focus.placeId)) return;
    const p = map.project([place.coordinates.lng, place.coordinates.lat]);
    const w = map.getCanvas().clientWidth;
    const h = map.getCanvas().clientHeight;
    const margin = Math.min(110, Math.round(Math.min(w, h) * 0.16));
    if (p.x > margin && p.x < w - margin && p.y > margin && p.y < h - margin) return;
    map.easeTo({ center: [place.coordinates.lng, place.coordinates.lat], duration: 480 });
  }, [focus, places, mapReady]);

  // --- Map ↔ Timeline synchronization (v1.3): route-segment emphasis ---
  const emphasizedSegIdRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !map.getSource("routes")) return;
    if (emphasizedSegIdRef.current != null) {
      map.setFeatureState({ source: "routes", id: emphasizedSegIdRef.current }, { emphasized: false });
      emphasizedSegIdRef.current = null;
    }
    const segId = focus?.visitId
      ? trajectory.segments.find((s) => s.id.endsWith("#" + focus.visitId))?.id
      : undefined;
    if (!segId || !layers.routes) return;
    map.setFeatureState({ source: "routes", id: segId }, { emphasized: true });
    emphasizedSegIdRef.current = segId;
  }, [focus, layers.routes, trajectory, mapReady, styleGen]);

  // --- "show on map" (search) ---
  useEffect(() => {
    if (!flyTo || !mapReady) return;
    const map = mapRef.current;
    const place = places.find((p) => p.id === flyTo.placeId);
    if (!map || !place) return;
    userMovedRef.current = true;
    const m = markers.find((x) => x.place.id === place.id);
    map.flyTo({
      center: [place.coordinates.lng, place.coordinates.lat],
      zoom: Math.max(map.getZoom(), 5.6),
      duration: 1100,
      essential: true,
    });
    if (m) {
      map.once("moveend", () => openPeek(m));
    }
  }, [flyTo, mapReady, places, markers, openPeek]);

  const zoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    userMovedRef.current = true;
    map.easeTo({ zoom: clamp(map.getZoom() + delta, map.getMinZoom(), map.getMaxZoom()), duration: 260 });
  };

  const resetView = () => {
    closePeek();
    frameAtlas(true);
  };

  const story = useMemo(
    () => (peek ? getPlaceStory(peek.place.id, places, visits, [], profile, media) : null),
    [peek, places, visits, profile, media]
  );

  return (
    <div
      ref={heroRef}
      className="atlas-hero"
      // On phones the controls climb above whatever is docked at the bottom.
      style={{ "--dock-lift": dockH ? dockH + 4 + "px" : "0px" } as React.CSSProperties}
    >
      <div ref={containerRef} className="atlas-hero__map" />
      <div className="atlas-hero__tint" aria-hidden="true" />

      <div className="atlas-map-controls" role="group" aria-label={t("Map controls")}>
        <div className="atlas-map-controls__group atlas-glass">
          <button type="button" onClick={() => zoomBy(0.6)} aria-label={t("Zoom in")} title={t("Zoom in")}>
            <PlusIcon size={16} />
          </button>
          <button type="button" onClick={() => zoomBy(-0.6)} aria-label={t("Zoom out")} title={t("Zoom out")}>
            <MinusIcon size={16} />
          </button>
          <button type="button" onClick={resetView} aria-label={t("Reset view")} title={t("Reset view")}>
            <RecenterIcon size={16} />
          </button>
        </div>
        <div ref={layersRef} className="atlas-map-layers">
          <button
            type="button"
            className={"atlas-map-controls__single atlas-glass" + (layersOpen ? " is-open" : "")}
            onClick={() => {
              // The card and the menu share the bottom of the screen.
              if (!layersOpen) closePeek();
              setLayersOpen(!layersOpen);
            }}
            aria-expanded={layersOpen}
            aria-label={t("Map layers")}
            title={t("Map layers")}
          >
            <LayersIcon size={17} />
          </button>
          {layersOpen ? <LayersMenu layers={layers} onChange={onLayersChange} onHeight={setDockH} /> : null}
        </div>
      </div>

      {mapError ? (
        <div className="atlas-map-error">
          <p>{t("This atlas needs WebGL to render the map.")}</p>
          <p className="atlas-map-error__detail">{mapError}</p>
        </div>
      ) : null}

      {micro ? (
        <div className="atlas-micro" style={{ left: micro.x, top: micro.y }} role="tooltip">
          <span className="atlas-micro__name">{micro.marker.place.name}</span>
          <span className="atlas-micro__meta">
            {micro.marker.place.country}
            {micro.marker.isCurrent
              ? " · " + t("Living here")
              : (micro.marker.dateLabel ? " · " + micro.marker.dateLabel : "") +
                " · " +
                visitTypeLabel(micro.marker.visitType)}
          </span>
        </div>
      ) : null}

      {peek && story ? (
        <PeekCard
          key={peek.place.id}
          marker={peek}
          photos={story.media.slice(0, 2)}
          primaryVisit={story.primaryVisit}
          onHeight={setDockH}
          onOpen={() => {
            setPeek(null);
            onOpenPlace?.(peek.place.id);
          }}
          onClose={closePeek}
        />
      ) : null}
    </div>
  );
}

/** The layers menu: a popover beside the button on wide screens, a bottom sheet
 * above the tab bar on phones (styles/map.css). */
function LayersMenu({
  layers,
  onChange,
  onHeight,
}: {
  layers: MapLayers;
  onChange: (next: MapLayers) => void;
  onHeight: (h: number) => void;
}) {
  const ref = useReportHeight(onHeight);
  return (
    <div
      ref={ref}
      className="atlas-map-layers__menu atlas-glass atlas-glass--menu"
      role="menu"
      aria-label={t("Map layers")}
      data-owns-keyboard
    >
      <div className="atlas-map-layers__title">{t("On the map")}</div>
      <LayerToggle
        icon={<RouteIcon size={16} />}
        label={t("Routes")}
        hint={t("Trips radiating from each home")}
        on={layers.routes}
        onChange={(v) => onChange({ ...layers, routes: v })}
      />
      <LayerToggle
        icon={<StarIcon size={16} />}
        label={t("Wishlist")}
        hint={t("Places I dream of")}
        on={layers.wishlist}
        onChange={(v) => onChange({ ...layers, wishlist: v })}
      />
      <LayerToggle
        icon={<span className="atlas-map-layers__swatch" />}
        label={t("Countries")}
        hint={t("A soft wash over visited countries")}
        on={layers.countries}
        onChange={(v) => onChange({ ...layers, countries: v })}
      />
    </div>
  );
}

function LayerToggle({
  icon,
  label,
  hint,
  on,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      className={"atlas-map-layers__item" + (on ? " is-on" : "")}
      onClick={() => onChange(!on)}
    >
      <span className="atlas-map-layers__icon">{icon}</span>
      <span className="atlas-map-layers__text">
        <span className="atlas-map-layers__label">{label}</span>
        <span className="atlas-map-layers__hint">{hint}</span>
      </span>
      <span className="atlas-switch" aria-hidden="true">
        <span className="atlas-switch__knob" />
      </span>
    </button>
  );
}

/** Reports an element's height while it is on screen, so the map's controls
 * can sit above whatever is docked at the bottom of the map. */
function useReportHeight(onHeight: (height: number) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const report = () => onHeight(el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => {
      observer.disconnect();
      onHeight(0);
    };
  }, [onHeight]);
  return ref;
}

// The place card (reference: Bordeaux card): where and when, who with, how
// there, up to two photographs, and the way into the full memory. Docked above
// the tab bar rather than floating beside the pin, where on a phone it would
// cover that very pin. Swipe it down, tap the map or press Escape to dismiss.
function PeekCard({
  marker,
  photos,
  primaryVisit,
  onHeight,
  onOpen,
  onClose,
}: {
  marker: MapMarker;
  photos: Media[];
  primaryVisit: Visit | null;
  onHeight: (h: number) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const cardRef = useReportHeight(onHeight);
  const drag = useRef<{ pointer: number; startY: number; startT: number; dy: number; active: boolean } | null>(
    null
  );
  const exitTimer = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(
    () => () => {
      if (exitTimer.current != null) window.clearTimeout(exitTimer.current);
    },
    []
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { pointer: e.pointerId, startY: e.clientY, startT: e.timeStamp, dy: 0, active: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    if (e.buttons === 0) {
      drag.current = null; // released somewhere else: not a drag any more
      return;
    }
    const dy = e.clientY - d.startY;
    if (!d.active) {
      // A tap wobbles; only a clear pull downward starts the swipe. From then
      // on the card owns the pointer, so a swipe that began on "View memory"
      // does not end in a click on it.
      if (dy < 10) return;
      d.active = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.style.transition = "none";
    }
    d.dy = Math.max(0, dy);
    e.currentTarget.style.transform = `translateY(${d.dy}px)`;
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    const el = e.currentTarget;
    const speed = d.dy / Math.max(1, e.timeStamp - d.startT); // px per ms
    if (!cancelled && (d.dy > 64 || (d.dy > 24 && speed > 0.5))) {
      el.style.transition = "transform 0.18s ease-in, opacity 0.18s ease-in";
      el.style.transform = "translateY(110%)";
      el.style.opacity = "0";
      exitTimer.current = window.setTimeout(onClose, 170);
    } else {
      el.style.transition = "transform 0.2s var(--ease-out)";
      el.style.transform = "";
    }
  };

  const place = marker.place;
  const when = primaryVisit
    ? marker.isCurrent
      ? primaryVisit.startDate
        ? t("Since {date}", { date: formatDateRange(primaryVisit.startDate) })
        : t("Now")
      : formatDateRange(primaryVisit.startDate, primaryVisit.endDate)
    : marker.dateLabel;

  return (
    <div
      ref={cardRef}
      className="atlas-peek-card"
      role="dialog"
      aria-label={place.name + ", " + place.country}
      data-owns-keyboard
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
    >
      <div className="atlas-peek-card__head">
        <span className="atlas-peek-card__place">
          <PinIcon size={15} />
          <span className="atlas-break">
            {place.name}, {place.country}
          </span>
        </span>
        {when ? <span className="atlas-peek-card__date atlas-date">{when}</span> : null}
      </div>
      <div className="atlas-peek-card__sub">
        {marker.isCurrent ? (
          <>
            <HomeIcon size={14} /> {t("Living here")}
          </>
        ) : marker.withFriends ? (
          <>
            <PeopleIcon size={14} /> {t("With friends")} · {visitTypeLabel(marker.visitType)}
          </>
        ) : (
          visitTypeLabel(marker.visitType)
        )}
        {!marker.isCurrent && primaryVisit && primaryVisit.visitType !== "lived" ? (
          <span className="atlas-peek-card__transport">
            · <TransportIcon mode={transportOf(primaryVisit)} size={13} /> {transportLabel(transportOf(primaryVisit))}
          </span>
        ) : null}
        {!marker.isCurrent && primaryVisit && primaryVisit.visitType !== "lived" && primaryActivity(primaryVisit) ? (
          <span className="atlas-peek-card__transport">
            · <ActivityIcon activity={primaryActivity(primaryVisit)!} size={13} />{" "}
            {activityLabel(primaryActivity(primaryVisit)!)}
          </span>
        ) : null}
      </div>
      {photos.length > 0 ? (
        <div className={"atlas-peek-card__photos atlas-peek-card__photos--" + photos.length}>
          {photos.map((m) => (
            <img
              key={m.id}
              className="atlas-photo"
              src={mediaSrc(m, 640)}
              alt={m.caption ?? place.name}
              draggable={false}
            />
          ))}
        </div>
      ) : null}
      <button type="button" className="atlas-peek-card__open" onClick={onOpen}>
        <span>{t("View memory")}</span>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

/** rgba(…, a) → rgb(…): the vehicle glyphs use the route ink at full strength. */
function opaque(color: string): string {
  const m = /rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(color);
  return m ? `rgb(${m[1].trim()}, ${m[2].trim()}, ${m[3].trim()})` : color;
}

type RouteLayer = {
  id: string;
  type: "line";
  source: "routes";
  filter: unknown[];
  layout: Record<string, unknown>;
  paint: Record<string, unknown>;
};

/** The route line layers, one style per transport (bottom to top). */
function routeLayers(theme: AtlasTheme): RouteLayer[] {
  const em = (on: number, off: number) => ["case", ["boolean", ["feature-state", "emphasized"], false], on, off];
  const width = (a: number, b: number, c: number, boost: number) => [
    "interpolate", ["linear"], ["zoom"],
    3, em(a + boost, a),
    7, em(b + boost, b),
    11, em(c + boost, c),
  ];
  const mode = (m: Transport) => ["==", ["get", "mode"], m];
  const road = ["in", ["get", "mode"], ["literal", ["bus", "car"]]];
  const line = theme.routes.line;
  return [
    {
      // Bus / drive: a soft road band…
      id: "routes-road",
      type: "line",
      source: "routes",
      filter: road,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": line, "line-width": width(3.2, 4.2, 5.8, 1.2), "line-opacity": em(0.62, 0.36) },
    },
    {
      // …with a dashed centre line.
      id: "routes-road-centre",
      type: "line",
      source: "routes",
      filter: road,
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": theme.markers.labelHalo,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.7, 7, 0.9, 11, 1.2],
        "line-dasharray": [2.6, 2.4],
        "line-opacity": 0.95,
      },
    },
    {
      // Train: sleepers across the line (tiny dashes on a wide line)…
      id: "routes-rail-ties",
      type: "line",
      source: "routes",
      filter: mode("train"),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": line,
        "line-width": width(5.4, 6.6, 8.4, 1.2),
        "line-dasharray": [0.26, 1.35],
        "line-opacity": em(1, 0.9),
      },
    },
    {
      // …and the rail itself.
      id: "routes-rail",
      type: "line",
      source: "routes",
      filter: mode("train"),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": line, "line-width": width(1.2, 1.6, 2.2, 1.1), "line-opacity": em(1, 0.9) },
    },
    {
      // Flight: a fine dashed arc, like an airline route map.
      id: "routes-flight",
      type: "line",
      source: "routes",
      filter: mode("plane"),
      layout: { "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": line,
        "line-width": width(1.3, 1.7, 2.3, 1.1),
        "line-dasharray": [2.2, 1.8],
        "line-opacity": em(0.95, 0.75),
      },
    },
  ];
}

/** A vehicle glyph in the route ink with a halo, 15 px (plane) or 13 px, at
 * pixelRatio 2. */
function vehicleImage(mode: Transport, ink: string, halo: string): ImageData {
  const size = 36;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return new ImageData(size, size);
  const glyph = new Path2D(TRANSPORT_GLYPH[mode]);
  const px = mode === "plane" ? 30 : 26; // device px (15 / 13 css px)
  g.translate((size - px) / 2, (size - px) / 2);
  g.scale(px / 24, px / 24);
  g.lineJoin = "round";
  g.strokeStyle = halo;
  g.lineWidth = 3.4;
  g.stroke(glyph);
  g.fillStyle = ink;
  g.fill(glyph, "evenodd");
  return g.getImageData(0, 0, size, size);
}

/** A seamless tile of fine diagonal hatching (16 px at pixelRatio 2). */
function hatchImage(color: string): ImageData {
  const s = 16;
  const canvas = document.createElement("canvas");
  canvas.width = s;
  canvas.height = s;
  const g = canvas.getContext("2d");
  if (!g) return new ImageData(s, s);
  g.strokeStyle = color;
  g.lineWidth = 1.7;
  g.beginPath();
  for (const o of [-s, 0, s]) {
    g.moveTo(o, s);
    g.lineTo(o + s, 0);
  }
  g.stroke();
  return g.getImageData(0, 0, s, s);
}

function makeMarkerElement(m: MapMarker): { el: HTMLDivElement; label: HTMLSpanElement | null } {
  const el = document.createElement("div");
  el.className =
    "atlas-marker atlas-marker--" +
    m.visitType +
    (m.isCurrent ? " atlas-marker--current" : "") +
    (m.activity ? " atlas-marker--activity" : "") +
    (m.activity === "overnight" ? " atlas-marker--overnight" : "");
  el.setAttribute("role", "button");
  if (m.isCurrent) {
    for (const cls of ["atlas-marker__pulse", "atlas-marker__ring"]) {
      const s = document.createElement("span");
      s.className = cls;
      el.appendChild(s);
    }
  }
  // A residence (lived Visit) that is not the current base gets a calm static
  // ring so the map reads as clusters radiating from home bases (v1.3).
  if (m.visitType === "lived" && !m.isCurrent) {
    const home = document.createElement("span");
    home.className = "atlas-marker__home";
    el.appendChild(home);
  }
  // A small country flag planted on the place: a hairline pole rising from
  // the pin with the flag at its top.
  if (markerHasFlag(m)) {
    const flag = document.createElement("span");
    flag.className = "atlas-marker__flag";
    flag.setAttribute("aria-hidden", "true");
    const img = document.createElement("img");
    img.src = "/flags/" + m.place.countryCode.toUpperCase() + ".svg";
    img.alt = "";
    img.draggable = false;
    img.addEventListener("error", () => flag.remove());
    flag.appendChild(img);
    el.appendChild(flag);
  }
  const dot = document.createElement("span");
  dot.className = "atlas-marker__dot";
  // What the trip was for, drawn inside the pin (static glyph constants).
  if (m.activity) {
    const glyph = m.activity === "overnight" ? OVERNIGHT_GLYPH : ACTIVITY_GLYPH[m.activity];
    dot.innerHTML = glyphSvg(glyph, m.activity === "overnight" ? 10 : 13, 1.9);
  }
  el.appendChild(dot);

  const label = document.createElement("span");
  label.className = "atlas-marker__label";
  label.setAttribute("aria-hidden", "true"); // the button's aria-label announces it
  const name = document.createElement("span");
  name.className = "atlas-marker__label-name";
  name.textContent = m.place.name;
  label.appendChild(name);
  if (m.isCurrent) {
    const country = document.createElement("span");
    country.className = "atlas-marker__label-country";
    country.textContent = m.place.country;
    label.appendChild(country);
  }
  el.appendChild(label);
  return { el, label };
}

const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true"><path fill="currentColor" d="M12 2.6l2.85 5.95 6.55.8-4.83 4.5 1.25 6.5L12 17.15 6.18 20.35l1.25-6.5L2.6 9.35l6.55-.8z"/></svg>';

/** A place on the wishlist: a star in a soft ring of the wish colour, its name
 * beside it (placed by the label layout), when-to-go on hover. */
function makeWishElement(w: WishMarker): { el: HTMLDivElement; label: HTMLSpanElement } {
  const el = document.createElement("div");
  el.className = "atlas-wishpin";
  el.setAttribute("role", "button");
  const dot = document.createElement("span");
  dot.className = "atlas-wishpin__dot";
  dot.innerHTML = STAR_SVG;
  const label = document.createElement("span");
  label.className = "atlas-wishpin__label";
  label.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.textContent = w.place.name;
  const meta = document.createElement("span");
  meta.className = "atlas-wishpin__meta";
  meta.textContent = w.label;
  label.append(name, meta);
  el.append(dot, label);
  return { el, label };
}
