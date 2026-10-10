// Theme contract (VISUAL_SPEC §26 / PRODUCT_SPEC §35).
//
// A theme is pure presentation: semantic tokens that components consume via CSS
// custom properties (see applyTheme in ./index.ts) plus the map adaptation the
// Hero Map applies to its base style. Themes never alter domain logic — the
// same Places, Visits and Wishlist render identically structured in every
// theme; only colour, typography, geometry, texture, map style, marker
// appearance, season palette and image treatment change.

export type ThemeId = "light" | "night";

/** What the user picks. "auto" follows the OS light/dark preference and
 * resolves to the Light or Night theme. */
export type ThemePreference = ThemeId | "auto";

export interface SeasonColors {
  spring: string;
  summer: string;
  autumn: string;
  winter: string;
}

/** Colours applied to the CARTO vector base style (positron / dark-matter share
 * the same layer ids, so one adapter serves every theme — lib/map-style.ts). */
export interface MapPalette {
  background: string;
  land: string;
  park: string;
  residential: string;
  water: string;
  waterway: string;
  building: string;
  /** International borders (solid; disputed segments dashed). */
  border: string;
  borderWidth: number;
  borderState: string;
  borderCounty: string;
  road: string;
  roadCase: string;
  /** Label inks. */
  labelWater: string;
  labelCountry: string;
  labelCity: string;
  labelTown: string;
  labelMinor: string;
  labelRoad: string;
  labelHalo: string;
}

export interface Hillshade {
  shadow: string;
  highlight: string;
  accent: string;
  /** 0..1 — how strongly relief reads (hillshade layers have no opacity;
   * strength comes from this plus the alpha of the colours). */
  exaggeration: number;
}

/** "City lights": a soft glow on populated places from the base tiles' own
 * place layer — the Night theme's cinematic atmosphere (no extra data). */
export interface CityLights {
  color: string;
  core: string;
  opacity: number;
}

export interface AtlasTheme {
  id: ThemeId;
  label: string;
  /** One short line shown in the theme picker. */
  description: string;
  /** Drives color-scheme (form controls, scrollbars) and Auto resolution. */
  mode: "light" | "dark";
  colors: {
    bg: string;
    /** Slightly offset ground for bands (collapsed map strip, footer). */
    bgAlt: string;
    surface: string;
    surfaceElevated: string;
    /** Inputs and wells. */
    surfaceSunken: string;
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    border: string;
    borderStrong: string;
    accent: string;
    accentSoft: string;
    onAccent: string;
    /** The NOW / current-place semantic (pill, timeline anchor). */
    now: string;
    nowSoft: string;
    scrim: string;
    danger: string;
    /** Colour of small date stamps. */
    dateInk: string;
  };
  fonts: {
    /** Wordmark, place titles, section display. */
    display: string;
    /** Prose: reflections, why, bios. */
    body: string;
    /** Controls, metadata, labels. */
    ui: string;
    mono: string;
    /** Font used for small date stamps. */
    date: string;
    displayWeight: number;
    /** Letter-spacing for small uppercase section labels. */
    labelTracking: string;
  };
  shape: {
    radiusSm: string;
    radiusMd: string;
    radiusLg: string;
    radiusXl: string;
  };
  shadows: {
    sm: string;
    md: string;
    lg: string;
  };
  texture: {
    /** Paper laid *under* the content (only the page ground shows it). */
    paper: string;
    paperOpacity: number;
    /** Grain laid *over* everything, photographs included. */
    grain: string;
    grainOpacity: number;
  };
  /** Liquid glass, reserved for chrome that floats over the world — the map
   * and photographs (top-bar pills, map controls, photo actions). Content
   * itself stays on paper surfaces. */
  glass: {
    /** Tint laid over the frosted backdrop; a stronger one on hover. */
    tint: string;
    tintHover: string;
    /** Backdrop frost: blur radius (px) and saturation boost. */
    blur: number;
    saturate: number;
    /** Specular rim: the bright upper edge and the softer lower one. */
    highlight: string;
    edge: string;
  };
  image: {
    /** CSS filter applied to photographs (memory fragments, hero images). */
    filter: string;
    /** Frame around small photos (timeline fragments): CSS border value. */
    frame: string;
  };
  map: {
    base: "light" | "dark";
    palette: MapPalette;
    hillshade: Hillshade | null;
    cityLights: CityLights | null;
    /** CSS overlay painted above the WebGL canvas (wash, vignette, paper). */
    tint: string;
    tintBlend: string;
  };
  markers: {
    current: string;
    currentRing: string;
    currentGlow: string;
    visited: string;
    visitedStroke: string;
    visitedFaint: string;
    visitedGlow: string;
    /** Wishlist pins (optional map layer). */
    wish: string;
    label: string;
    labelHalo: string;
  };
  countries: {
    /** Wash over visited countries (trimmed by the coastline). */
    fill: string;
    outline: string;
    /** Hatching over countries only on the wishlist: "would like to go". */
    wish: string;
  };
  routes: {
    line: string;
  };
  /** Season semantics are stable across themes (spring green, summer gold,
   * autumn amber, winter blue); only luminance/saturation shift (§20).
   * `seasons` is for lines/dots, `seasonInk` for legible season text. */
  seasons: SeasonColors;
  seasonInk: SeasonColors;
}
