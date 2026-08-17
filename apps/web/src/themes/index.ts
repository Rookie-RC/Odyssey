import type { AtlasTheme, ThemeId } from "./types";
import { lightTheme } from "./light";
import { nightTheme } from "./night";

export type { AtlasTheme, ThemeId };

export const themes: Record<ThemeId, AtlasTheme> = {
  light: lightTheme,
  night: nightTheme,
};

// applyTheme writes the theme's semantic tokens as CSS custom properties so the
// whole UI (markers, cards, overlays) re-styles from one source of truth.
export function applyTheme(theme: AtlasTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  const vars: Record<string, string> = {
    "--bg": theme.colors.bg,
    "--surface": theme.colors.surface,
    "--surface-elevated": theme.colors.surfaceElevated,
    "--text-primary": theme.colors.textPrimary,
    "--text-secondary": theme.colors.textSecondary,
    "--border": theme.colors.border,
    "--accent": theme.colors.accent,
    "--map-tint": theme.map.tint,
    "--marker-current": theme.markers.current,
    "--marker-current-ring": theme.markers.currentRing,
    "--marker-visited": theme.markers.visited,
    "--marker-visited-faint": theme.markers.visitedFaint,
    "--country-fill": theme.countries.fill,
    "--country-outline": theme.countries.outline,
  };
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
