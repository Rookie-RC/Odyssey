import type { AtlasTheme } from "./types";

export const lightTheme: AtlasTheme = {
  id: "light",
  label: "Light",
  colors: {
    bg: "#F7F6F2",
    surface: "#FFFFFF",
    surfaceElevated: "#FCFBF8",
    textPrimary: "#1E1E1C",
    textSecondary: "#6F726E",
    border: "#E4E2DC",
    accent: "#2563EB",
  },
  map: {
    // Carto Positron, adapted at runtime (see lib/map-style.ts) toward warm
    // parchment land and pale blue water. The tint adds a light warm wash plus
    // a gentle vignette; the wash stays weak enough that markers stay crisp.
    styleUrl: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    tint: [
      "linear-gradient(rgba(239, 231, 214, 0.12), rgba(239, 231, 214, 0.12))",
      "radial-gradient(125% 100% at 50% 35%, rgba(246, 242, 232, 0) 58%, rgba(206, 192, 164, 0.28) 100%)",
    ].join(", "),
  },
  markers: {
    current: "#2563EB",
    currentRing: "rgba(37, 99, 235, 0.24)",
    visited: "#1E1E1C",
    visitedFaint: "rgba(30, 30, 28, 0.42)",
  },
  countries: {
    // Very subtle fill only (no outline): the external Natural Earth polygons
    // are coarser than the basemap, so a fill avoids the misaligned-outline
    // artifact. Clearly weaker than every location marker.
    fill: "rgba(64, 90, 140, 0.05)",
    outline: "rgba(64, 90, 140, 0.0)",
  },
  routes: {
    // A restrained warm umber — an atlas-pencil trajectory against the
    // parchment geography. Clearly weaker than the charcoal visited markers.
    line: "rgba(158, 124, 84, 0.5)",
  },
  seasons: {
    // VISUAL_SPEC §20 starting palette (light): soft, natural, low saturation.
    spring: "#8FC89B",
    summer: "#F4C95D",
    autumn: "#E98A4A",
    winter: "#80A9D4",
  },
};
