export type ThemeId = "light" | "night";

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
}
