import type { AtlasTheme } from "./types";

export const nightTheme: AtlasTheme = {
  id: "night",
  label: "Night",
  colors: {
    bg: "#08121F",
    surface: "#111827",
    surfaceElevated: "#151E2D",
    textPrimary: "#F2F0E9",
    textSecondary: "#94A3B8",
    border: "#243244",
    accent: "#38BDF8",
  },
  map: {
    // Carto Dark Matter, adapted at runtime (see lib/map-style.ts) off pure
    // black into a deep-navy cinematic family (water #0A1729, land #172940).
    // The tint is a restrained vignette that deepens the edges without neon.
    styleUrl: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    tint: [
      "linear-gradient(rgba(6, 12, 24, 0.18), rgba(6, 12, 24, 0) 28%)",
      "radial-gradient(130% 110% at 50% 40%, rgba(6, 12, 24, 0) 65%, rgba(4, 9, 20, 0.35) 100%)",
    ].join(", "),
  },
  markers: {
    // Cool current marker, warm visited markers (VISUAL_SPEC §19).
    current: "#38BDF8",
    currentRing: "rgba(56, 189, 248, 0.3)",
    visited: "#E7B36A",
    visitedFaint: "rgba(231, 179, 106, 0.5)",
  },
  countries: {
    // Slightly elevated navy fill only (no outline). Always weaker than every
    // location marker; the outline is omitted because the external polygons
    // don't match the basemap geometry exactly.
    fill: "rgba(110, 140, 190, 0.07)",
    outline: "rgba(126, 152, 196, 0.0)",
  },
};
