"use client";

// MiniMap: a small MapLibre preview used by Manage Atlas forms. It shows a
// location with a draggable marker and supports click-to-place. Wheel input is
// deliberately disabled (scrollZoom: false) so page scrolling over forms is
// never hijacked; zoom happens through the +/- controls.
import { useEffect, useRef } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { loadThemeStyle } from "../../lib/map-style";
import type { AtlasTheme } from "../../themes";

export interface MiniMapValue {
  lat: number;
  lng: number;
}

interface MiniMapProps {
  theme: AtlasTheme;
  value: MiniMapValue | null;
  /** Called when the user drags the marker or clicks the map. */
  onChange: (v: MiniMapValue) => void;
  height?: number;
}

export default function MiniMap({ theme, value, onChange, height = 220 }: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const mapGen = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueRef = useRef(value);
  valueRef.current = value;

  // Create the map once. The container lives for the component's lifetime and
  // the map instance is recreated when the theme style URL changes.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: maplibregl.Map;
    let cancelled = false;

    const create = async () => {
      const gen = (mapGen.current += 1);
      let style: StyleSpecification | string = theme.map.styleUrl;
      try {
        style = await loadThemeStyle(theme.id, theme.map.styleUrl);
      } catch {
        style = theme.map.styleUrl;
      }
      if (cancelled || gen !== mapGen.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
      map = new maplibregl.Map({
        container,
        style,
        center: valueRef.current
          ? [valueRef.current.lng, valueRef.current.lat]
          : [10, 50],
        zoom: valueRef.current ? 8 : 2,
        attributionControl: { compact: true },
        scrollZoom: false,
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      map.on("click", (e) => {
        onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      });
      map.on("load", () => {
        if (mapRef.current !== map) return;
        updateMarker(map);
      });
      mapRef.current = map;
    };

    create();
    return () => {
      cancelled = true;
      mapGen.current += 1;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.map.styleUrl, theme.id]);

  const updateMarker = (map: maplibregl.Map) => {
    const v = valueRef.current;
    if (!v) return;
    if (!markerRef.current) {
      const el = document.createElement("div");
      el.className = "atlas-minimap-marker";
      const dot = document.createElement("span");
      dot.className = "atlas-minimap-marker__dot";
      el.appendChild(dot);
      markerRef.current = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([v.lng, v.lat])
        .addTo(map);
      markerRef.current.on("dragend", () => {
        const lngLat = markerRef.current?.getLngLat();
        if (lngLat) onChangeRef.current({ lat: lngLat.lat, lng: lngLat.lng });
      });
    } else {
      markerRef.current.setLngLat([v.lng, v.lat]);
    }
  };

  // Keep the marker and camera in sync with external value changes.
  useEffect(() => {
    const map = mapRef.current;
    const v = value;
    if (!map || !v) return;
    if (!map.loaded()) return;
    updateMarker(map);
    if (v) {
      map.easeTo({ center: [v.lng, v.lat], zoom: Math.max(map.getZoom(), 6), duration: 300 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng, theme.map.styleUrl]);

  return (
    <div className="atlas-minimap" style={{ height }}>
      <div ref={containerRef} className="atlas-minimap__map" />
      <p className="atlas-minimap__hint">Drag the marker or click the map to refine the location.</p>
    </div>
  );
}
