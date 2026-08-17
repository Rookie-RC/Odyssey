export type ThemeId = "light" | "night";

export interface SeasonColors {
  spring: string;
  summer: string;
  autumn: string;
  winter: string;
}

export interface AtlasTheme {
  id: ThemeId;
  label: string;
  colors: {
    bg: string;
    surface: string;
    surfaceElevated: string;
    textPrimary: string;
    textSecondary: string;
    border: string;
    accent: string;
  };
  map: {
    styleUrl: string;
    tint: string;
  };
  markers: {
    current: string;
    currentRing: string;
    visited: string;
    visitedFaint: string;
  };
  countries: {
    fill: string;
    outline: string;
  };
  // Seasonal palette for the Journey Timeline line. Semantic meaning is
  // stable across themes; only luminance/saturation may shift (VISUAL_SPEC §20).
  seasons: SeasonColors;
}
